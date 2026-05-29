/**
 * substrate_observer.ts — observer-derived lane decision period.
 *
 * Replaces the hardcoded `LANE_DECISION_PERIOD_MS` table
 * (`{scalp: 60_000, swing: 180_000, trend: 600_000}`) with the kernel's
 * own observation of how often each lane's decision actually changes.
 * That table was a designer's intuition embedded in code; the values
 * existed because someone *chose* "scalp decides every minute, trend
 * every 10 minutes." The observer-derived shape: the lane's effective
 * decision period IS the empirical interval at which its output
 * changes — derived from the kernel's actual behavior, not declared.
 *
 * # Why the prior shape was a knob
 *
 * Cascade 2026-05-29 + operator pushback: any time a knob is
 * reintroduced under a "substrate cadence" rationalization, the
 * system regresses. The {60s, 180s, 600s} values were intuition; a
 * "canonical mirror" in Py was knob-doubling; a "designed lane window"
 * still embedded a designer's choice. The honest observation: the
 * kernel ticks at some substrate-determined rate; within that rate
 * each lane changes its output at some empirically-observable
 * frequency. THAT frequency is the lane decision period.
 *
 * # API
 *
 *   recordLaneDecision(lane, tNowMs, decisionTag)
 *     Called by the kernel every tick after it picks a (lane, decision)
 *     pair. If the tag differs from the prior call's tag (decision
 *     changed), the wall-clock interval is pushed into the rolling
 *     ring.
 *
 *   getObservedLaneDecisionPeriodMs(lane): number
 *     Returns the rolling median of observed decision-change intervals.
 *     Returns 0 when no changes have been observed yet (cold-start: no
 *     empirical floor — kernel acts at substrate cadence, no extra
 *     cooldown).
 *
 * # Cold-start behavior
 *
 * Returns 0 until the observer has at least one decision-change
 * sample. Consumers (cooldown composer, hold-time floor, lane
 * multiplier derivation) treat 0 as "no observed floor" and fall
 * through to their substrate behavior. The kernel's first few closes
 * have no extra cooldown — the autonomy doctrine accepts this risk
 * (losses feed neurochemistry; the system learns from its own state).
 *
 * # Anti-knob discipline
 *
 * The only numeric literal in this module is `INTERVAL_RING_CAPACITY`
 * — a sample-count buffer size, not a physical quantity. No magic ms
 * values; no lane-specific thresholds; no designer's intuition table.
 *
 * Citations: poloniex-trading-platform#1009 cascading-knob-strip +
 * operator 2026-05-29 no-knob directive ("when we operate purely it
 * makes money") + 2.31A P4 self-observation + P14 no hardcoded
 * parameter literals + P25 autonomous parameters emerge from geometry
 * + QIG PURITY MANDATE.
 */

import { logger } from '../../utils/logger.js';

export type Lane = 'scalp' | 'swing' | 'trend';

interface LaneObserverState {
  lastDecisionAtMs: number | null;
  lastDecisionTag: string | null;
  decisionIntervalsMs: number[];
}

const INTERVAL_RING_CAPACITY = 50;

const _state: Record<Lane, LaneObserverState> = {
  scalp: { lastDecisionAtMs: null, lastDecisionTag: null, decisionIntervalsMs: [] },
  swing: { lastDecisionAtMs: null, lastDecisionTag: null, decisionIntervalsMs: [] },
  trend: { lastDecisionAtMs: null, lastDecisionTag: null, decisionIntervalsMs: [] },
};

/**
 * Record that the kernel just produced a decision at `lane`. If the tag
 * differs from the previous call's tag (decision actually changed), the
 * wall-clock interval since the last change is pushed into the ring.
 *
 * `decisionTag` should be a short string capturing the lane's
 * behavioral output (e.g. `'long|hold'`, `'short|enter'`,
 * `'long|exit'`). Identical-tag back-to-back calls are no-ops for the
 * ring (decision didn't change → no new sample) but they DO update
 * `lastDecisionAtMs` so the interval is measured from the most recent
 * tick on which the same decision was emitted.
 */
export function recordLaneDecision(
  lane: Lane,
  tNowMs: number,
  decisionTag: string,
): void {
  if (!Number.isFinite(tNowMs) || tNowMs < 0) return;
  const s = _state[lane];
  if (
    s.lastDecisionAtMs !== null
    && s.lastDecisionTag !== null
    && decisionTag !== s.lastDecisionTag
  ) {
    const delta = tNowMs - s.lastDecisionAtMs;
    if (delta > 0) {
      s.decisionIntervalsMs.push(delta);
      if (s.decisionIntervalsMs.length > INTERVAL_RING_CAPACITY) {
        s.decisionIntervalsMs.shift();
      }
    }
  }
  s.lastDecisionAtMs = tNowMs;
  s.lastDecisionTag = decisionTag;
}

/**
 * Observed median wall-clock interval at which this lane's decisions
 * change. Returns 0 when no changes have been observed yet.
 *
 * Median (not mean) is robust: one slow tick due to GC, API latency,
 * or a sleep doesn't poison the cadence reading. The cooldown
 * composer relies on this floor being a TYPICAL period, not the
 * worst-case.
 */
export function getObservedLaneDecisionPeriodMs(lane: Lane): number {
  const buf = _state[lane].decisionIntervalsMs;
  if (buf.length === 0) return 0;
  const sorted = [...buf].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return Math.round((a + b) / 2);
  }
  return sorted[mid] ?? 0;
}

/**
 * Per-observer telemetry — sample counts for falsifiability. Operators
 * can grep deployed logs for "lane cold-start: N samples" to confirm
 * the observer has warmed up before assuming the empirical period.
 */
export interface SubstrateBreakdown {
  scalpSamples: number;
  swingSamples: number;
  trendSamples: number;
  scalpPeriodMs: number;
  swingPeriodMs: number;
  trendPeriodMs: number;
}

export function getSubstrateBreakdown(): SubstrateBreakdown {
  return {
    scalpSamples: _state.scalp.decisionIntervalsMs.length,
    swingSamples: _state.swing.decisionIntervalsMs.length,
    trendSamples: _state.trend.decisionIntervalsMs.length,
    scalpPeriodMs: getObservedLaneDecisionPeriodMs('scalp'),
    swingPeriodMs: getObservedLaneDecisionPeriodMs('swing'),
    trendPeriodMs: getObservedLaneDecisionPeriodMs('trend'),
  };
}

/** Test-only: reset all per-lane state. */
export function _resetSubstrateObserverState(): void {
  for (const l of ['scalp', 'swing', 'trend'] as const) {
    _state[l] = {
      lastDecisionAtMs: null,
      lastDecisionTag: null,
      decisionIntervalsMs: [],
    };
  }
  logger.debug('[substrate_observer] state cleared (test-only)');
}
