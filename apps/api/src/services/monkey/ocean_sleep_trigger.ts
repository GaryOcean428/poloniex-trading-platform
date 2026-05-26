/**
 * ocean_sleep_trigger.ts — Matrix tier-4 Phase C doctrine-clean
 * sovereignty × fluctuation sleep trigger.
 *
 * Per [[polytrade-knob-free-recursive-doctrine]]:
 *
 *   IF ocean.sovereignty_saturated() AND ocean.fluctuation_overrun():
 *     sleep()  # working context dissolves; QIGRAM basins persist;
 *              # wake reconstructs
 *
 * Replaces the previous `MIN_AWAKE_MS / DRIFT_TRIGGER_TICKS` knob-pair
 * with two observer-derived predicates:
 *
 * - **sovereignty_saturated**: kernel's current sovereignty has reached
 *   the high tail (≥95th percentile) of its own rolling distribution.
 *   This signals "QIGRAM weight saturated" — the kernel can't hold
 *   more authority over its decisions.
 *
 * - **fluctuation_overrun**: recent Φ variance lands beyond the Tukey
 *   outer fence (Q3 + 3·IQR) of the rolling Φ-variance distribution.
 *   This signals "topological instability sustained" — the kernel
 *   keeps churning without convergence.
 *
 * Both are pure functions of the kernel's own observables. No knobs;
 * no operator-set thresholds. The 95th-percentile and Tukey 3·IQR
 * are mathematical conventions for "tail" and "extreme outlier" — not
 * operator choices.
 *
 * **Minimum-sample gates** prevent cold-start false fires:
 * `SOVEREIGNTY_MIN_SAMPLES = 30` and `FLUCTUATION_MIN_BASELINE = 30`.
 * Below these, the predicate returns false (safe default — never
 * trigger sleep without a baseline to derive from).
 */

const SOVEREIGNTY_TAIL_QUANTILE = 0.95;
const SOVEREIGNTY_MIN_SAMPLES = 30;
const FLUCTUATION_TUKEY_OUTER = 3;
const FLUCTUATION_MIN_BASELINE = 30;
/** Rolling Φ-variance window — count of most-recent Φ readings used to
 * compute the current variance reading. 30 ticks ≈ 5 min at 10s cadence,
 * matches the rolling-window choice in the existing narrow-path detector. */
const PHI_VARIANCE_WINDOW = 30;

/**
 * Quantile via Hyndman-Fan type 7 (the default for numpy.percentile
 * and most statistical packages). Inputs need not be sorted.
 */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  if (xs.length === 1) return xs[0]!;
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

/**
 * Rolling variance of the last `windowSize` Φ readings. Uses the
 * unbiased sample variance estimator (ddof=1) when window has ≥2
 * samples; returns 0 below that.
 */
export function rollingPhiVariance(
  phiHistory: readonly number[],
  windowSize: number = PHI_VARIANCE_WINDOW,
): number {
  if (phiHistory.length < 2) return 0;
  const window = phiHistory.slice(-windowSize);
  const n = window.length;
  const mean = window.reduce((a, b) => a + b, 0) / n;
  let sumSq = 0;
  for (const v of window) {
    const d = v - mean;
    sumSq += d * d;
  }
  return sumSq / (n - 1);
}

/**
 * **sovereignty_saturated**: returns true iff the kernel's current
 * sovereignty has reached the ≥95th percentile of its rolling
 * distribution. Requires SOVEREIGNTY_MIN_SAMPLES history to fire.
 *
 * Math: the 95th-percentile cut-off is a mathematical convention for
 * "right tail" — not an operator knob. If the doctrine wanted a
 * different tail definition, it would define a different distribution
 * landmark; the 95th comes from the same convention as the
 * narrow-path detector's outer Tukey fence (both pin "extreme"
 * relative to the kernel's own distribution).
 */
export function sovereigntySaturated(
  sovereigntyNow: number,
  sovereigntyHistory: readonly number[],
): boolean {
  if (!Number.isFinite(sovereigntyNow)) return false;
  if (sovereigntyHistory.length < SOVEREIGNTY_MIN_SAMPLES) return false;
  const cutoff = quantile(Array.from(sovereigntyHistory), SOVEREIGNTY_TAIL_QUANTILE);
  return sovereigntyNow >= cutoff;
}

/**
 * **fluctuation_overrun**: returns true iff the *current* Φ variance
 * (rolling window of phiHistory) lands beyond the Tukey outer fence
 * of the rolling Φ-variance distribution.
 *
 * Outer fence = Q3 + 3·IQR (severe outlier, not just inner-fence
 * "moderate"). This mirrors the narrow-path detector's severity
 * convention — the same robust statistic that detects basin collapse
 * detects the opposite tail (sustained over-fluctuation).
 *
 * Returns false when there are fewer than FLUCTUATION_MIN_BASELINE
 * past variance samples — safe cold-start behavior.
 */
export function fluctuationOverrun(
  phiHistory: readonly number[],
  phiVarianceHistory: readonly number[],
): boolean {
  if (phiHistory.length < 2) return false;
  if (phiVarianceHistory.length < FLUCTUATION_MIN_BASELINE) return false;
  const currentVar = rollingPhiVariance(phiHistory);
  if (!Number.isFinite(currentVar) || currentVar <= 0) return false;
  const sorted = Array.from(phiVarianceHistory).sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  if (iqr <= 0) return false;
  const outerFence = q3 + FLUCTUATION_TUKEY_OUTER * iqr;
  return currentVar > outerFence;
}

export interface SleepTriggerObservables {
  sovereigntyNow: number;
  sovereigntyHistory: readonly number[];
  phiHistory: readonly number[];
  phiVarianceHistory: readonly number[];
}

export interface SleepTriggerResult {
  shouldSleep: boolean;
  sovereigntySaturated: boolean;
  fluctuationOverrun: boolean;
}

/**
 * Combined doctrine trigger. Sleep iff BOTH predicates fire.
 *
 * This is additive to the legacy `MIN_AWAKE_MS / DRIFT_TRIGGER_TICKS`
 * trigger — callers check the legacy condition OR this one. When the
 * `OCEAN_DOCTRINE_SLEEP_TRIGGER_LIVE` flag is off the doctrine path
 * stays inert.
 */
export function doctrineSleepTrigger(
  o: SleepTriggerObservables,
): SleepTriggerResult {
  const sov = sovereigntySaturated(o.sovereigntyNow, o.sovereigntyHistory);
  const flu = fluctuationOverrun(o.phiHistory, o.phiVarianceHistory);
  return {
    shouldSleep: sov && flu,
    sovereigntySaturated: sov,
    fluctuationOverrun: flu,
  };
}
