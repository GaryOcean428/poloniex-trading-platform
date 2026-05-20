/**
 * aggregate_peak.ts — Cross-kernel aggregate-PnL peak tracker.
 *
 * Problem this solves
 * -------------------
 * Each kernel instance (monkey-position + monkey-swing) and each agent
 * (K + T) maintain INDEPENDENT peak-PnL state for their own subset of a
 * user-facing position. A single position holding $3+ unrealized profit
 * is split across multiple subsets — each subset only sees $0.50-$1.50
 * peak. The per-subset peak never crosses the harvest activation
 * threshold (whether % or absolute USD), so no harvest fires, and the
 * market reverses through the per-subset turtle stops for a net loss.
 *
 * Operator observation 2026-05-19: kernel "missed a $3" win because of
 * exactly this fragmentation. Operator directive: "they already should
 * have bus and basin sync and talk and decide together anyway."
 *
 * Design
 * ------
 * In-process singleton. FAT (which already iterates aggregate positions
 * every cycle and computes unrealizedPnL per symbol + side) updates the
 * tracker each tick. Monkey kernels' shouldProfitHarvest path reads the
 * AGGREGATE peak instead of the per-subset peak, so the harvest gate
 * fires when the user-facing position hits the operator's threshold —
 * regardless of how it's split internally.
 *
 * Each kernel still closes its OWN subset on the exit decision. With
 * all kernels seeing the same aggregate peak + giveback floor, they
 * fire roughly simultaneously, and the total closed ≈ the aggregate
 * peak the operator saw on screen.
 *
 * No new DB tables, no extra latency — monkey-position and monkey-swing
 * share the same Node process so an in-memory singleton is the cleanest
 * sync surface. For multi-process kernel deployments (future), this
 * module would migrate to a Redis-backed table or a basin_sync_db
 * sibling.
 */

import { logger } from '../../utils/logger.js';

export type PositionSide = 'long' | 'short';

interface AggregatePeakRecord {
  peakPnlUsdt: number;
  lastPnlUsdt: number;
  peakObservedAt: number;
  /** When FAT first observed this (symbol, side) — proxy for position
   *  age, consumed by the cross-kernel slow-bleed exit. Survives DCA
   *  adds (the aggregate position persists); reset only by clearOnClose. */
  firstObservedAt: number;
  updatedAt: number;
}

class AggregatePeakTracker {
  private records: Map<string, AggregatePeakRecord> = new Map();

  private static key(symbol: string, side: PositionSide): string {
    return `${symbol}|${side}`;
  }

  /**
   * Record an aggregate-PnL observation for (symbol, side). Updates the
   * peak if the current observation exceeds it. Always refreshes
   * lastPnlUsdt + updatedAt.
   *
   * Caller: FAT's per-position loop (it already has the aggregate
   * unrealized PnL per position direction).
   */
  recordTick(symbol: string, side: PositionSide, currentPnlUsdt: number): void {
    const k = AggregatePeakTracker.key(symbol, side);
    const now = Date.now();
    const existing = this.records.get(k);

    if (!existing) {
      this.records.set(k, {
        peakPnlUsdt: currentPnlUsdt,
        lastPnlUsdt: currentPnlUsdt,
        peakObservedAt: now,
        firstObservedAt: now,
        updatedAt: now,
      });
      return;
    }

    existing.lastPnlUsdt = currentPnlUsdt;
    existing.updatedAt = now;
    if (currentPnlUsdt > existing.peakPnlUsdt) {
      existing.peakPnlUsdt = currentPnlUsdt;
      existing.peakObservedAt = now;
    }
  }

  /**
   * Read the aggregate peak for (symbol, side). Returns null when no
   * observation has been recorded — caller should fall back to its own
   * per-subset peak tracking in that case.
   */
  getPeak(symbol: string, side: PositionSide): number | null {
    const r = this.records.get(AggregatePeakTracker.key(symbol, side));
    return r ? r.peakPnlUsdt : null;
  }

  /**
   * Age of the aggregate position in ms — `now - firstObservedAt`.
   * Returns null when no record exists. Proxy for position hold time,
   * consumed by the cross-kernel slow-bleed exit (a position FAT has
   * been watching for >60min that's still red is "the move isn't
   * coming"). FAT's observe cadence (~per cycle) means firstObservedAt
   * lags the true exchange-open by at most one cycle.
   */
  getAgeMs(symbol: string, side: PositionSide): number | null {
    const r = this.records.get(AggregatePeakTracker.key(symbol, side));
    return r ? Date.now() - r.firstObservedAt : null;
  }

  /**
   * Read the most recent observed PnL. Useful for stale-detection and
   * telemetry; harvest decisions should rely on the live per-tick PnL
   * the kernel computes, not this cached value.
   */
  getLastPnl(symbol: string, side: PositionSide): number | null {
    const r = this.records.get(AggregatePeakTracker.key(symbol, side));
    return r ? r.lastPnlUsdt : null;
  }

  /**
   * Drop the record for a closed position. Called when the aggregate
   * qty hits zero (no exchange position on that side anymore). Without
   * this the peak persists across re-opens — a new position opens after
   * a close, the kernel reads a stale peak, and harvest can fire on
   * the first tick of a brand-new position.
   */
  clearOnClose(symbol: string, side: PositionSide): void {
    const k = AggregatePeakTracker.key(symbol, side);
    if (this.records.delete(k)) {
      logger.debug('[AggregatePeak] cleared on close', { symbol, side });
    }
  }

  /**
   * Telemetry snapshot — useful for /api/monkey/state endpoints or
   * test introspection.
   */
  snapshot(): Array<{
    symbol: string;
    side: PositionSide;
    peakPnlUsdt: number;
    lastPnlUsdt: number;
    ageMs: number;
  }> {
    const now = Date.now();
    return Array.from(this.records.entries()).map(([k, r]) => {
      const [symbol, side] = k.split('|');
      return {
        symbol: symbol!,
        side: side as PositionSide,
        peakPnlUsdt: r.peakPnlUsdt,
        lastPnlUsdt: r.lastPnlUsdt,
        ageMs: now - r.updatedAt,
      };
    });
  }

  /**
   * Test/reset helper. Production callers should use clearOnClose
   * per (symbol, side); this drops the entire map.
   */
  resetForTests(): void {
    this.records.clear();
  }
}

export const aggregatePeakTracker = new AggregatePeakTracker();
export type { AggregatePeakTracker };
