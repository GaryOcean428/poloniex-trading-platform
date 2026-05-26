/**
 * trajectory_observer.ts — TS Layer 2 (trajectory regime) observer.
 *
 * REGIME-1 #766 / docs/regime-classification-hierarchy.md.
 *
 * Ports the WarpBubble.auto() pattern from CAL-3 (#756 /
 * `ml-worker/src/proprietary_core/regime_observer.py`) into the TS
 * trajectory-classification path. Replaces the hardcoded
 * TREND_THRESHOLD=0.025 and CHOP_THRESHOLD=0.55 magic numbers in
 * regime.ts with rolling-quantile boundaries derived from the basin's
 * own observed |basinDirection| distribution.
 *
 * ── Per-symbol observation ──────────────────────────────────────────
 *
 * CAL-3's Python observer is a process-singleton because h/J is a
 * market-wide physics property pooled across all symbols. By contrast,
 * `basinDirection` IS per-symbol — ETH's basin trajectory and BTC's
 * basin trajectory are different signals. This module therefore keeps
 * a per-symbol `Map<string, ObserverState>` so the tercile boundaries
 * for each symbol derive from that symbol's own distribution. Pooling
 * would cross-contaminate the boundaries (ETH's chop on a quiet day
 * would suppress BTC entries on a volatile day, or vice versa).
 *
 * ── Layer-2 contract ────────────────────────────────────────────────
 *
 *   OBSERVE  — append `|basinDirection|` of each tick to the symbol's
 *              rolling buffer
 *   DISCOVER — compute terciles (0.33, 0.67) over the buffer once warm
 *   NAVIGATE — map this tick's |basinDirection| to CHOP / TREND
 *              relative to the observed terciles; sign(basinDirection)
 *              chooses UP / DOWN within TREND
 *
 * Warmup: until WARMUP_TICKS observations have accumulated for THIS
 * symbol, the classifier falls through to LEGACY_TREND_THRESHOLD /
 * LEGACY_CHOP_THRESHOLD (the previous hardcoded values) so behaviour
 * is bit-for-bit identical during the first WARMUP_TICKS ticks per
 * symbol per process. Auto-retires once warm.
 *
 * Per the audit's P1/P25 framing: warmup constants are SAFETY_BOUND
 * (process-startup fall-through, not operator-tunable) and the quantile
 * choices [0.33, 0.67] are the same as CAL-3 — they're the parameterless
 * definition of "terciles", not magic numbers.
 */

import { basinDirection } from './perception.js';
import type { Basin } from './basin.js';

/** Rolling window matches CAL-3's choice — 500 ticks gives a stable
 *  rolling-quantile estimator. Shorter windows over-react to recent
 *  volatility; longer windows lag regime shifts. */
const OBSERVER_WINDOW = 500;

/** Warmup matches CAL-3 — 30 observations is the minimum where quantile
 *  estimates stop being dominated by outliers. */
const WARMUP_TICKS = 30;

/** Tercile boundary quantiles. Same as CAL-3; this is the definition of
 *  terciles, not an adjustable parameter. */
const LOWER_TERCILE = 0.33;
const UPPER_TERCILE = 0.67;

/** Persistence window (recent slice used to decide TREND-vs-CHOP within
 *  the middle tercile via signed mean). Bounded so persistence is a
 *  recent-behaviour signal, not pulled toward the full 500-tick window. */
const PERSISTENCE_WINDOW = 64;

/** Legacy fall-through values — used only during warmup. These were the
 *  TREND_THRESHOLD and CHOP_THRESHOLD constants prior to this observer
 *  taking over. Keeping them as the warmup fall-through preserves the
 *  pre-observer behaviour bit-for-bit for the first WARMUP_TICKS ticks. */
const LEGACY_TREND_THRESHOLD = 0.025;
const LEGACY_CHOP_THRESHOLD = 0.55;

