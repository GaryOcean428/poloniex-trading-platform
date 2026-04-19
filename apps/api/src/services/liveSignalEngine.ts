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
import { sampleBeta, type BanditCounter } from './thompsonBandit.js';
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

/**
 * Contextual bandit: after this many total trades of a (signalKey,
 * regime) pair, start using the Beta posterior to gate new orders.
 * Below this, we're in exploration mode — every signal with sufficient
 * raw strength is accepted so the bandit has data to learn from.
 */
const BANDIT_EXPLORATION_TRADES = 5;

/**
 * When the bandit gate is active, the posterior-sampled confidence
 * θ ~ Beta(α, β) must clear this floor for the signal to proceed.
 * θ is roughly "probability this (signalKey, regime) combo wins
 * its next trade." 0.4 = 40%, a reasonable not-obviously-losing bar.
 */
const BANDIT_MIN_POSTERIOR = 0.4;

interface LiveSignalTick {
  readonly at: Date;
  readonly symbol: string;
  readonly signal: 'BUY' | 'SELL' | 'HOLD';
  readonly strength: number;
  readonly reason: string;
  readonly regime: string;
  readonly signalKey: string;
  readonly banditPosterior: number;
  readonly effectiveStrength: number;
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
  /** Latest close time already processed by the bandit reconciler. */
  private lastReconcileAt: Date = new Date(Date.now() - 60 * 60_000);  // look back 1h on boot

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
      // First: reconcile any closes since last tick to feed the bandit.
      // This is the online-learning half — without it, the Thompson
      // posterior never updates and the gate is dead weight.
      await this.reconcileClosedTrades();

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
   * Pull autonomous_trades rows closed since lastReconcileAt whose
   * reason was set by this engine (prefix live_signal|), parse out the
   * bandit key + regime, and apply the win/loss to the Beta posterior.
   *
   * Also publishes a 'closed' trade-outcome event so the ml-worker's
   * online-training data feed sees the realised P&L.
   */
  private async reconcileClosedTrades(): Promise<void> {
    try {
      const result = await pool.query(
        `SELECT symbol, reason, pnl, exit_time, exit_price, entry_price, quantity, exit_reason
           FROM autonomous_trades
          WHERE status = 'closed'
            AND exit_time > $1
            AND reason LIKE 'live_signal|%'
          ORDER BY exit_time ASC
          LIMIT 100`,
        [this.lastReconcileAt],
      );
      const rows = (result.rows as Array<Record<string, unknown>>) ?? [];
      for (const row of rows) {
        const reason = String(row.reason ?? '');
        const keyMatch = reason.match(/key=([^|]+)/);
        const regimeMatch = reason.match(/regime=([^|]+)/);
        const signalKey = keyMatch?.[1];
        const regime = regimeMatch?.[1];
        const pnl = Number(row.pnl ?? 0);
        const exitReason = String(row.exit_reason ?? '');
        const closedAt = row.exit_time ? new Date(row.exit_time as string) : new Date();

        // Skip reconciler-driven closes from bandit learning. A phantom
        // row that stateReconciliationService closed with
        // exit_reason='reconciled_not_on_exchange' (or similar) never
        // actually executed on the exchange — pnl=0 is a synthetic
        // placeholder, not a realized loss. Counting these as losses
        // poisons the Thompson posterior: observed 2026-04-19 that one
        // reconciliation pass of 97 phantom ghosts tanked
        // ml_breakout|ranging from Beta(1,1) to ~Beta(1,97), putting
        // the bandit gate posterior around 0.002 and silently blocking
        // all new entries. Only real filled+closed trades (non-zero
        // exit_price AND non-reconciliation exit_reason) feed the
        // bandit.
        const isReconcilerClose =
          exitReason.startsWith('reconciled_') || exitReason === 'reconciled_phantom_no_exchange_position';
        const hasRealExit = Number(row.exit_price ?? 0) > 0;

        if (signalKey && regime && !isReconcilerClose && hasRealExit) {
          await this.recordTradeOutcome(signalKey, regime, pnl);
          // Push a 'closed' outcome event to the ml-worker too.
          await this.publishOutcomeEvent({
            symbol: row.symbol,
            phase: 'closed',
            signalKey,
            regime,
            realizedPnl: pnl,
            entryPrice: Number(row.entry_price ?? 0),
            exitPrice: Number(row.exit_price ?? 0),
            quantity: Number(row.quantity ?? 0),
            closedAt: closedAt.toISOString(),
          });
        } else if (isReconcilerClose) {
          logger.debug('[LiveSignal] skipping bandit update for reconciler-closed row', {
            symbol: row.symbol,
            exitReason,
            pnl,
          });
        }

        if (closedAt > this.lastReconcileAt) {
          this.lastReconcileAt = closedAt;
        }
      }
    } catch (err) {
      logger.debug('[LiveSignal] reconcileClosedTrades failed (fail-soft)', {
        err: err instanceof Error ? err.message : String(err),
      });
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
    const rawSignal = this.normaliseSignal(raw?.signal);
    const rawStrength = Number(raw?.strength) || 0;
    const rawReason = String(raw?.reason ?? 'ml_signal');

    // 2a. Contextual bandit: extract (signalKey, regime) and sample
    //     Beta posterior. Below BANDIT_EXPLORATION_TRADES total trades
    //     for this combo, we let everything through (exploration).
    //     Once we have enough data, the posterior gates the signal.
    const regime = this.detectSimpleRegime(ohlcv);
    const signalKey = this.extractSignalKey(rawReason);
    const counter = await this.loadBanditCounter(signalKey, regime);
    const banditPosterior = sampleBeta(counter.wins, counter.losses);
    const totalTrials = (counter.wins - 1) + (counter.losses - 1);  // subtract Beta(1,1) prior
    const banditActive = totalTrials >= BANDIT_EXPLORATION_TRADES;
    const banditMultiplier = banditActive ? banditPosterior : 1.0;
    const effectiveStrength = rawStrength * banditMultiplier;

    const signal: LiveSignalTick = {
      at: new Date(),
      symbol,
      signal: rawSignal,
      strength: rawStrength,
      reason: rawReason,
      regime,
      signalKey,
      banditPosterior,
      effectiveStrength,
    };
    this.emit('signal', signal);

    if (signal.signal === 'HOLD' || signal.strength < MIN_SIGNAL_STRENGTH) {
      logger.debug(`[LiveSignal] ${symbol} hold`, signal);
      return;
    }

    // 2b. Bandit gate. Active only once we have enough trials; until
    //     then we let raw strength speak for itself (exploration phase).
    if (banditActive && banditPosterior < BANDIT_MIN_POSTERIOR) {
      logger.info(`[LiveSignal] ${symbol} bandit gate`, {
        signalKey,
        regime,
        banditPosterior: banditPosterior.toFixed(3),
        wins: counter.wins,
        losses: counter.losses,
        rawStrength: rawStrength.toFixed(3),
      });
      return;
    }

    // 2c. Stacking guard: if we already have a RECENT open
    //      autonomous_trade row on this symbol from the live-signal
    //      engine, don't stack. Market orders on the same side
    //      accumulate into one net Poloniex position — the exposure
    //      cap catches the extreme, but we'd still burn fees stacking
    //      60x/hour into the same trade. Let the existing position
    //      play out; managePositions or the SL/TP exit will flip the
    //      DB row to 'closed' and free this symbol for a fresh signal.
    //
    //      Time-bounded (60 min): the 2026-04-18 phantom-rows incident
    //      had 6 rows stuck in status='open' for 12+ hours because
    //      order_id was never captured; the guard read them as "open
    //      positions" and silently blocked every signal. The periodic
    //      reconciler (stateReconciliationService) now catches
    //      phantoms within 60s, but this 60-min window is a belt on top
    //      of those braces — if reconciliation is itself broken, we
    //      still resume trading within an hour rather than indefinitely.
    //      ATR-scaled stops/takes resolve most real trades in tens of
    //      minutes; anything open >1h is outside our strategy envelope.
    const openCheck = await pool.query(
      `SELECT 1 FROM autonomous_trades
        WHERE symbol = $1
          AND status = 'open'
          AND reason LIKE 'live_signal|%'
          AND (entry_time > NOW() - INTERVAL '60 minutes'
               OR (entry_time IS NULL AND created_at > NOW() - INTERVAL '60 minutes'))
        LIMIT 1`,
      [symbol],
    );
    if ((openCheck.rowCount ?? 0) > 0) {
      // Info (not debug) so operators can see the guard firing in
      // prod without enabling verbose logging. This is the single
      // line that tells you "the signal passed all gates but we
      // deliberately did not trade because an open position already
      // exists" — worth seeing.
      logger.info(`[LiveSignal] ${symbol} has open live_signal trade — skipping new entry`);
      return;
    }

    // 3. Translate signal to a KernelOrder shape.
    const atr = this.computeATR(ohlcv, ATR_PERIOD);
    const order = this.buildOrder(symbol, signal, currentPrice, atr);
    if (!order) return;

    // 4. Fetch live account state for the kernel (also returns
    //    userId + credentials so we can submit the order downstream
    //    without another DB round-trip).
    const accountCtx = await this.loadAccountContext(symbol);
    if (!accountCtx) return;
    const symbolMaxLeverage = (await getMaxLeverage(symbol)) ?? order.leverage;
    const mode = await getCurrentExecutionMode();
    const context: KernelContext = {
      isLive: mode === 'auto',
      mode,
      symbolMaxLeverage,
    };

    // 5. Blast-door kernel vetoes.
    const decision = evaluatePreTradeVetoes(order, accountCtx.state, context);
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
    await this.submitOrder(order, signal, atr, accountCtx.userId, accountCtx.credentials);
  }

  private normaliseSignal(s: unknown): 'BUY' | 'SELL' | 'HOLD' {
    const v = String(s ?? '').toUpperCase();
    if (v === 'BUY' || v === 'LONG') return 'BUY';
    if (v === 'SELL' || v === 'SHORT') return 'SELL';
    return 'HOLD';
  }

  /**
   * Lightweight regime proxy from recent price action. The ml-worker's
   * QIG regime classifier is authoritative for signal generation; this
   * proxy exists so the contextual bandit has a stable key without
   * round-tripping QIG on every tick.
   *
   * Buckets into 'trending_up' | 'trending_down' | 'ranging' based on
   * the sign and magnitude of the last-60-candle log return.
   */
  private detectSimpleRegime(ohlcv: Array<{ close: number }>): string {
    const n = Math.min(60, ohlcv.length);
    if (n < 10) return 'unknown';
    const lastClose = Number(ohlcv[ohlcv.length - 1]?.close);
    const firstClose = Number(ohlcv[ohlcv.length - n]?.close);
    if (!Number.isFinite(lastClose) || !Number.isFinite(firstClose) || firstClose <= 0) {
      return 'unknown';
    }
    const logReturn = Math.log(lastClose / firstClose);
    // 2% move over 60 candles is the rough trending/ranging boundary on 15m BTC.
    if (logReturn > 0.02) return 'trending_up';
    if (logReturn < -0.02) return 'trending_down';
    return 'ranging';
  }

  /**
   * Condense the ml-worker's reason string into a stable bandit key.
   * The reason typically looks like "regime=creator strategy=breakout".
   * We normalise to the strategy portion so the bandit learns per-
   * strategy-family, not per-unique-message.
   */
  private extractSignalKey(reason: string): string {
    const match = reason.match(/strategy=([a-zA-Z_]+)/);
    if (match) return `ml_${match[1]}`;
    // Fall back to the whole prefix before whitespace; truncate for DB column width.
    return `ml_${reason.split(/\s+/)[0] ?? 'unknown'}`.slice(0, 60);
  }

  /**
   * Load the Beta(wins, losses) posterior for this (signalKey, regime)
   * combo from bandit_class_counters. Returns the Beta(1,1) uniform
   * prior when no row exists yet.
   */
  private async loadBanditCounter(signalKey: string, regime: string): Promise<BanditCounter> {
    try {
      const result = await pool.query(
        `SELECT wins, losses FROM bandit_class_counters
          WHERE strategy_class = $1 AND regime = $2`,
        [signalKey, regime],
      );
      const row = (result.rows as Array<{ wins: unknown; losses: unknown }>)[0];
      if (!row) return { wins: 1, losses: 1 };
      return {
        wins: Number(row.wins) || 1,
        losses: Number(row.losses) || 1,
      };
    } catch (err) {
      logger.debug('[LiveSignal] loadBanditCounter failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return { wins: 1, losses: 1 };
    }
  }

  /**
   * Apply a trade outcome to the bandit posterior. Called by the
   * trade-close hook (exit-time fill reconciliation). Fail-soft: a DB
   * hiccup during outcome recording cannot break the trading loop.
   */
  async recordTradeOutcome(
    signalKey: string,
    regime: string,
    realisedPnl: number,
  ): Promise<void> {
    const winIncrement = realisedPnl > 0 ? 1 : 0;
    const lossIncrement = realisedPnl > 0 ? 0 : 1;
    try {
      await pool.query(
        `INSERT INTO bandit_class_counters (strategy_class, regime, wins, losses)
         VALUES ($1, $2, 1 + $3, 1 + $4)
         ON CONFLICT (strategy_class, regime) DO UPDATE SET
           wins = bandit_class_counters.wins + $3,
           losses = bandit_class_counters.losses + $4,
           last_updated_at = NOW()`,
        [signalKey, regime, winIncrement, lossIncrement],
      );
      logger.info('[LiveSignal] bandit updated', {
        signalKey,
        regime,
        realisedPnl,
        win: winIncrement === 1,
      });
    } catch (err) {
      logger.warn('[LiveSignal] recordTradeOutcome failed (fail-soft)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
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
   * Assemble the KernelAccountState the kernel needs + return the
   * operating userId and credentials so the caller can also submit
   * orders and record DB rows without re-loading credentials.
   *
   * Uses the authenticated Poloniex account (there's exactly one on
   * this platform at the moment).
   */
  private async loadAccountContext(symbol: string): Promise<
    | {
        state: KernelAccountState;
        userId: string;
        credentials: { apiKey: string; apiSecret: string; passphrase?: string };
      }
    | null
  > {
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
        state: {
          equityUsdt,
          unrealizedPnlUsdt,
          openPositions,
          restingOrders: [],  // Not needed for market orders; self-match prevention still runs
        },
        userId,
        credentials,
      };
    } catch (err) {
      logger.warn(`[LiveSignal] ${symbol} — failed to load account state`, {
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Place the order on the exchange, persist it to the DB, and
   * publish an outcome event for ml-worker training. Sequence:
   *
   *   1. Set per-symbol leverage on the exchange.
   *   2. Submit the market order (size in base units).
   *   3. Best-effort place reduce-only exchange-side SL + TP.
   *   4. INSERT the row into autonomous_trades with the returned
   *      orderId so positionManagement can close against it later.
   *
   * Fail-soft: an exchange error is logged and recorded to the
   * outcome event; we still record a DB row only on successful
   * placement so the reconciler doesn't see phantom opens.
   */
  private async submitOrder(
    order: KernelOrder,
    signal: LiveSignalTick,
    atr: number,
    userId: string,
    credentials: { apiKey: string; apiSecret: string; passphrase?: string },
  ): Promise<void> {
    const quantity = order.notional / order.price;
    const stopLoss = order.side === 'long'
      ? order.price - atr * ATR_STOP_MULTIPLIER
      : order.price + atr * ATR_STOP_MULTIPLIER;
    const takeProfit = order.side === 'long'
      ? order.price + atr * ATR_TAKE_PROFIT_MULTIPLIER
      : order.price - atr * ATR_TAKE_PROFIT_MULTIPLIER;
    const exchangeSide = order.side === 'long' ? 'buy' : 'sell';
    const closeSide = order.side === 'long' ? 'sell' : 'buy';

    logger.info('[LiveSignal] submitting order', {
      order,
      quantity,
      stopLoss,
      takeProfit,
      atr,
      signal,
    });

    // 1. Leverage — non-fatal if exchange rejects; order still proceeds.
    try {
      await poloniexFuturesService.setLeverage(credentials, order.symbol, order.leverage);
    } catch (levErr) {
      logger.warn('[LiveSignal] setLeverage failed (non-fatal)', {
        symbol: order.symbol,
        leverage: order.leverage,
        err: levErr instanceof Error ? levErr.message : String(levErr),
      });
    }

    // 2. Market order — this is the point of no return.
    let orderId: string | undefined;
    try {
      const exchangeOrder = await poloniexFuturesService.placeOrder(credentials, {
        symbol: order.symbol,
        side: exchangeSide,
        type: 'market',
        size: quantity,
      });
      // Poloniex v3 futures returns the exchange order id as `ordId`.
      // Keep `orderId`/`id` fallbacks so mocked tests + any future
      // adapter variants still work without changing this line.
      orderId =
        exchangeOrder?.ordId ??
        exchangeOrder?.orderId ??
        exchangeOrder?.id ??
        exchangeOrder?.clientOid;
      logger.info('[LiveSignal] exchange order placed', {
        orderId,
        rawResponseKeys: exchangeOrder ? Object.keys(exchangeOrder) : [],
        symbol: order.symbol,
        side: exchangeSide,
        size: quantity,
      });
    } catch (err) {
      logger.error('[LiveSignal] exchange placeOrder failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      await this.publishOutcomeEvent({
        symbol: order.symbol,
        phase: 'rejected',
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // 3. Best-effort exchange-side SL + TP (reduce-only). Failures
    //    are logged but don't roll back — the server-side managed
    //    loop handles SL/TP as a fallback.
    if (stopLoss > 0 && Number.isFinite(stopLoss)) {
      try {
        await poloniexFuturesService.placeOrder(credentials, {
          symbol: order.symbol,
          side: closeSide,
          type: 'stop_market',
          size: quantity,
          stopPrice: stopLoss,
          stopPriceType: 'TP',
          reduceOnly: true,
        });
      } catch (slErr) {
        logger.warn('[LiveSignal] SL placement failed (non-fatal)', {
          err: slErr instanceof Error ? slErr.message : String(slErr),
        });
      }
    }
    if (takeProfit > 0 && Number.isFinite(takeProfit)) {
      try {
        await poloniexFuturesService.placeOrder(credentials, {
          symbol: order.symbol,
          side: closeSide,
          type: 'stop_market',
          size: quantity,
          stopPrice: takeProfit,
          stopPriceType: 'TP',
          reduceOnly: true,
        });
      } catch (tpErr) {
        logger.warn('[LiveSignal] TP placement failed (non-fatal)', {
          err: tpErr instanceof Error ? tpErr.message : String(tpErr),
        });
      }
    }

    // 4. Persist. Encode bandit key + regime into `reason` so the
    //    close-hook can look them up cheaply (no schema change).
    //    Format: live_signal|key=...|regime=...|src=...
    try {
      const reasonEncoded =
        `live_signal|key=${signal.signalKey}|regime=${signal.regime}|src=${signal.reason}`;
      await pool.query(
        `INSERT INTO autonomous_trades
           (user_id, symbol, side, entry_price, quantity, leverage,
            stop_loss, take_profit, confidence, reason, order_id,
            paper_trade, engine_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          userId,
          order.symbol,
          exchangeSide,
          order.price,
          quantity,
          order.leverage,
          stopLoss,
          takeProfit,
          signal.effectiveStrength,
          reasonEncoded,
          orderId ?? null,
          false,
          getEngineVersion(),
        ],
      );
      monitoringService.recordTradeEvent('live');
    } catch (err) {
      logger.error('[LiveSignal] DB insert failed after exchange placement', {
        orderId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Fire-and-forget outcome event (fills will be reported by the
    // reconciler when they land).
    await this.publishOutcomeEvent({
      symbol: order.symbol,
      signal: signal.signal,
      strength: signal.strength,
      reason: signal.reason,
      phase: 'submitted',
      price: order.price,
      quantity,
      orderId,
    });
  }

  /**
   * Publish a trade-outcome event on the Redis channel the ml-worker
   * listens on. Online training of the ensemble lives in the Python
   * side; this method just produces the data feed. Fire-and-forget:
   * Redis outages must not block trading.
   */
  private async publishOutcomeEvent(payload: Record<string, unknown>): Promise<void> {
    try {
      await mlPredictionService.publishTradeOutcome({
        ...payload,
        engineVersion: getEngineVersion(),
      });
    } catch (err) {
      logger.debug('[LiveSignal] outcome publish failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const liveSignalEngine = new LiveSignalEngine();
