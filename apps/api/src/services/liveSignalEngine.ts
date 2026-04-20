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
import { getMaxLeverage, getPrecisions } from './marketCatalog.js';
import mlPredictionService from './mlPredictionService.js';
import { monitoringService } from './monitoringService.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import {
  bucketOfLeverage,
  sampleBeta,
  type BanditCounter,
  type LeverageBucket,
} from './thompsonBandit.js';
import { monkeyKernel } from './monkey/loop.js';
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

/**
 * Base leverage applied to the order before the symbol-max catalog cap.
 * At small account sizes the critical constraint is lot-size × price —
 * e.g. BTC lotSize=0.001 @ $75k = $75 minNotional per lot. A $5 position
 * at 3x leverage is only $15 notional, which rounds to 0 lots. Higher
 * leverage is how a $27 account ever places a compliant BTC order.
 * Risk kernel still caps at symbolMaxLeverage (100× BTC, varies by alt).
 */
const DEFAULT_LEVERAGE = Number(process.env.LIVE_LEVERAGE) || 3;

/** ATR-scaling: stop = ATR × this, take-profit = ATR × this × 2. */
const ATR_STOP_MULTIPLIER = 1.5;
const ATR_TAKE_PROFIT_MULTIPLIER = 3.0;

/** How many recent candles to use for the ATR calculation. */
const ATR_PERIOD = 14;

/**
 * ML-driven exit: close an open position when the current ML signal
 * flips to the opposite direction with this much conviction. Mirrors
 * the entry MIN_SIGNAL_STRENGTH — same "the ML trusts the direction"
 * threshold used for opens applies to closes. Without this, exits
 * relied solely on ATR stops, so stacked losing positions sat bleeding
 * for 14 hours while ML kept predicting BUY (2026-04-19 incident).
 */
const EXIT_SIGNAL_STRENGTH = Number(process.env.LIVE_EXIT_STRENGTH) || 0.35;

/**
 * Kill-switch auto-flatten threshold. When total unrealized P&L as
 * a fraction of equity drops below this, close ALL open positions and
 * force execution_mode=pause. The risk kernel already vetoes NEW
 * orders at this threshold via checkUnrealizedDrawdown; this carries
 * out the "flatten and pause 24h" promise the kernel message makes
 * but previously had no code behind. Threshold stays symmetric with
 * the kernel's UNREALIZED_DRAWDOWN_KILL_THRESHOLD (-15%).
 */
