/**
 * Parallel Strategy Runner
 *
 * Manages concurrent paper trading execution for up to N strategies simultaneously.
 * Each strategy has isolated position tracking and virtual capital proportional
 * to backtest Sharpe ratio (Kelly Criterion-inspired allocation).
 *
 * QIG design decisions:
 *  - Phase clock trajectory tracking (not just threshold crossings)
 *  - Censoring flags propagated from paperTradingService
 *  - Continuous confidence, never binary
 *  - Capital allocation = Kelly fraction scaled by Sharpe ratio
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import paperTradingService from './paperTradingService.js';
import { query } from '../db/connection.js';
import type { StrategyRecord } from './strategyLearningEngine.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyMetrics {
  strategyId: string;
  sessionId: string | null;
  sharpe: number;
  winRate: number;
  pnl: number;
  trades: number;
  maxDrawdown: number;
  isCensored: boolean;
  censorReason: string | null;
  uncensoredSharpe: number | null;
  equityCurve: number[];
  lastUpdated: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Max strategies running paper trading concurrently */
const MAX_PARALLEL_SLOTS = 10;

/** Base virtual capital for paper trading (USDT) */
const BASE_VIRTUAL_CAPITAL = 1000;

/** Kill drawdown threshold per strategy (reserved for future kill logic) */
const _KILL_DRAWDOWN_THRESHOLD = 0.10; // 10%

/** Minimum Sharpe before soft-kill (reserved for future kill logic) */
const _KILL_MIN_SHARPE = 0;

/** Minimum trades before Sharpe evaluation (reserved for future kill logic) */
const _MIN_TRADES_FOR_KILL = 50;

// ─────────────────────────────────────────────────────────────────────────────
// ParallelStrategyRunner
// ─────────────────────────────────────────────────────────────────────────────

class ParallelStrategyRunner extends EventEmitter {
  /** Live session mapping: strategyId → metrics */
  private sessions: Map<string, StrategyMetrics> = new Map();

  /** Queue for strategies waiting for an open slot */
  private waitingQueue: StrategyRecord[] = [];

  constructor() {
    super();
  }

  // ─────────────────────────── slot management ──────────────────────────────

  /** Add a strategy to the parallel runner. Respects MAX_PARALLEL_SLOTS. */
  async addStrategy(strategy: StrategyRecord): Promise<boolean> {
    if (this.sessions.size >= MAX_PARALLEL_SLOTS) {
      // Queue instead of silently dropping
      if (!this.waitingQueue.find(s => s.strategyId === strategy.strategyId)) {
        this.waitingQueue.push(strategy);
        logger.info(`[PSR] Slots full (${MAX_PARALLEL_SLOTS}), queued ${strategy.strategyId} (queue size: ${this.waitingQueue.length})`);
      }
      return false;
    }

    if (this.sessions.has(strategy.strategyId)) {
      logger.debug(`[PSR] Strategy ${strategy.strategyId} already running`);
      return true;
    }

    try {
      // Allocate virtual capital proportional to backtest Sharpe (min 10% of base)
      const sharpe = strategy.backtestSharpe ?? 0.5;
      const capitalMultiplier = Math.max(0.1, Math.min(2.0, sharpe)); // cap at 2×
      const virtualCapital = BASE_VIRTUAL_CAPITAL * capitalMultiplier;

      // Create isolated paper trading session
      const session = await paperTradingService.createSession({
        name: `PSR_${strategy.strategyId}`,
        strategyName: strategy.strategyId,
        symbol: strategy.symbol,
        timeframe: strategy.timeframe,
        initialCapital: virtualCapital,
        leverage: strategy.leverage,
        strategy: {
          type: strategy.strategyType,
          parameters: {},
        },
      });

      const metrics: StrategyMetrics = {
        strategyId: strategy.strategyId,
        sessionId: session.id,
        sharpe: 0,
        winRate: 0,
        pnl: 0,
        trades: 0,
        maxDrawdown: 0,
        isCensored: false,
        censorReason: null,
        uncensoredSharpe: null,
        equityCurve: [virtualCapital],
        lastUpdated: new Date(),
      };

      this.sessions.set(strategy.strategyId, metrics);
      logger.info(`[PSR] Started paper session ${session.id} for strategy ${strategy.strategyId} (capital=$${virtualCapital.toFixed(0)})`);
      this.emit('strategyAdded', { strategyId: strategy.strategyId, sessionId: session.id });
      return true;
    } catch (err) {
      logger.error(`[PSR] Failed to add strategy ${strategy.strategyId}:`, err);
      return false;
    }
  }

  /** Remove a strategy from the runner, optionally recording kill reason. */
  async removeStrategy(strategyId: string, killReason?: string): Promise<void> {
    const metrics = this.sessions.get(strategyId);
    if (!metrics) return;

    try {
      if (metrics.sessionId) {
        await paperTradingService.stopSession(metrics.sessionId);
      }
    } catch (err) {
      logger.warn(`[PSR] Error stopping session ${metrics.sessionId}:`, err);
    }

    this.sessions.delete(strategyId);
    logger.info(`[PSR] Removed strategy ${strategyId}${killReason ? ` (${killReason})` : ''}`);
    this.emit('strategyRemoved', { strategyId, killReason });

    // Try to add next queued strategy
    if (this.waitingQueue.length > 0) {
      const next = this.waitingQueue.shift()!;
      logger.info(`[PSR] Slot freed, adding queued strategy ${next.strategyId}`);
      // Fire and forget — addStrategy will handle errors
      this.addStrategy(next).catch(err => {
        logger.error(`[PSR] Failed to add queued strategy ${next.strategyId}:`, err);
      });
    }
  }