/**
 * Absolute CHOP floor — SAFETY_BOUND, NOT a tunable threshold.
 *
 * Rolling-tercile classification has a scale-blindness pathology: when
 * the basinDir distribution is itself entirely small (genuine quiet),
 * the lower tercile cutoff is also small, so values like 0.05 fall
 * ABOVE the lower tercile and get classified as TREND despite being
 * structurally chop. Live tape 2026-05-19 09:01: basinDir=0.048 on ETH
 * classified CREATOR_TREND_UP while price oscillated in a $2 range
 * (0.05%) over 90 seconds — pure fee-bleed chop misread as trend.
 *
 * The fix: ABSOLUTE floor below which we ALWAYS classify CHOP regardless
 * of the rolling tercile. This catches genuine market quiet where the
 * tercile-of-quiet is itself quiet. Per P25, this is bound-not-tune —
 * it caps the maximum scale-blindness, not the typical decision.
 *
 * Phase 6 (2026-05-27) — MONKEY_ABS_CHOP_FLOOR (was 0.10) removed.
 * Doctrine: the rolling tercile system IS the kernel's self-scaled
 * chop classifier. If the entire distribution is quiet, the lower-
 * tercile is also quiet, and "above lower tercile" remains the right
 * boundary for "less chop than the bottom 1/3 of recent observations."
 *
 * The original scale-blind-pathology worry — that "above lower
 * tercile" could still be absolutely quiet when the whole tape is flat
 * — is replaced by the relative formulation: a flat tape has flat
 * absolute values across the WHOLE distribution, so "above lower
 * tercile" represents genuine relative motion within that calm regime.
 * The kernel's behavior in calm regimes is governed by its sizing
 * (chop cells size down via Phase 1 phi×regimeConfidence) and by its
 * Ocean trail tier (Phase 2 stability ticks) — not by a static abs-
 * value floor on direction.
 */

export type TrajectoryLabel = 'TREND_UP' | 'CHOP' | 'TREND_DOWN';

export interface TrajectoryReading {
  regime: TrajectoryLabel;
  confidence: number;       // 0..1
  trendStrength: number;    // -1..+1
  chopScore: number;        // 0..1
  /** True while THIS SYMBOL's observer is still in warmup (n < WARMUP_TICKS)
   *  and falling through to legacy hardcoded thresholds. */
  isWarmup: boolean;
  /** Number of observations the observer has accumulated for this symbol. */
  observerN: number;
}

export interface TrajectoryObserverSnapshot {
  symbol: string;
  n: number;
  isWarmup: boolean;
  /** Lower-tercile boundary on |basinDirection|; null while in warmup. */
  lower: number | null;
  /** Upper-tercile boundary on |basinDirection|; null while in warmup. */
  upper: number | null;
}

interface ObserverState {
  /** Rolling buffer of |basinDirection| values for this symbol. */
  abs: number[];
  /** Rolling buffer of signed basinDirection values for persistence. */
  signed: number[];
}

/** Per-symbol observer state. Each symbol's tercile boundaries derive
 *  from that symbol's own distribution. */
const _states: Map<string, ObserverState> = new Map();

function getState(symbol: string): ObserverState {
  let s = _states.get(symbol);
  if (!s) {
    s = { abs: [], signed: [] };
    _states.set(symbol, s);
  }
  return s;
}

/** Test/cleanup helper — reset all per-symbol observers. */
export function _resetTrajectoryObserver(symbol?: string): void {
  if (symbol === undefined) {
    _states.clear();
    return;
  }
  _states.delete(symbol);
}

/** Snapshot the current observer state for a symbol without classifying. */
export function observerSnapshot(symbol: string): TrajectoryObserverSnapshot {
  const s = _states.get(symbol);
  const n = s?.abs.length ?? 0;
  if (!s || n < WARMUP_TICKS) {
    return { symbol, n, isWarmup: true, lower: null, upper: null };
  }
  const sorted = [...s.abs].sort((a, b) => a - b);
  return {
    symbol,
    n,
    isWarmup: false,
    lower: quantile(sorted, LOWER_TERCILE),
    upper: quantile(sorted, UPPER_TERCILE),
  };
}

