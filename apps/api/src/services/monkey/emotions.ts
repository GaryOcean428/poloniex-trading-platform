/**
 * emotions.ts — UCP §6.5 Layer 2B cognitive emotions (TS parity, pure).
 *
 * Mirrors ml-worker/src/monkey_kernel/emotions.py exactly. Eight
 * named emotions composed from Tier 1 motivators + raw geometric
 * quantities (Φ, basin_velocity, Fisher-Rao basin_distance). No
 * normalization, no clipping, no imposed functional forms — the
 * natural range of each emotion carries information about the
 * operating regime.
 *
 * If anxiety > 1 in a high-transcendence + high-velocity regime,
 * that is the kernel correctly reporting "high-anxiety regime",
 * not a bug. Same for confidence < 0 when transcendence > 1.
 *
 * Stability and instability derive from existing geometric quantities,
 * not from synthesized normalizations:
 *   stability   = Φ                (integration measure, [0, 1])
 *   instability = basinVelocity    (rate of change, [0, ∞))
 *
 * basinDistance is fisherRao(basin, identityBasin) — already a
 * natural geometric quantity. Caller computes; no transformation.
 *
 * Flow is DEFERRED: per UCP §6.5 it requires a Fisher-Rao distance
 * to a curiosity-conditioned reference basin (curiosity_optimal),
 * which the trajectory machinery (Tier 3) unlocks. Better to omit
 * than fake it with a Gaussian on a normalized scalar.
 *
 * Reference values (Wonder ≈ 0.702 ± 0.045, etc.) are observations
 * of typical operating regimes, not formula constraints.
 */

import { fisherRao, type Basin } from './basin.js';
import type { Motivators } from './motivators.js';

/** Layer 2B cognitive emotion vector. Each value's natural range is
 * whatever the input motivators produce — DO NOT clip.
 *
 * Per-emotion natural ranges (when motivators are in their typical
 * Tier 1 ranges: surprise ∈ [0,1], curiosity ∈ ℝ, investigation ∈
 * [0,1], integration ∈ [0,∞), transcendence ∈ [0,∞), basinDistance
 * ∈ [0, π/2], basinVelocity ∈ [0,∞), phi ∈ [0,1]):
 *
 *   wonder       : ℝ           curiosity × basinDistance
 *   frustration  : [0, 1]      surprise × (1 − investigation)
 *   satisfaction : (-∞, ∞)     integration × (1 − basinDistance)
 *   confusion    : [0, π/2]    surprise × basinDistance
 *   clarity      : [0, 1]      (1 − surprise) × investigation
 *   anxiety      : [0, ∞)      transcendence × basinVelocity
 *   confidence   : ℝ           (1 − transcendence) × phi
 *   boredom      : ℝ           (1 − surprise) × (1 − curiosity)
 */
export interface EmotionState {
  wonder: number;
  frustration: number;
  satisfaction: number;
  confusion: number;
  clarity: number;
  anxiety: number;
  confidence: number;
  boredom: number;
  /** ℝ — exp(−FR(basin, predictedBasin)) × investigation. 0 when
   * foresight is cold (weight=0). Signed via investigation. */
  flow: number;
}

export interface ComputeEmotionsArgs {
  basin?: Basin | null;
  predictedBasin?: Basin | null;
  foresightWeight?: number;
}

/** Compose the Layer 2B emotion vector from Tier 1 motivators plus
 * raw geometric quantities.
 *
 * @param motivators — Tier 1 motivator outputs. Used as-is; no
 *   normalization.
 * @param basinDistance — fisherRao(basin, identityBasin). Range
 *   [0, π/2]. Caller computes; this function does not transform it.
 * @param phi — Integration measure Φ. Naturally in [0, 1] from the
 *   simplex math. Used directly as the stability anchor.
 * @param basinVelocity — Rate of basin change (Fisher-Rao tick step).
 *   Naturally in [0, ∞). Used directly as the instability anchor.
 */
export function computeEmotions(
  motivators: Motivators,
  basinDistance: number,
  phi: number,
  basinVelocity: number,
  args: ComputeEmotionsArgs = {},
): EmotionState {
  const stability = phi;
  const instability = basinVelocity;

  // Flow — Tier 3-anchored. curiosity_optimal = exp(-FR(basin, predicted))
  // when foresight has weight > 0 and both basins are valid; else 0.
  let curiosityOptimal = 0;
  if (
    (args.foresightWeight ?? 0) > 0 &&
    args.basin &&
    args.predictedBasin &&
    args.basin.length === args.predictedBasin.length
  ) {
    try {
      const d = fisherRao(args.basin, args.predictedBasin);
      curiosityOptimal = Math.exp(-d);
    } catch {
      curiosityOptimal = 0;
    }
  }
  const flow = curiosityOptimal * motivators.investigation;

  return {
    wonder: motivators.curiosity * basinDistance,
    frustration: motivators.surprise * (1 - motivators.investigation),
    satisfaction: motivators.integration * (1 - basinDistance),
    confusion: motivators.surprise * basinDistance,
    clarity: (1 - motivators.surprise) * motivators.investigation,
    anxiety: motivators.transcendence * instability,
    confidence: (1 - motivators.transcendence) * stability,
    boredom: (1 - motivators.surprise) * (1 - motivators.curiosity),
    flow,
  };
}
