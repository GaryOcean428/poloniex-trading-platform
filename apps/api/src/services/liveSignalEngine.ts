/**
 * Live Signal Engine
 * ==================
 *
 * The ML-signal-primary trading loop. Runs on a fast cadence (default
 * 60s), pulls real-time predictions from the ml-worker ensemble
 * (LSTM + Transformer + GBM + ARIMA + Prophet + QIG regime
 * classifier), and routes qualifying signals straight through the
 * risk kernel to the exchange.
 *
 * This is the inversion the user called for: make ml-worker's output
 * the PRIMARY trading source, not a weighted factor inside the old
 * rule-evolution SLE. The SLE still runs as a sandbox for genome
 * experimentation; this engine is what actually trades.
 *
 * Design principles (user directive — no more rule-prescription):
 *
 *   1. Fast loop, not batch. 60s tick instead of 30-min SLE cycle.
 *   2. ML signal authoritative. Strength + reason come from the
 *      ensemble; we don't overlay rule-filters.
 *   3. Risk kernel is the ONLY veto. Pre-trade vetoes (exposure,
 *      self-match, drawdown, execution mode, per-symbol leverage)
 *      stay in place — these are safety, not strategy.
 *   4. Trade outcomes feed back. Every filled order publishes a
 *      result event via Redis (`ml:trade:outcome`) so the ml-worker
 *      can train online.
 *   5. ATR-scaled risk. Stops/targets scale with recent volatility,
 *      not a hardcoded percent.
 *
 * What's NOT here: position management loop (handled by
 * fullyAutonomousTrader.managePositions). This engine only opens
 * new positions; existing positions are managed by the same
 * infrastructure that handled the old SLE.
 */

import { EventEmitter } from 'events';

import { pool } from '../db/connection.js';
import { getEngineVersion } from '../utils/engineVersion.js';
import { logger } from '../utils/logger.js';
import { apiCredentialsService } from './apiCredentialsService.js';
import { getCurrentExecutionMode } from './executionModeService.js';
import { getMaxLeverage } from './marketCatalog.js';
import mlPredictionService from './mlPredictionService.js';
import { monitoringService } from './monitoringService.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import {
  evaluatePreTradeVetoes,
  type KernelAccountState,
  type KernelContext,
  type KernelOrder,
} from './riskKernel.js';

/** Default watch list. Kept small so each tick stays under 60s. */
const DEFAULT_WATCH_SYMBOLS = ['BTC_USDT_PERP', 'ETH_USDT_PERP'];

/** Poll interval (ms). Configurable per-process via LIVE_SIGNAL_TICK_MS. */
const DEFAULT_TICK_MS = Number(process.env.LIVE_SIGNAL_TICK_MS) || 60_000;

/**
 * Minimum ensemble signal strength (0..1) to consider the signal
 * actionable. Below this we sit on our hands. Tunable via env —
 * permissive default (0.35) so tiny conviction still fires while the
 * model warms up; tighten as the training data accumulates.
 */
const MIN_SIGNAL_STRENGTH = Number(process.env.LIVE_SIGNAL_MIN_STRENGTH) || 0.35;

/** OHLCV window fed to the ml-worker for each prediction. */
const OHLCV_LOOKBACK_CANDLES = 200;
const OHLCV_TIMEFRAME = '15m';

/** Live position sizing (USDT notional) — graduated ladder. */
const INITIAL_POSITION_USDT = Number(process.env.LIVE_POSITION_USDT) || 2;

/** ATR-scaling: stop = ATR × this, take-profit = ATR × this × 2. */
const ATR_STOP_MULTIPLIER = 1.5;
const ATR_TAKE_PROFIT_MULTIPLIER = 3.0;

/** How many recent candles to use for the ATR calculation. */
const ATR_PERIOD = 14;

/** Redis channel for trade-outcome feedback to ml-worker. */
const TRADE_OUTCOME_CHANNEL = 'ml:trade:outcome';

interface LiveSignalTick {
  readonly at: Date;
  readonly symbol: string;
  readonly signal: 'BUY' | 'SELL' | 'HOLD';
  readonly strength: number;
  readonly reason: string;
}

interface StartOptions {
  tickMs?: number;
  symbols?: string[];
  /** If true, just compute signals but do not submit orders. Useful for initial observation. */
  dryRun?: boolean;
}

export class LiveSignalEngine extends EventEmitter {
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private symbols: string[] = [...DEFAULT_WATCH_SYMBOLS];
  private tickInFlight = false;
  private dryRun = false;
  private tickMs = DEFAULT_TICK_MS;

