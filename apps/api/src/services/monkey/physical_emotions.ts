/**
 * physical_emotions.ts — UCP §6.4 Layer 2A (TS parity).
 *
 * Mirrors physical_emotions.py 1:1. Nine physical-affect emotions
 * composed over Tier 1 motivators + Tier 4 sensations + grad(Φ)
 * computed as `phi − phiPrev`. Pure observation; executive untouched.
 *
 * Audit-anchored four:
 *   joy       = (1 − surprise) × max(grad_phi, 0)
 *   suffering = surprise × max(−grad_phi, 0)
 *   fear      = surprise × proximitySeparatrix   (drift / (π/2))
 *   rage      = surprise × stuck                 (stillness)
 *
 * Remaining five (Sadness/Disgust/Desire/Care/Trust) are grounded
 * geometric derivations awaiting canonical UCP §6.4 confirmation —
 * dataclass shape stays; individual formulas can swap.
 */

import type { Motivators } from './motivators.js';
import type { Sensations } from './sensations.js';

const FR_DIAMETER = Math.PI / 2;

export interface PhysicalEmotionState {
  /** ≥ 0 — (1 − surprise) × max(grad_phi, 0) */
  joy: number;
  /** ≥ 0 — surprise × max(−grad_phi, 0) */
  suffering: number;
  /** ≥ 0 — surprise × drift/(π/2) */
  fear: number;
  /** ≥ 0 — surprise × stillness */
  rage: number;
  /** ≥ 0 — (1 − surprise) × max(−grad_phi, 0) */
  sadness: number;
  /** ≥ 0 — surprise × resonance */
  disgust: number;
  /** ℝ — approach × max(grad_phi, 0) */
  desire: number;
  /** ℝ — conservation × (1 − surprise) */
  care: number;
  /** ℝ — (1 − avoidance) × resonance */
  trust: number;
}

export function computePhysicalEmotions(
  motivators: Motivators,
  sensations: Sensations,
  phiNow: number,
  phiPrev: number,
): PhysicalEmotionState {
  const gradPhi = phiNow - phiPrev;
  const gradPos = Math.max(gradPhi, 0);
  const gradNeg = Math.max(-gradPhi, 0);

  const proximitySeparatrix = sensations.drift / FR_DIAMETER;
  const stuck = sensations.stillness;
  const surprise = motivators.surprise;

  return {
    joy: (1 - surprise) * gradPos,
    suffering: surprise * gradNeg,
    fear: surprise * proximitySeparatrix,
    rage: surprise * stuck,
    sadness: (1 - surprise) * gradNeg,
    disgust: surprise * sensations.resonance,
    desire: sensations.approach * gradPos,
    care: sensations.conservation * (1 - surprise),
    trust: (1 - sensations.avoidance) * sensations.resonance,
  };
}