  // ─────────────────────────── metrics retrieval ────────────────────────────

  /** Get current metrics for a strategy. Returns null if not tracked. */
  async getStrategyMetrics(strategyId: string): Promise<StrategyMetrics | null> {
    const cached = this.sessions.get(strategyId);
    if (!cached || !cached.sessionId) return null;

    try {
      // Refresh from DB
      const result = await query(`
        SELECT
          pts.current_value,
          pts.initial_capital,
          pts.realized_pnl,
          pts.unrealized_pnl,
          pts.total_trades,
          pts.winning_trades,
          pts.is_censored,
          pts.censor_reason
        FROM paper_trading_sessions pts
        WHERE pts.id = $1
      `, [cached.sessionId]);

      if (!result.rows.length) return cached;

      const row = result.rows[0] as unknown as {
        initial_capital: unknown;
        current_value: unknown;
        realized_pnl: unknown;
        unrealized_pnl: unknown;
        total_trades: unknown;
        winning_trades: unknown;
        is_censored: unknown;
        censor_reason: unknown;
      };
      const initialCapital = Number(row.initial_capital) || BASE_VIRTUAL_CAPITAL;
      const currentValue = Number(row.current_value) || initialCapital;
      const pnl = Number(row.realized_pnl) + Number(row.unrealized_pnl);
      const totalTrades = Number(row.total_trades) || 0;
      const winningTrades = Number(row.winning_trades) || 0;
      const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;

      // Update equity curve
      const curve = [...cached.equityCurve, currentValue];
      if (curve.length > 200) curve.splice(0, curve.length - 200); // keep last 200 points

      const maxDrawdown = this.computeMaxDrawdown(curve, initialCapital);
      const sharpe = this.computeRollingSharpeFast(curve);

      // Compute uncensored Sharpe (exclude forced-close points)
      const isCensored = Boolean(row.is_censored);
      const uncensoredSharpe = isCensored ? null : sharpe;

      cached.pnl = Number(isFinite(pnl) ? pnl : 0);
      cached.trades = totalTrades;
      cached.winRate = winRate;
      cached.sharpe = sharpe;
      cached.maxDrawdown = maxDrawdown;
      cached.isCensored = isCensored;
      cached.censorReason = row.censor_reason != null ? String(row.censor_reason) : null;
      cached.uncensoredSharpe = uncensoredSharpe;
      cached.equityCurve = curve;
      cached.lastUpdated = new Date();

      return cached;
    } catch (err) {
      logger.warn(`[PSR] Failed to refresh metrics for ${strategyId}:`, err);
      return cached;
    }
  }

  /** Get metrics for all active strategies */
  async getAllMetrics(): Promise<StrategyMetrics[]> {
    const results: StrategyMetrics[] = [];
    for (const strategyId of this.sessions.keys()) {
      const m = await this.getStrategyMetrics(strategyId);
      if (m) results.push(m);
    }
    return results;
  }

  get activeCount(): number {
    return this.sessions.size;
  }

  get availableSlots(): number {
    return MAX_PARALLEL_SLOTS - this.sessions.size;
  }

  getQueueSize(): number {
    return this.waitingQueue.length;
  }

  // ─────────────────────────── financial maths ─────────────────────────────

  private computeMaxDrawdown(curve: number[], initialCapital: number): number {
    if (curve.length < 2) return 0;
    let peak = initialCapital;
    let maxDD = 0;
    for (const v of curve) {
      if (v > peak) peak = v;
      const dd = (peak - v) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
  }

  /**
   * Fast rolling Sharpe estimate from equity curve.
   * Uses log returns over the curve; annualised assuming ~288 5-minute bars/day.
   */
  private computeRollingSharpeFast(curve: number[]): number {
    if (curve.length < 5) return 0;
    const recent = curve.slice(-50); // last 50 data points
    const logReturns: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      const r = recent[i - 1] > 0 ? Math.log(recent[i] / recent[i - 1]) : 0;
      logReturns.push(r);
    }
    if (logReturns.length < 4) return 0;
    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / logReturns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return 0;
    const annualisationFactor = Math.sqrt(288 * 252); // 5-minute bars
    return (mean / stdDev) * annualisationFactor;
  }

  // ─────────────────────────── status ──────────────────────────────────────

  getStatus() {
    return {
      activeStrategies: this.sessions.size,
      maxSlots: MAX_PARALLEL_SLOTS,
      availableSlots: this.availableSlots,
      strategies: Array.from(this.sessions.values()).map(m => ({
        strategyId: m.strategyId,
        sessionId: m.sessionId,
        sharpe: m.sharpe,
        winRate: m.winRate,
        pnl: m.pnl,
        trades: m.trades,
        isCensored: m.isCensored,
        lastUpdated: m.lastUpdated,
      })),
    };
  }
}

export const parallelStrategyRunner = new ParallelStrategyRunner();
export default parallelStrategyRunner;