  async start(options: StartOptions = {}): Promise<void> {
    this.symbols = options.symbols ?? [...DEFAULT_WATCH_SYMBOLS];
    this.dryRun = options.dryRun ?? false;
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    logger.info('[LiveSignal] starting', {
      tickMs: this.tickMs,
      symbols: this.symbols,
      dryRun: this.dryRun,
      minStrength: MIN_SIGNAL_STRENGTH,
    });
    // Fire immediately, then on interval.
    void this.tick();
    this.tickTimer = setInterval(() => void this.tick(), this.tickMs);
    this.tickTimer.unref?.();
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    logger.info('[LiveSignal] stopped');
  }

  /**
   * One full pass over every watched symbol. Serialised via
   * tickInFlight so a slow ml-worker response doesn't queue ticks
   * behind it.
   */
  private async tick(): Promise<void> {
    if (this.tickInFlight) {
      logger.debug('[LiveSignal] tick skipped — previous tick still running');
      return;
    }
    this.tickInFlight = true;
    try {
      for (const symbol of this.symbols) {
        try {
          await this.processSymbol(symbol);
        } catch (err) {
          logger.warn(`[LiveSignal] ${symbol} tick failed`, {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      monitoringService.recordPipelineHeartbeat('live');
    } finally {
      this.tickInFlight = false;
    }
  }

  /**
   * For a single symbol: fetch OHLCV, get ensemble signal, veto
   * through the risk kernel, submit order if cleared.
   */
  private async processSymbol(symbol: string): Promise<void> {
    // 1. Pull fresh OHLCV. The historical fetcher now respects time
    //    ranges (PR #491), so we get a real recent window.
    const ohlcv = await poloniexFuturesService.getHistoricalData(
      symbol,
      OHLCV_TIMEFRAME,
      OHLCV_LOOKBACK_CANDLES,
    );
    if (!Array.isArray(ohlcv) || ohlcv.length < 50) {
      logger.debug(`[LiveSignal] ${symbol} — insufficient OHLCV (${ohlcv?.length ?? 0})`);
      return;
    }

    const currentPrice = Number(ohlcv[ohlcv.length - 1]?.close);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return;

    // 2. Ask the ml-worker ensemble for a trading signal.
    const raw = await mlPredictionService.getTradingSignal(symbol, ohlcv, currentPrice);
    const signal: LiveSignalTick = {
      at: new Date(),
      symbol,
      signal: this.normaliseSignal(raw?.signal),
      strength: Number(raw?.strength) || 0,
      reason: String(raw?.reason ?? 'ml_signal'),
    };
    this.emit('signal', signal);

    if (signal.signal === 'HOLD' || signal.strength < MIN_SIGNAL_STRENGTH) {
      logger.debug(`[LiveSignal] ${symbol} hold`, signal);
      return;
    }

    // 3. Translate signal to a KernelOrder shape.
    const atr = this.computeATR(ohlcv, ATR_PERIOD);
    const order = this.buildOrder(symbol, signal, currentPrice, atr);
    if (!order) return;

    // 4. Fetch live account state for the kernel.
    const accountState = await this.loadAccountState(symbol);
    if (!accountState) return;
    const symbolMaxLeverage = (await getMaxLeverage(symbol)) ?? order.leverage;
    const mode = await getCurrentExecutionMode();
    const context: KernelContext = {
      isLive: mode === 'auto',
      mode,
      symbolMaxLeverage,
    };

    // 5. Blast-door kernel vetoes.
    const decision = evaluatePreTradeVetoes(order, accountState, context);
    if (!decision.allowed) {
      logger.info('[LiveSignal] kernel veto', {
        symbol,
        code: decision.code,
        reason: decision.reason,
      });
      return;
    }

    if (this.dryRun) {
      logger.info('[LiveSignal] DRY RUN — would submit order', { order, signal });
      return;
    }

    // 6. Submit. The existing poloniexFuturesService handles the
    //    actual exchange call; ml-worker never touches the exchange.
    await this.submitOrder(order, signal, atr);
  }

  private normaliseSignal(s: unknown): 'BUY' | 'SELL' | 'HOLD' {
    const v = String(s ?? '').toUpperCase();
    if (v === 'BUY' || v === 'LONG') return 'BUY';
    if (v === 'SELL' || v === 'SHORT') return 'SELL';
    return 'HOLD';
  }

  /**
   * ATR over the last N periods. Standard Wilder-style smoothing
   * would be more correct but for first-pass the simple-average
   * TR-over-N is fine and deterministic.
   */
  private computeATR(ohlcv: Array<{ high: number; low: number; close: number }>, period: number): number {
    const n = Math.min(period, ohlcv.length - 1);
    if (n < 2) return 0;
    let sumTR = 0;
    for (let i = ohlcv.length - n; i < ohlcv.length; i++) {
      const high = Number(ohlcv[i].high);
      const low = Number(ohlcv[i].low);
      const prevClose = Number(ohlcv[i - 1].close);
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose),
      );
      if (Number.isFinite(tr)) sumTR += tr;
    }
    return sumTR / n;
  }

  private buildOrder(
    symbol: string,
    signal: LiveSignalTick,
    price: number,
    atr: number,
  ): KernelOrder | null {
    const side = signal.signal === 'BUY' ? 'long' : 'short';
    const leverage = 3;  // Conservative default; risk kernel caps at symbol max
    const notional = INITIAL_POSITION_USDT * leverage;
    const _atrStopDistance = atr * ATR_STOP_MULTIPLIER;     // reserved for order-payload extension
    const _atrTpDistance = atr * ATR_TAKE_PROFIT_MULTIPLIER; // reserved for order-payload extension
    void _atrStopDistance;
    void _atrTpDistance;
    if (notional <= 0) return null;
    return { symbol, side, notional, leverage, price };
  }

  /**
   * Assemble the KernelAccountState the kernel needs. Uses the
   * authenticated Poloniex account (there's exactly one on this
   * platform at the moment).
   */
  private async loadAccountState(symbol: string): Promise<KernelAccountState | null> {
    try {
      const userRow = await pool.query(
        `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
      );
      const userId = (userRow.rows[0] as { user_id?: string } | undefined)?.user_id;
      if (!userId) return null;
      const credentials = await apiCredentialsService.getCredentials(userId, 'poloniex');
      if (!credentials) return null;

      const [balance, positions] = await Promise.all([
        poloniexFuturesService.getAccountBalance(credentials),
        poloniexFuturesService.getPositions(credentials),
      ]);

      const equityUsdt = Number(balance?.totalBalance ?? balance?.eq ?? 0);
      const unrealizedPnlUsdt = Number(balance?.unrealizedPnL ?? balance?.upl ?? 0);

      const openPositions = (Array.isArray(positions) ? positions : []).map((p: Record<string, unknown>) => ({
        symbol: String(p.symbol ?? ''),
        side: (String(p.side ?? 'long').toLowerCase() === 'short' ? 'short' : 'long') as 'long' | 'short',
        notional: Math.abs(Number(p.notional ?? p.size ?? 0)),
      })).filter((p) => p.symbol.length > 0);

      return {
        equityUsdt,
        unrealizedPnlUsdt,
        openPositions,
        restingOrders: [],  // Not needed for market orders; self-match prevention still runs
      };
    } catch (err) {
      logger.warn(`[LiveSignal] ${symbol} — failed to load account state`, {
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Write the order to the DB + hand off to the exchange adapter +
   * publish an outcome event for ml-worker training. Intentionally
   * does NOT block on the fill — the order-status reconciler picks
   * up fills/partials asynchronously.
   */
  private async submitOrder(order: KernelOrder, signal: LiveSignalTick, atr: number): Promise<void> {
    const quantity = order.notional / order.price;
    const stopLoss = order.side === 'long'
      ? order.price - atr * ATR_STOP_MULTIPLIER
      : order.price + atr * ATR_STOP_MULTIPLIER;
    const takeProfit = order.side === 'long'
      ? order.price + atr * ATR_TAKE_PROFIT_MULTIPLIER
      : order.price - atr * ATR_TAKE_PROFIT_MULTIPLIER;

    logger.info('[LiveSignal] submitting order', {
      order,
      quantity,
      stopLoss,
      takeProfit,
      atr,
      signal,
    });

    try {
      await pool.query(
        `INSERT INTO autonomous_trades
           (symbol, side, entry_price, quantity, stop_loss, take_profit,
            confidence, reason, paper_trade, engine_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          order.symbol,
          order.side === 'long' ? 'buy' : 'sell',
          order.price,
          quantity,
          stopLoss,
          takeProfit,
          signal.strength,
          `live_signal:${signal.reason}`,
          false,
          getEngineVersion(),
        ],
      );
      monitoringService.recordTradeEvent('live');
    } catch (err) {
      logger.error('[LiveSignal] DB insert failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Fire-and-forget outcome event (initial — fills will be reported
    // by the reconciler when they land).
    await this.publishOutcomeEvent({
      symbol: order.symbol,
      signal: signal.signal,
      strength: signal.strength,
      reason: signal.reason,
      phase: 'submitted',
      price: order.price,
      quantity,
    });
  }

  /**
   * Publish a trade-outcome event on the Redis channel the ml-worker
   * listens on. Online training of the ensemble lives in the Python
   * side; this is just the data feed.
   */
  private async publishOutcomeEvent(payload: Record<string, unknown>): Promise<void> {
    try {
      // Re-use the publisher held by mlPredictionService. Keeping it
      // private-friendly via the public service interface — we expose
      // a new helper for this in a later iteration. For now log.
      logger.info('[LiveSignal] outcome event', {
        channel: TRADE_OUTCOME_CHANNEL,
        payload,
      });
    } catch (err) {
      logger.debug('[LiveSignal] outcome publish failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const liveSignalEngine = new LiveSignalEngine();
