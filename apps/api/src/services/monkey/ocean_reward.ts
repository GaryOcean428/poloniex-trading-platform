/**
 * ocean_reward.ts — Ocean kernel's canonical reward-shaping function.
 *
 * Issue #948 — Matrix tier-3 directive (2026-05-26).
 *
 * **The doctrine**: "Reward the behavior you want. Not set knobs.
 * This is how it learns." — Braden, 2026-05-26.
 *
 * Behavior-change is achieved by shaping the *learning signal* the
 * kernel's chemistry receives from realized outcomes — NOT by gating
 * kernel decisions with operator-tunable thresholds.
 *
 * **What this function does:**
 * - Below 1% ROI (the noise floor): zero positive reward emitted. The
 *   kernel learns that sub-1% wins are noise, not signal, and stops
 *   chasing them.
 * - At 1% ROI or above: positive reward scales by the Fibonacci
 *   sequence. The kernel learns that 8% wins are 8× as rewarding as
 *   1% wins, 21% wins are 21× as rewarding, etc. Chemistry routes
 *   attention toward setups that historically produce larger wins.
 *
 * **What this function is NOT:**
 * - Not a gate on kernel decisions. The kernel still decides every
 *   entry, every hold, every exit. This function only shapes what
 *   the chemistry feels AFTER a trade closes.
 * - Not a tunable knob. The Fibonacci sequence is a structural choice
 *   of the mapping function's shape — same category as the
 *   `Math.tanh()` squash in `pushReward` or the `0.5/0.15/0.3` per-
 *   channel caps. The bucket edges (1, 2, 3, 5, 8, 13, 21, 34) are
 *   the Fibonacci numbers themselves, not chosen thresholds.
 * - Not symmetric to losses. The negative-side chemistry update
 *   (gaba on losses) is unchanged. Matrix flagged loss-side Fibonacci
 *   scaling as an open follow-on question pending operator call.
 *
 * **Doctrinal anchors:**
 * - P5 (Observer Sets All Params): the kernel decides everything;
 *   reward is what the outcome IS, mapped through a structural shape.
 * - P14 (Variable Separation): reward magnitude (this function) is
 *   separated from reward consumption (push_reward / chemistry).
 *
 * **1% floor justification:** below 1% ROI the position genuinely is
 * fee-noise + market-microstructure noise even on fee-free tiers; the
 * win could not be reliably reproduced on an unbiased re-run.
 * Rewarding noise teaches the kernel to chase noise. 1% is where
 * statistical separability begins, not a calibrated threshold.
 */

/**
 * Map ROI fraction → Fibonacci reward coefficient.
 *
 * Returns 0 for ROI < 1% (noise band, no learning signal). Above 1%,
 * each tier returns the corresponding Fibonacci number, capped at 34
 * for ROI ≥ 34% (beyond the cap is lucky tape; don't over-reward
 * outliers and let MAD-based normalization decide the rest).
 *
 * @param roiFrac realized ROI as a fraction (0.05 = 5%)
 */
export function fibonacciRewardCoefficient(roiFrac: number): number {
  if (!Number.isFinite(roiFrac) || roiFrac < 0.01) return 0;
  if (roiFrac < 0.02) return 1;
  if (roiFrac < 0.03) return 2;
  if (roiFrac < 0.05) return 3;
  if (roiFrac < 0.08) return 5;
  if (roiFrac < 0.13) return 8;
  if (roiFrac < 0.21) return 13;
  if (roiFrac < 0.34) return 21;
  return 34;
}

/**
 * Surface the tier index for telemetry — useful for grepping kernel
 * logs to confirm the reward dispense is firing as expected.
 *
 * Tier 0 = below 1% noise floor. Tier 1..8 are the Fibonacci buckets.
 */
export function fibonacciRewardTier(roiFrac: number): number {
  if (!Number.isFinite(roiFrac) || roiFrac < 0.01) return 0;
  if (roiFrac < 0.02) return 1;
  if (roiFrac < 0.03) return 2;
  if (roiFrac < 0.05) return 3;
  if (roiFrac < 0.08) return 4;
  if (roiFrac < 0.13) return 5;
  if (roiFrac < 0.21) return 6;
  if (roiFrac < 0.34) return 7;
  return 8;
}

/**
 * Observer-derived ocean reward coefficient (P1, post flag-reversal).
 *
 * Replaces the external hardcoded 1% Fib floor (never fired at real
 * kernel scale ~0.04% MAD). Uses own realized pnlFrac distribution
 * (exact median + MAD mirror of the motivators.ts transcendence block).
 * Positive deviation from own history now yields positive chemistry.
 * Cold-start or non-positive deviation → 0. Structural (no knob).
 */