/** Diagnostic — snapshot every symbol's observer state. */
export function observerSnapshotAll(): TrajectoryObserverSnapshot[] {
  const out: TrajectoryObserverSnapshot[] = [];
  for (const symbol of _states.keys()) {
    out.push(observerSnapshot(symbol));
  }
  return out;
}

function pushBuffer(buf: number[], value: number, maxLen: number): void {
  buf.push(value);
  if (buf.length > maxLen) buf.shift();
}

function quantile(sortedAsc: readonly number[], q: number): number {
  // Linear interpolation between closest ranks (numpy default).
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = pos - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

/**
 * Observe a single basin for a symbol and classify the trajectory regime.
 * Stateful — appends to the symbol's rolling buffer before classifying.
 */
export function observeAndClassify(
  symbol: string,
  basin: Basin,
): TrajectoryReading {
  const dir = basinDirection(basin);
  const s = getState(symbol);
  pushBuffer(s.abs, Math.abs(dir), OBSERVER_WINDOW);
  pushBuffer(s.signed, dir, OBSERVER_WINDOW);
  return classifyFromState(s);
}

/**
 * Seed the observer for a symbol from a basin history window, then
 * classify. Migration path for callers that previously passed a
 * basinHistory to the legacy classifyRegime(); they keep their existing
 * call shape, the symbol becomes explicit, and the observer accumulates
 * across calls for that symbol.
 *
 * Older entries fall off naturally when the buffer exceeds
 * OBSERVER_WINDOW.
 */
export function observeAndClassifyFromHistory(
  symbol: string,
  basinHistory: readonly Basin[],
): TrajectoryReading {
  const s = getState(symbol);
  for (const b of basinHistory) {
    const dir = basinDirection(b);
    pushBuffer(s.abs, Math.abs(dir), OBSERVER_WINDOW);
    pushBuffer(s.signed, dir, OBSERVER_WINDOW);
  }
  return classifyFromState(s);
}

function classifyFromState(s: ObserverState): TrajectoryReading {
  const n = s.abs.length;
  if (n < WARMUP_TICKS) {
    return warmupFallthrough(s, n);
  }

  // DISCOVER — terciles of |basinDirection| over THIS symbol's window.
  const sorted = [...s.abs].sort((a, b) => a - b);
  const lower = quantile(sorted, LOWER_TERCILE);
  const upper = quantile(sorted, UPPER_TERCILE);

  // Most-recent tick's signed direction drives the side; persistence
  // over the recent window drives the strength + chop discrimination.
  const recentSigned = s.signed[s.signed.length - 1] ?? 0;
  const recentAbs = Math.abs(recentSigned);

  const windowSize = Math.min(n, PERSISTENCE_WINDOW);
  const recentSlice = s.signed.slice(-windowSize);
  const meanSigned = recentSlice.reduce((sum, v) => sum + v, 0) / windowSize;
  const meanAbs = recentSlice.reduce((sum, v) => sum + Math.abs(v), 0) / windowSize;
  // Persistence: |mean(signed)| / mean(|signed|). 1.0 = pure trend,
  // 0.0 = pure chop.
  const persistence = meanAbs > 1e-12 ? Math.abs(meanSigned) / meanAbs : 0;

  let regime: TrajectoryLabel;
  let chopScore: number;
  let trendStrength: number;

  if (recentAbs < lower) {
    // Below the lower tercile of |basinDirection| → CHOP.
    regime = 'CHOP';
    chopScore = Math.min(1, 1 - recentAbs / Math.max(lower, 1e-12));
    trendStrength = meanSigned;
  } else if (recentAbs > upper && persistence > 0.5) {
    // Phase 6 (2026-05-27) — persistence gate added to upper-tercile
    // branch. Was: "recentAbs > upper → always TREND." That misclassified
    // persistent-quiet basins where the most-recent value happened to
    // sit above its own rolling upper-tercile but random sign-flips
    // gave near-zero persistence (no actual trend direction).
    //
    // The persistence < 0.5 case in the upper-tercile region IS chop —
    // recentAbs is large relative to the rolling distribution, but the
    // SIGN of recent moves doesn't dominate. The kernel's own observable
    // says "I've been moving but in no clear direction." Replaces the
    // removed MONKEY_ABS_CHOP_FLOOR (was 0.10) — instead of an absolute
    // floor, we use the kernel's own signed-vs-unsigned ratio.
    regime = recentSigned >= 0 ? 'TREND_UP' : 'TREND_DOWN';
    chopScore = Math.max(0, 1 - persistence);
    trendStrength = meanSigned;
  } else if (recentAbs > upper) {
    // Upper-tercile but low persistence → CHOP. The kernel sees motion
    // but it's not directional.
    regime = 'CHOP';
    chopScore = Math.max(0, 1 - persistence);
    trendStrength = meanSigned;
  } else {
    // Middle tercile — persistence discriminates trend-in-formation
    // from genuine chop within an intermediate magnitude.
    if (persistence > 0.5) {
      regime = meanSigned >= 0 ? 'TREND_UP' : 'TREND_DOWN';
      trendStrength = meanSigned;
      chopScore = Math.max(0, 1 - persistence);
    } else {
      regime = 'CHOP';
      trendStrength = meanSigned;
      chopScore = Math.max(0, 1 - persistence);
    }
  }

  let confidence: number;
  if (regime === 'CHOP') {
    const range = Math.max(lower, 1e-12);
    confidence = Math.min(1, Math.max(0, 1 - recentAbs / range));
  } else {
    const range = Math.max(upper - lower, 1e-12);
    const excess = (recentAbs - upper) / range;
    confidence = Math.min(1, Math.max(0, 0.5 + 0.5 * Math.tanh(excess)));
  }

  return {
    regime,
    confidence,
    trendStrength,
    chopScore,
    isWarmup: false,
    observerN: n,
  };
}

function warmupFallthrough(s: ObserverState, n: number): TrajectoryReading {
  // Pre-observer behaviour — most-recent tick's |basinDirection|
  // against the legacy hardcoded thresholds. Bit-for-bit identical to
  // the pre-REGIME-1 classifyRegime() during the warmup window.
  const recentSigned = s.signed[s.signed.length - 1] ?? 0;
  const recentAbs = Math.abs(recentSigned);
  const persistenceWindow = Math.min(n, 16);
  const recentSlice = s.signed.slice(-persistenceWindow);
  const meanSigned = persistenceWindow > 0
    ? recentSlice.reduce((sum, v) => sum + v, 0) / persistenceWindow
    : 0;
  const meanAbs = persistenceWindow > 0
    ? recentSlice.reduce((sum, v) => sum + Math.abs(v), 0) / persistenceWindow
    : 0;
  const persistence = meanAbs > 1e-12 ? Math.abs(meanSigned) / meanAbs : 0;
  const chopScore = 1.0 - persistence;
  const isTrend =
    recentAbs > LEGACY_TREND_THRESHOLD && chopScore < LEGACY_CHOP_THRESHOLD;
  let regime: TrajectoryLabel;
  let confidence: number;
  if (isTrend) {
    regime = meanSigned >= 0 ? 'TREND_UP' : 'TREND_DOWN';
    const excess =
      (recentAbs - LEGACY_TREND_THRESHOLD) / Math.max(LEGACY_TREND_THRESHOLD, 1e-9);
    confidence = Math.min(1, Math.max(0, 0.5 + 0.5 * Math.tanh(excess)));
  } else {
    regime = 'CHOP';
    const excess =
      (chopScore - LEGACY_CHOP_THRESHOLD) /
      Math.max(1 - LEGACY_CHOP_THRESHOLD, 1e-9);
    confidence = Math.min(1, Math.max(0, 0.5 + 0.5 * Math.tanh(excess)));
  }
  return {
    regime,
    confidence,
    trendStrength: meanSigned,
    chopScore,
    isWarmup: true,
    observerN: n,
  };
}
