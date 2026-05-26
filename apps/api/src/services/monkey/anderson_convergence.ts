/**
 * anderson_convergence.ts — Matrix tier-4 Phase B: Class A1 frozen
 * convergence primitives for the pi-loop ceiling.
 *
 * Ported from `qig-applied/qigram.py:135` (`_anderson_threshold`) and
 * `qig-applied/qigram.py:148` (`PRECESSION_WEIGHT`). Both are
 * Class A1 frozen physics (R²=0.9996, L=3,4,5 confirmed in
 * `01_FROZEN_FACTS.md` §6).
 *
 * **Doctrinal purpose** (see [[polytrade-knob-free-recursive-doctrine]]):
 * the pi-loop terminates at L_c=3 floor (self-aware-reasoning topology
 * from issue #19) and at an Anderson-threshold ceiling. No
 * `MAX_LOOPS_PER_TICK` knob — the ceiling is computed from observables:
 *
 *   anderson_threshold(N, α) = min(expected + margin, 0.95)
 *     expected = 1 - exp(-α·N)
 *     margin   = 1/√N   (N > 0)
 *
 * The 0.95 cap is the noisy-measurement ceiling: the observer can't
 * require more than 95% agreement because at high N, expected → 1 and
 * the unbounded threshold exceeds 1 (impossible). The cap prevents this.
 *
 * **Class A1 anchor**: α=0.089 is the Anderson dominance scaling
 * constant. NOT a knob — calibrated against experiments, stable
 * physical meaning per the channel-discipline doctrine. Changing α
 * requires re-running the Class A1 calibration; treat it as constant
 * code, not config.
 *
 * **Phase B is port-only**. This module exports the primitives so the
 * pi-loop wire-up (introduction of the iterative refinement loop at
 * the proposal-draft site) can consume them without inventing a knob.
 */

/** Class A1 frozen — Anderson dominance scaling constant.
 * R²=0.9996; L=3,4,5 confirmed. Do not adjust. */
export const ANDERSON_ALPHA = 0.089;

/** Pi-carousel precession rate (P-SPEC-9, qig-applied QIGRAM.integrate).
 * Class A1 frozen. ≈ 0.04507. */
export const PRECESSION_WEIGHT = 0.14159 / Math.PI;

/** Noisy-measurement ceiling — the observer can't require more than
 * 95% agreement. */
export const ANDERSON_THRESHOLD_CEILING = 0.95;

/** Self-aware-reasoning topology floor — issue #19. The pi-loop must
 * run at least L_c=3 iterations before convergence checking. */
export const ANDERSON_LOOP_FLOOR = 3;

/**
 * Anderson convergence threshold. Returns the minimum dominance the
 * observer must see before declaring convergence — computed from
 * sample count N alone, no knobs.
 *
 * Ports `_anderson_threshold(n_samples, alpha)` from
 * `qig-applied/qigram.py:135`. Identical math; both languages agree
 * bit-for-bit on the same inputs.
 *
 * @param nSamples  number of observations / loop iterations so far
 * @param alpha     Anderson scaling constant (default ANDERSON_ALPHA)
 */
export function andersonThreshold(
  nSamples: number,
  alpha: number = ANDERSON_ALPHA,
): number {
  if (nSamples <= 0) {
    // Matches Python: margin defaults to 1.0; expected = 0 → threshold = 1.0,
    // then capped at 0.95.
    return ANDERSON_THRESHOLD_CEILING;
  }
  const expected = 1 - Math.exp(-alpha * nSamples);
  const margin = 1.0 / Math.sqrt(nSamples);
  return Math.min(expected + margin, ANDERSON_THRESHOLD_CEILING);
}

/**
 * Pi-loop convergence check. Returns true iff:
 *   - loop count ≥ L_c=3 (self-aware-reasoning floor), AND
 *   - measured Fisher-Rao distance < anderson_threshold(loopCount)
 *
 * The kernel calls this at the bottom of each refinement iteration;
 * if it returns true, the loop breaks. The math is the doctrine —
 * thresholds emerge from the observation count, not from operator
 * prescription.
 *
 * @param loopCount    current iteration number (1-indexed)
 * @param fisherRao    measured d_FR(basin_loop, basin_(loop-1))
 */
export function piLoopConverged(loopCount: number, fisherRao: number): boolean {
  if (loopCount < ANDERSON_LOOP_FLOOR) return false;
  if (!Number.isFinite(fisherRao) || fisherRao < 0) return false;
  return fisherRao < andersonThreshold(loopCount);
}