export function observerFibCoefficient(pnlFrac: number, history: number[]): number {
  if (!history || history.length < 2) return pnlFrac > 0 ? 1 : 0; // Gentle positive signal while observer history builds (P1 ramp-up)
  if (!Number.isFinite(pnlFrac)) return 0;

  const sorted = [...history].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];

  const devs = sorted.map(x => Math.abs(x - median)).sort((a, b) => a - b);
  const mad = n % 2 === 0
    ? (devs[n / 2 - 1] + devs[n / 2]) / 2
    : devs[Math.floor(n / 2)];

  if (mad < 1e-12) return 0;
  const z = (pnlFrac - median) / mad;
  if (z <= 0) return 0;

  // Structural mapping (positive z-deviation → Fib tiers)
  if (z < 0.5) return 1;
  if (z < 1.0) return 2;
  if (z < 1.5) return 3;
  if (z < 2.0) return 5;
  if (z < 3.0) return 8;
  if (z < 4.0) return 13;
  if (z < 5.0) return 21;
  return 34;
}

/**
 * Ocean's trail/SL retracement tier as a function of the kernel's
 * coherence streak — Matrix tier-3 doctrine extension (2026-05-26).
 *
 * Braden's directive: "ocean sets the trail based off noise and its
 * confidence. if it expects it will go higher after some accumulation
 * then set it more flexibly. fib magnitude. if it is uncertain then
 * it sets it tight after the expected peak is reached. sl set
 * similarly."
 *
 * **What this function does:**
 *
 * Reads ONE kernel-observable — the consecutive-tick count where
 * Fisher-Rao(perception, strategy_forecast) stayed below shouldExit's
 * threshold (i.e. the kernel has been coherent on this position) —
 * and selects a Fibonacci-tier retracement window from the canonical
 * trail-eligible subset {3%, 5%, 8%, 13%, 21%}.
 *
 * High streak → kernel sustained coherence → looser trail (allow the
 * position room to breathe through noise). Low streak → coherence
 * just established / kernel uncertain → tight trail (lock in what's
 * there).
 *
 * **Why this passes the knob-test (Matrix's "Mechanism B"):**
 *
 * The tier-picker is a pure count of an observable. There is NO
 * formula combining noise + confidence with operator-picked
 * coefficients. The streak length IS the tier index, capped at the
 * length of the trail-eligible subset. The Fibonacci sequence
 * remains the canonical numerical object — same sequence already
 * shipped in #948 as the reward magnitude function, applied at a
 * different lifecycle point (during-hold trail) with a different
 * subset (3% .. 21% instead of 1% .. 34%).
 *
 * **Why the trail-eligible subset is {3, 5, 8, 13, 21}:**
 *
 * Tier 1 (1%) is excluded — it's the noise floor from #948; a 1%
 * retracement window would fire SL on noise. Tier 2 (2%) is also
 * excluded as too tight (first non-noise band but no wiggle
 * absorption). Tier 8 (34%) is excluded because at that retracement
 * the kernel's harvest gate would already have fired. The remaining
 * five tiers cover the operational range of "tight enough to capture
 * the trade" through "loose enough to give a real trend room."
 *
 * **Linked SL+trail:** per Matrix's tier-3 recommendation, the SAME
 * tier returned here drives BOTH the SL distance from mark AND the
 * trail retracement window. shouldExtendBracket consumes the same
 * scalar at both application points within one tick.
 *
 * @param coherenceStreak consecutive ticks where FR(perception,
 *   strategy_forecast) was below shouldExit threshold on this
 *   position. Negative or non-finite → treated as 0 (defensive).
 * @returns retracement fraction in {0.03, 0.05, 0.08, 0.13, 0.21}
 */
export const TRAIL_TIERS = [0.03, 0.05, 0.08, 0.13, 0.21] as const;

export function oceanTrailRetracement(coherenceStreak: number): number {
  if (!Number.isFinite(coherenceStreak) || coherenceStreak < 0) {
    return TRAIL_TIERS[0];
  }
  const idx = Math.min(Math.floor(coherenceStreak), TRAIL_TIERS.length - 1);
  return TRAIL_TIERS[idx]!;
}

/**
 * Surface the trail tier index (0..4) for telemetry, mapping the
 * coherence streak to the position within the trail-eligible
 * Fibonacci subset. Useful for grepping kernel logs to confirm the
 * tier-picker is firing as expected.
 */
export function oceanTrailTierIndex(coherenceStreak: number): number {
  if (!Number.isFinite(coherenceStreak) || coherenceStreak < 0) return 0;
  return Math.min(Math.floor(coherenceStreak), TRAIL_TIERS.length - 1);
}
