/**
 * time_of_day_winrate.ts — SENSE-2c Phase 2 (#787 follow-up).
 *
 * Per-lane in-memory accumulator of (time-of-day, outcome) closed-trade
 * pairs. The query function returns a phase-weighted win rate: trades
 * from a similar time-of-day phase carry more weight via
 * exp(-hourCycleDistance × DECAY).
 *
 * Used by chooseLane to fold a session-prior into the softmax over lane
 * scores: lanes with a stronger track record at the current time-of-day
 * get scored higher. Pure observer-derived — no operator knob picks
 * which lane to prefer; the accumulated outcomes do.
 *
 * Phase 2 scope (this module): in-memory only. Per-process state, lost
 * on restart; warms up over a session as trades close. A persistent
 * variant (DB-backed or session-restored) is a follow-up.
 *
 * MIN_SAMPLES + NEIGHBOR_DECAY are SAFETY_BOUND constants — they
 * gate the warmup behaviour and set the cycle-distance scale; not
 * operator-tunable thresholds.
 */

import {
  observeTimeOfDay,
  hourCycleDistance,
  type TimeOfDayReading,
} from './time_of_day.js';

type Lane = 'scalp' | 'swing' | 'trend' | 'observe';

interface OutcomeEntry {
  time: TimeOfDayReading;
  win: boolean;
}

/** Per-lane history depth. Beyond this, oldest entries fall off. */
const MAX_HISTORY = 200;
/** Below this sample count for a given lane, the prior returns neutral. */
const MIN_SAMPLES = 5;
/** Weight decay across the time-of-day cycle. At hourCycleDistance=1.0
 *  (opposite-side-of-clock), weight = exp(-4) ≈ 0.018 — strongly
 *  discounts trades from very different times. At distance=0.25 (6h
 *  away), weight ≈ 0.37; at distance=0 (same time), weight=1. */
const NEIGHBOR_DECAY = 4.0;

const _history: Record<Lane, OutcomeEntry[]> = {
  scalp: [],
  swing: [],
  trend: [],
  observe: [],
};

export interface WinRateReading {
  /** Phase-weighted win rate in [0, 1]. Returns 0.5 (neutral) when warmup. */
  rate: number;
  /** Sum of exp-decay weights of observations contributing to the rate.
   *  Roughly "effective N" — a measure of how grounded the rate is. */
  effectiveN: number;
  /** Raw count of observations in this lane's buffer. */
  rawN: number;
  /** True when rawN < MIN_SAMPLES — rate is the 0.5 default. */
  warmup: boolean;
}

/**
 * Append a closed-trade outcome to the per-lane accumulator. Caller
 * passes the lane, win/loss flag, and (optionally) the time at which to
 * record the observation (default = now).
 */
export function recordLaneOutcome(
  lane: Lane,
  win: boolean,
  at: Date = new Date(),
): void {
  const arr = _history[lane];
  arr.push({ time: observeTimeOfDay(at), win });
  if (arr.length > MAX_HISTORY) arr.shift();
}

/**
 * Compute the phase-weighted win rate for a lane at the given time.
 * Default time = now. Returns warmup with rate=0.5 when the lane has
 * fewer than MIN_SAMPLES closed trades.
 */
export function weightedWinRate(
  lane: Lane,
  at: Date = new Date(),
): WinRateReading {
  const arr = _history[lane];
  if (arr.length < MIN_SAMPLES) {
    return { rate: 0.5, effectiveN: 0, rawN: arr.length, warmup: true };
  }
  const now = observeTimeOfDay(at);
  let weightedWins = 0;
  let totalWeight = 0;
  for (const o of arr) {
    const dist = hourCycleDistance(now, o.time);
    const w = Math.exp(-dist * NEIGHBOR_DECAY);
    if (o.win) weightedWins += w;
    totalWeight += w;
  }
  const rate = totalWeight > 0 ? weightedWins / totalWeight : 0.5;
  return { rate, effectiveN: totalWeight, rawN: arr.length, warmup: false };
}

/** Test/diagnostic helper. */
export function _resetLaneOutcomes(lane?: Lane): void {
  if (lane === undefined) {
    for (const k of Object.keys(_history) as Lane[]) _history[k] = [];
    return;
  }
  _history[lane] = [];
}

/** Test/diagnostic helper — current buffer length per lane. */
export function _peekLaneOutcomes(lane: Lane): readonly OutcomeEntry[] {
  return _history[lane];
}
