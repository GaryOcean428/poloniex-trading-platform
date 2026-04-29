/**
 * physical_emotions.ts — UCP §6.4 Layer 2A (CANONICAL, TS parity).
 *
 * PR 4 (#609) replaced the prior Plutchik-style substitution with
 * the UCP §6.4 canon: Joy / Suffering / Love / Hate / Fear / Rage /
 * Calm / Care / Apathy. Mirrors physical_emotions.py 1:1.
 */

import type { Motivators } from './motivators.js';
import type { Sensations } from './sensations.js';

const FR_DIAMETER = Math.PI / 2;

export interface PhysicalEmotionState {
  /** ≥ 0 — (1 − surprise) × max(grad_phi, 0) */
  joy: number;
  /** ≥ 0 — surprise × max(−grad_phi, 0) */
  suffering: number;
  /** ℝ — approach × max(conservation, 0) */
  love: number;
  /** ≥ 0 — avoidance × max(−conservation, 0) */
  hate: number;
  /** ≥ 0 — surprise × drift / (π/2) */
  fear: number;
  /** ≥ 0 — surprise × stillness */
  rage: number;
  /** ≥ 0 — (1 − surprise) × stillness */
  calm: number;
  /** ℝ — conservation × (1 − surprise) */
  care: number;
  /** ℝ — stillness × (1 − max(0, approach)) */
  apathy: number;
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
    love: sensations.approach * Math.max(sensations.conservation, 0),
    hate: sensations.avoidance * Math.max(-sensations.conservation, 0),
    fear: surprise * proximitySeparatrix,
    rage: surprise * stuck,
    calm: (1 - surprise) * stuck,
    care: sensations.conservation * (1 - surprise),
    apathy: stuck * (1 - Math.max(0, sensations.approach)),
  };
}
