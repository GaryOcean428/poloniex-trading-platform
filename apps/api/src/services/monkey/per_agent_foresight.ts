/**
 * per_agent_foresight.ts — basin trajectory prediction for any agent.
 *
 * Foresight: given the current basin and a short trajectory, predict
 * where the basin will be N ticks ahead. Compare proposed entry to
 * the predicted basin direction — if the prediction says reversal,
 * dampen the entry.
 *
 * QIG-pure: prediction is a Fisher-Rao geodesic extrapolation in
 * sqrt-coords, NOT a linear extrapolation of basin coordinates. The
 * SLERP from the previous basin through the current basin to the
 * predicted basin is the canonical geodesic on Δ⁶³.
 *
 * Pure functions only.
 */

import { fisherRao, slerp, type Basin } from './basin.js';
import { basinDirection } from './perception.js';

export interface ForesightResult {
  predictedBasin: Basin;
  /** Predicted basin direction at i+horizon. Same range as
   *  basinDirection() — typically [-1, +1]. */
  predictedDirection: number;
  /** Confidence in the prediction. Lower when the basin is changing
   *  too rapidly or when history is too short. [0, 1]. */
  confidence: number;
}

/** Predict the basin N ticks ahead via SLERP geodesic extrapolation.
 *
 *  Method: take the last ``lookback`` basins, compute the average
 *  step (Fréchet mean of pairwise SLERP steps), apply that step
 *  ``horizon`` times forward.
 *
 *  Simplification: instead of computing the full average step, we
 *  use the secant method — extrapolate the line through (history[-2],
 *  history[-1]) by t = horizon as the SLERP parameter. This is a
 *  first-order approximation but fast and stable.
 */
export function predictBasin(
  history: readonly Basin[],
  horizon: number = 4,
): ForesightResult | null {
  if (history.length < 2) return null;
  const prev = history[history.length - 2]!;
  const curr = history[history.length - 1]!;

  // SLERP from prev through curr. t=0 is prev, t=1 is curr, t=2 is
  // one step beyond curr in the same direction. We want t = 1 +
  // horizon (to extrapolate ``horizon`` ticks beyond current).
  const t = 1 + horizon;
  const predicted = slerp(prev, curr, t);

  // Confidence: how far apart prev and curr are. Bigger gap = noisier
  // step = lower confidence in long-horizon extrapolation.
  const stepDistance = fisherRao(prev, curr);
  const maxStep = Math.PI / 8; // beyond this, prediction is unreliable
  const confidence = Math.max(0, Math.min(1, 1 - stepDistance / maxStep));

  return {
    predictedBasin: predicted,
    predictedDirection: basinDirection(predicted),
    confidence,
  };
}

/** Foresight veto: should this proposed entry be blocked because
 *  the basin trajectory predicts a reversal?
 *
 *  Returns:
 *    - { veto: true, reason } when foresight predicts strong reversal
 *      with sufficient confidence
 *    - { veto: false } otherwise
 *
 *  Pure function. */
export interface ForesightVetoResult {
  veto: boolean;
  reason: string;
  predictedDirection: number;
  confidence: number;
}

export function foresightVeto(
  history: readonly Basin[],
  proposedSide: 'long' | 'short',
  horizon: number = 4,
  /** Reversal threshold: predicted direction crossing zero AND opposite
   *  to proposed side at this magnitude blocks. Default 0.20. */
  reversalThreshold: number = 0.20,
  /** Minimum confidence to act on foresight. Below this we don't veto. */
  minConfidence: number = 0.5,
): ForesightVetoResult {
  const f = predictBasin(history, horizon);
  if (f === null) {
    return {
      veto: false, reason: 'foresight_unavailable',
      predictedDirection: 0, confidence: 0,
    };
  }
  if (f.confidence < minConfidence) {
    return {
      veto: false, reason: `low_confidence:${f.confidence.toFixed(2)}`,
      predictedDirection: f.predictedDirection, confidence: f.confidence,
    };
  }
  const proposedSign = proposedSide === 'long' ? 1 : -1;
  // Veto when the predicted direction has the OPPOSITE sign of the
  // proposed side AND magnitude exceeds threshold.
  const conflict =
    Math.sign(f.predictedDirection) === -proposedSign &&
    Math.abs(f.predictedDirection) >= reversalThreshold;
  if (conflict) {
    return {
      veto: true,
      reason: `foresight_reversal:predicted=${f.predictedDirection.toFixed(3)} side=${proposedSide} confidence=${f.confidence.toFixed(2)}`,
      predictedDirection: f.predictedDirection,
      confidence: f.confidence,
    };
  }
  return {
    veto: false,
    reason: `foresight_aligned:predicted=${f.predictedDirection.toFixed(3)} side=${proposedSide}`,
    predictedDirection: f.predictedDirection,
    confidence: f.confidence,
  };
}