const KILL_SWITCH_DD_THRESHOLD = -0.15;

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
  readonly leverageBucket: LeverageBucket;
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
  /**
   * Row IDs already fed to the bandit. Prevents re-feeding the same
   * closed trade when multiple rows share an exit_time (e.g. kill-
   * switch flatten closing 5 positions in one transaction all got
   * exit_time=NOW(); millisecond-precision JS Date vs microsecond-
   * precision Postgres timestamp lets the `> lastReconcileAt` filter
   * mis-match-match on the next tick).
   *
   * Bounded to the 500 most-recent IDs via FIFO eviction — keeps
   * memory flat while covering the window needed for close→tick
   * cycles (liveSignal runs 60s, so 500 entries covers 8h+ of trades).
   */
  private processedBanditIds: Set<string> = new Set();
  private processedBanditIdsOrder: string[] = [];
  private static readonly PROCESSED_BANDIT_IDS_MAX = 500;

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

      // Second: kill-switch auto-flatten. Runs regardless of
      // execution_mode because it's safety, not strategy. The kernel's
      // checkUnrealizedDrawdown already vetoes new orders at this
      // threshold; this method carries out the "flatten" promise that
      // the kernel message implies but previously had no code behind.
      // 2026-04-19 incident: 5 stacked longs sat at -41.84% DD for
      // hours because veto blocked new orders but nothing closed
      // existing ones.
      await this.checkAutoFlatten();

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
   * Kill-switch auto-flatten. On every tick, check total unrealized
   * P&L / equity. If it's below KILL_SWITCH_DD_THRESHOLD (-15%),
   * call closeAllPositions + force execution_mode=pause with an
   * audit reason. Idempotent — if no positions are open, it's a
   * no-op.
   *
   * Intentionally simple: close everything, let the human review.
   * Partial flattening, halving, or scaling out would be strategy;
   * this is a safety floor.
   */
  private async checkAutoFlatten(): Promise<void> {
    try {
      const userRow = await pool.query(
        `SELECT user_id FROM user_api_credentials WHERE exchange = 'poloniex' LIMIT 1`,
      );
      const userId = (userRow.rows[0] as { user_id?: string } | undefined)?.user_id;
      if (!userId) return;

      const credentials = await apiCredentialsService.getCredentials(userId, 'poloniex');
      if (!credentials) return;

      const balance = await poloniexFuturesService.getAccountBalance(credentials);
      const equity = Number(balance?.totalBalance ?? balance?.eq ?? 0);
      const upl = Number(balance?.unrealizedPnL ?? balance?.upl ?? 0);
      if (!Number.isFinite(equity) || equity <= 0) return;
      const ddRatio = upl / equity;

      if (ddRatio <= KILL_SWITCH_DD_THRESHOLD) {
        logger.error('[LiveSignal] kill-switch auto-flatten TRIGGERED', {
          equity,
          upl,
          ddRatio,
          threshold: KILL_SWITCH_DD_THRESHOLD,
        });
        try {
          await poloniexFuturesService.closeAllPositions(credentials);
          logger.error('[LiveSignal] all positions closed via kill-switch');
        } catch (closeErr) {
          logger.error('[LiveSignal] kill-switch closeAllPositions failed — positions may still be open', {
            err: closeErr instanceof Error ? closeErr.message : String(closeErr),
          });
        }
        // Close any open live_signal DB rows too, so stacking guard + reconciler
        // see the correct state on next tick.
        try {
          await pool.query(
            `UPDATE autonomous_trades
                SET status = 'closed', exit_time = NOW(),
                    exit_reason = 'kill_switch_auto_flatten',
                    pnl = COALESCE(pnl, 0)
              WHERE user_id = $1 AND status = 'open' AND reason LIKE 'live_signal|%'`,
            [userId],
          );
        } catch { /* non-fatal */ }
        // Force pause so no new orders fire until a human resumes.
        try {
          await pool.query(
            `UPDATE agent_execution_mode
                SET mode = 'pause', updated_by = 'kill_switch', updated_at = NOW(),
                    reason = $1
              WHERE id = 1`,
            [`Auto-flatten at DD=${(ddRatio * 100).toFixed(2)}% <= ${(KILL_SWITCH_DD_THRESHOLD * 100).toFixed(0)}% threshold`],
          );
        } catch { /* non-fatal */ }
      }
    } catch (err) {
      logger.warn('[LiveSignal] checkAutoFlatten failed (fail-soft)', {
        err: err instanceof Error ? err.message : String(err),
      });
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
        `SELECT id, symbol, reason, pnl, entry_time, exit_time, exit_price, entry_price, quantity, exit_reason, leverage, side, order_id
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
        // Row-ID dedup: Postgres timestamps have microsecond precision
        // and JS Date only millisecond precision, so `exit_time >
        // lastReconcileAt` can re-match the same row if the timestamp
        // has sub-ms digits lost on the round-trip. Additionally, batch
        // closes (e.g. kill-switch flatten) give multiple rows the
        // identical exit_time=NOW() — those would all re-feed every
        // tick without this guard. 2026-04-20 incident: 5 bulk-closed
        // rows fed the bandit 5 losses per tick for an unbounded time.
        const rowId = String(row.id ?? '');
        if (rowId && this.processedBanditIds.has(rowId)) {
          continue;
        }
        const reason = String(row.reason ?? '');
        const keyMatch = reason.match(/key=([^|]+)/);
        const regimeMatch = reason.match(/regime=([^|]+)/);
        const levMatch = reason.match(/lev=([a-z]+)/);
        const signalKey = keyMatch?.[1];
        const regime = regimeMatch?.[1];
        // Prefer the encoded lev= token (survives schema changes to the
        // leverage column); fall back to bucketing the row's leverage
        // column for legacy rows that were inserted before this field
        // was encoded in reason. Final fallback: 'mid' (same default as
        // the migration).
        let leverageBucket: LeverageBucket;
        if (levMatch && (['low', 'mid', 'high'] as const).includes(levMatch[1] as LeverageBucket)) {
          leverageBucket = levMatch[1] as LeverageBucket;
        } else {
          const rowLeverage = Number(row.leverage);
          leverageBucket = Number.isFinite(rowLeverage) && rowLeverage > 0
            ? bucketOfLeverage(rowLeverage)
            : 'mid';
        }
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
          await this.recordTradeOutcome(signalKey, regime, leverageBucket, pnl);
          // Push a 'closed' outcome event to the ml-worker too.
          await this.publishOutcomeEvent({
            symbol: row.symbol,
            phase: 'closed',
            signalKey,
            regime,
            leverageBucket,
            realizedPnl: pnl,
            entryPrice: Number(row.entry_price ?? 0),
            exitPrice: Number(row.exit_price ?? 0),
            quantity: Number(row.quantity ?? 0),
            closedAt: closedAt.toISOString(),
          });
          // Monkey witness (v0.2): attribute this real P&L to the
          // perception basin Monkey held at entry — bootstraps her
          // resonance bank from already-running trades without new
          // capital risk. Fire-and-forget; her bank is best-effort.
          const entryTimeRaw = row.entry_time;
          const entryTime = entryTimeRaw ? new Date(entryTimeRaw as string | Date) : null;
          if (entryTime && !Number.isNaN(entryTime.getTime())) {
            const sideStr = String(row.side ?? '').toLowerCase();
            const side: 'long' | 'short' = sideStr === 'sell' || sideStr === 'short' ? 'short' : 'long';
            void monkeyKernel.witnessExit(
              String(row.symbol),
              entryTime,
              pnl,
              row.order_id ? String(row.order_id) : null,
              side,
            );
          }
        } else if (isReconcilerClose) {
          logger.debug('[LiveSignal] skipping bandit update for reconciler-closed row', {
            symbol: row.symbol,
            exitReason,
            pnl,
          });
        }

        // Mark this row as processed regardless of which branch we took
        // — even skipped rows shouldn't be revisited. FIFO-bound the
        // Set so memory stays flat over long uptimes.
        if (rowId) {
          this.processedBanditIds.add(rowId);
          this.processedBanditIdsOrder.push(rowId);
          if (this.processedBanditIdsOrder.length > LiveSignalEngine.PROCESSED_BANDIT_IDS_MAX) {
            const evicted = this.processedBanditIdsOrder.shift();
            if (evicted) this.processedBanditIds.delete(evicted);
          }
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

    // 2a. Contextual bandit: extract (signalKey, regime, leverageBucket)
    //     and sample Beta posterior. Below BANDIT_EXPLORATION_TRADES total
    //     trades for this combo, we let everything through (exploration).
    //     Once we have enough data, the posterior gates the signal.
    //
    //     leverageBucket is derived from the prospective order leverage —
    //     buildOrder uses the same default, so the bucket we gate on
    //     matches the bucket the trade would actually execute at.
    const regime = this.detectSimpleRegime(ohlcv);
    const signalKey = this.extractSignalKey(rawReason);
    const prospectiveLeverage = this.prospectiveLeverage();
    const leverageBucket = bucketOfLeverage(prospectiveLeverage);
    const counter = await this.loadBanditCounter(signalKey, regime, leverageBucket);
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
      leverageBucket,
      banditPosterior,
      effectiveStrength,
    };
    this.emit('signal', signal);

    // 2b. Fetch exchange state up front. Used for both the ML-driven
    //     exit check and the stacking guard. Exchange is authoritative:
    //     the DB had phantom rows through most of 2026-04-19, and
    //     time-bounded-DB guards let stacked losing positions
    //     accumulate for 14 hours. Exchange state is ground truth.
    const accountCtx = await this.loadAccountContext(symbol);
    if (!accountCtx) return;
    const existingPos = accountCtx.state.openPositions.find((p) => p.symbol === symbol);

    // 2c. ML-driven exit. If we already hold a position on this
    //     symbol and the current ML signal flips to the opposite
    //     direction with entry-level conviction, close the position.
    //     Mirrors entry logic — same threshold that opens a trade
    //     also closes one when reversed. Without this, exits relied
    //     solely on ATR-scaled SL/TP bands, which is why the 5
    //     stacked longs on 2026-04-19 sat bleeding for 14 hours
    //     while ML kept saying BUY and price dropped ~3%.
    if (existingPos) {
      const isLongHeld = existingPos.side === 'long';
      const isShortHeld = existingPos.side === 'short';
      const signalsFlip = (isLongHeld && signal.signal === 'SELL') ||
                          (isShortHeld && signal.signal === 'BUY');
      if (signalsFlip && signal.strength >= EXIT_SIGNAL_STRENGTH) {
        logger.info('[LiveSignal] ML-driven exit — signal flipped', {
          symbol,
          held: existingPos.side,
          signalNow: signal.signal,
          strength: signal.strength,
          threshold: EXIT_SIGNAL_STRENGTH,
        });
        await this.closeExistingPosition(
          symbol,
          existingPos.side,
          'ml_signal_flip',
          accountCtx.credentials,
          signal.signalKey,
          signal.regime,
          signal.leverageBucket,
        );
        return;
      }
      // Hold: position exists + signal doesn't warrant exit.
      logger.info(`[LiveSignal] ${symbol} holding — position open, signal ${signal.signal}@${signal.strength.toFixed(3)} does not warrant exit`);
      return;
    }

    // 2d. No existing exchange position — normal entry flow from here.
    if (signal.signal === 'HOLD' || signal.strength < MIN_SIGNAL_STRENGTH) {
      logger.debug(`[LiveSignal] ${symbol} hold`, signal);
      return;
    }

    // 2e. Bandit gate. Active only once we have enough trials; until
    //     then we let raw strength speak for itself (exploration phase).
    if (banditActive && banditPosterior < BANDIT_MIN_POSTERIOR) {
      logger.info(`[LiveSignal] ${symbol} bandit gate`, {
        signalKey,
        regime,
        leverageBucket,
        banditPosterior: banditPosterior.toFixed(3),
        wins: counter.wins,
        losses: counter.losses,
        rawStrength: rawStrength.toFixed(3),
      });
      return;
    }

    // 3. Translate signal to a KernelOrder shape.
    const atr = this.computeATR(ohlcv, ATR_PERIOD);
    const order = this.buildOrder(symbol, signal, currentPrice, atr);
    if (!order) return;

    // 4. Build kernel context from the already-fetched accountCtx.
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
   * Load the Beta(wins, losses) posterior for this
   * (signalKey, regime, leverageBucket) combo from
   * bandit_class_counters. Returns the Beta(1,1) uniform prior when
   * no row exists yet.
   */
  private async loadBanditCounter(
    signalKey: string,
    regime: string,
    leverageBucket: LeverageBucket,
  ): Promise<BanditCounter> {
    try {
      const result = await pool.query(
        `SELECT wins, losses FROM bandit_class_counters
          WHERE strategy_class = $1 AND regime = $2 AND leverage_bucket = $3`,
        [signalKey, regime, leverageBucket],
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
    leverageBucket: LeverageBucket,
    realisedPnl: number,
  ): Promise<void> {
    const winIncrement = realisedPnl > 0 ? 1 : 0;
    const lossIncrement = realisedPnl > 0 ? 0 : 1;
    try {
      await pool.query(
        `INSERT INTO bandit_class_counters (strategy_class, regime, leverage_bucket, wins, losses)
         VALUES ($1, $2, $3, 1 + $4, 1 + $5)
         ON CONFLICT (strategy_class, regime, leverage_bucket) DO UPDATE SET
           wins = bandit_class_counters.wins + $4,
           losses = bandit_class_counters.losses + $5,
           last_updated_at = NOW()`,
        [signalKey, regime, leverageBucket, winIncrement, lossIncrement],
      );
      logger.info('[LiveSignal] bandit updated', {
        signalKey,
        regime,
        leverageBucket,
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

  /**
   * The leverage we expect to trade at, computed before buildOrder so
   * the bandit gate can key on its bucket. Must stay in lock-step with
   * buildOrder's `leverage` assignment — keeping it in one place
   * prevents a mismatch between the posterior we gate on and the
   * posterior we update.
   */
  private prospectiveLeverage(): number {
    return DEFAULT_LEVERAGE;
  }

  private buildOrder(
    symbol: string,
    signal: LiveSignalTick,
    price: number,
    atr: number,
  ): KernelOrder | null {
    const side = signal.signal === 'BUY' ? 'long' : 'short';
    const leverage = this.prospectiveLeverage();
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
  /**
   * Close the existing Poloniex position for a symbol via the v3
   * close-position endpoint, and mark any matching open DB rows as
   * closed. The exchange side of this is one call — Poloniex nets
   * stacked same-side entries into one position per symbol, and
   * `/v3/trade/position` with `type=close_long` or `close_short`
   * closes the full net position at market.
   *
   * Called on ML-driven signal flip from processSymbol. Also feeds
   * the bandit via recordTradeOutcome — exit P&L from reconciler
   * will finish the feedback loop once the close fills and the
   * next reconcileClosedTrades picks it up. Here we pre-emit the
   * 'close_initiated' event so the ml-worker knows.
   */
  private async closeExistingPosition(
    symbol: string,
    heldSide: 'long' | 'short',
    closeReason: string,
    credentials: { apiKey: string; apiSecret: string; passphrase?: string },
    signalKey: string,
    regime: string,
    leverageBucket: LeverageBucket,
  ): Promise<void> {
    const closeType = heldSide === 'long' ? 'close_long' : 'close_short';
    try {
      const resp = await poloniexFuturesService.closePosition(credentials, symbol, closeType);
      logger.info('[LiveSignal] position close submitted', {
        symbol,
        heldSide,
        closeType,
        closeReason,
        exchangeResp: resp,
      });
    } catch (err) {
      logger.error('[LiveSignal] closePosition failed', {
        symbol,
        err: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Flip matching DB rows to closed. The reconciler would catch
    // them on its next cycle anyway, but being prompt keeps the
    // dashboard honest.
    try {
      await pool.query(
        `UPDATE autonomous_trades
            SET status = 'closed', exit_time = NOW(),
                exit_reason = $2,
                pnl = COALESCE(pnl, 0)
          WHERE symbol = $1
            AND status = 'open'
            AND reason LIKE 'live_signal|%'`,
        [symbol, closeReason],
      );
    } catch (err) {
      logger.warn('[LiveSignal] DB close-row update failed (reconciler will catch up)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    await this.publishOutcomeEvent({
      symbol,
      phase: 'close_initiated',
      reason: closeReason,
      signalKey,
      regime,
      leverageBucket,
    });
  }

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

    // Round quantity to the symbol's lot-size step. Poloniex v3 rejects
    // sub-lot orders with `Param error sz` — diagnosed 2026-04-19 when
    // the PR #506 error surfacer finally showed the real reason every
    // tick's "exchange order placed" was actually failing silently.
    // At $2 notional × 3x leverage = $6, which is below 1 BTC contract
    // (~$7.6) and well below 1 ETH contract (~$23.6) — so lot rounding
    // produces 0 contracts and we skip. The fullyAutonomousTrader path
    // already uses this pattern.
    let formattedSize = quantity;
    let symbolLotSize = 0;
    try {
      const precisions = await getPrecisions(order.symbol);
      if (precisions.lotSize && precisions.lotSize > 0) {
        symbolLotSize = precisions.lotSize;
        formattedSize = Math.floor(quantity / precisions.lotSize) * precisions.lotSize;
      }
    } catch (err) {
      logger.warn('[LiveSignal] getPrecisions failed, using raw quantity', {
        symbol: order.symbol,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    if (formattedSize <= 0) {
      logger.info('[LiveSignal] size below lot minimum — skipping', {
        symbol: order.symbol,
        rawQuantity: quantity,
        notionalUsdt: order.notional,
        hint: 'Raise LIVE_POSITION_USDT or use higher leverage to clear min contract notional',
      });
      await this.publishOutcomeEvent({
        symbol: order.symbol,
        phase: 'skipped',
        reason: 'size_below_lot_minimum',
        rawQuantity: quantity,
        notionalUsdt: order.notional,
      });
      return;
    }

    logger.info('[LiveSignal] submitting order', {
      order,
      rawQuantity: quantity,
      formattedSize,
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
        size: formattedSize,
        lotSize: symbolLotSize,
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
        size: formattedSize,
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
    // Stop-market trigger orders currently fall back to MARKET in the
    // placeOrder body mapping — they aren't true trigger orders until we
    // wire the dedicated Poloniex v3 trigger-order endpoint. Skipping
    // SL/TP exchange-side placement for now; managePositions in the
    // trader loop catches SL/TP on the backend side. Leaving the block
    // for future re-enablement once the trigger endpoint is plumbed.
    if (false && stopLoss > 0 && Number.isFinite(stopLoss)) {
      try {
        await poloniexFuturesService.placeOrder(credentials, {
          symbol: order.symbol,
          side: closeSide,
          type: 'stop_market',
          size: formattedSize,
          lotSize: symbolLotSize,
          reduceOnly: true,
        });
      } catch (slErr) {
        logger.warn('[LiveSignal] SL placement failed (non-fatal)', {
          err: slErr instanceof Error ? slErr.message : String(slErr),
        });
      }
    }
    if (false && takeProfit > 0 && Number.isFinite(takeProfit)) {
      try {
        await poloniexFuturesService.placeOrder(credentials, {
          symbol: order.symbol,
          side: closeSide,
          type: 'stop_market',
          size: formattedSize,
          lotSize: symbolLotSize,
          reduceOnly: true,
        });
      } catch (tpErr) {
        logger.warn('[LiveSignal] TP placement failed (non-fatal)', {
          err: tpErr instanceof Error ? tpErr.message : String(tpErr),
        });
      }
    }

    // 4. Persist. Encode bandit key + regime + leverage bucket into
    //    `reason` so the close-hook can look them up cheaply (no schema
    //    change). Encoding the bucket lets the reconciler recover it
    //    even if the leverage column is null on some legacy row.
    //    Format: live_signal|key=...|regime=...|lev=...|src=...
    try {
      const reasonEncoded =
        `live_signal|key=${signal.signalKey}|regime=${signal.regime}|lev=${signal.leverageBucket}|src=${signal.reason}`;
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
          formattedSize,
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
      quantity: formattedSize,
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
