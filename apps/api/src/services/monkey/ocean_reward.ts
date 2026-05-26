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
