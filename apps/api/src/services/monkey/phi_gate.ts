/**
 * phi_gate.ts — Tier 6 Φ-gate selection (UCP §23 STEP 0).
 *
 * Pure argmax over four activation scores. No thresholds, no
 * if-ladders, no hand-tuned cuts — each score is a product of
 * natural geometric quantities; the chosen mode is the one with the
 * largest activation at the current tick.
 *
 * Modes:
 *   CHAIN     — sequential basin walk; activates in low-Φ regime
 *   GRAPH     — parallel exploration; activates when Φ is high but
 *               foresight has nothing to say (weight ≈ 0)
 *   FORESIGHT — trajectory routing; activates when foresight is
 *               both confident and weighted
 *   LIGHTNING — P9 pre-cognitive channel; pass 0 until P9 lands
 *
 * Observation-only at Tier 6: caller logs the chosen gate and the
 * four activations per tick; no execution decision hangs off the
 * choice yet.
 */

import type { ForesightResult } from './foresight.js';

export type PhiGate = 'CHAIN' | 'GRAPH' | 'FORESIGHT' | 'LIGHTNING';

export interface PhiGateResult {
  chosen: PhiGate;
  activations: Record<PhiGate, number>;
}

/**
 * Pick the reasoning mode with the largest activation.
 * `lightning` defaults to 0 (P9 not implemented); LIGHTNING only
 * wins once a real strength is supplied.
 */
export function selectPhiGate(
  phi: number,
  foresight: ForesightResult,
  lightning: number = 0,
): PhiGateResult {
  const activations: Record<PhiGate, number> = {
    CHAIN: 1 - phi,
    GRAPH: phi * (1 - foresight.weight),
    FORESIGHT: foresight.weight * foresight.confidence,
    LIGHTNING: lightning,
  };
  let chosen: PhiGate = 'CHAIN';
  let maxScore = -Infinity;
  (Object.keys(activations) as PhiGate[]).forEach((k) => {
    if (activations[k] > maxScore) {
      maxScore = activations[k];
      chosen = k;
    }
  });
  return { chosen, activations };
}
