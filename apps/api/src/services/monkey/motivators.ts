/**
 * motivators.ts — UCP §6.3 Layer 1 motivators (TS parity).
 *
 * Mirrors ml-worker/src/monkey_kernel/motivators.py exactly. Five
 * named motivators derived from basin + neurochemistry on the current
 * BasinState:
 *
 *   Surprise       → entry-threshold relaxation (proxied via ne)
 *   Curiosity      → exploration vs exploitation
 *   Investigation  → cut-loss-or-hold (settled state = think)
 *   Integration    → conviction in current strategy (low CV = stable)
 *   Transcendence  → regime-change detection
 *
 * Closed-form formulas anchored to UCP v6.6 §6.3:
 *
 *   Surprise       = ‖∇L‖   (already proxied as ne)
 *   Curiosity      = d(log I_Q) / dt
 *   Investigation  = max(0, 1 − basin_velocity)   (clamped from −d(basin)/dt)
 *   Integration    = CV(Φ × I_Q) over rolling window
 *   Transcendence  = |κ − κ*|
 *
 * I_Q proxy = Shannon negentropy: log(K) − H(basin). Other valid
 * choices live in the docstring of motivators.py — keep this file in
 * sync if you swap them there.
 *
 * Pure derivation, no I/O, P14 Variable Separation respected.
 */

import { KAPPA_STAR, BASIN_DIM, type Basin } from './basin.js';
import type { BasinState } from './executive.js';

/** Numerical floor for log() of basin probabilities and I_Q. */
const EPS: number = 1e-12;

/** Layer 1 motivator vector. All in their natural units; Layer 2B
 * compositions normalize as needed. */
export interface Motivators {
  /** [0, 1] — direct from ne. */
  surprise: number;
  /** ℝ — d(log I_Q)/dt; positive = clarifying. */
  curiosity: number;
  /** [0, 1] — clamped 1 − basin_velocity. */
  investigation: number;
  /** [0, ∞) — CV; lower = more integrated. */
  integration: number;
  /** [0, ∞) — |κ − κ*|; higher = farther from anchor. */
  transcendence: number;
  /** [0, log(K)] — Shannon negentropy of the current basin. */
  iQ: number;
}

/** Shannon negentropy: log(K) − H(p). Maxed at log(K) on a Dirac;
 * zero on uniform. The Curiosity calculation depends on this proxy. */
export function basinInformation(basin: Basin): number {
  const K = basin.length;
  let H = 0;
  for (let i = 0; i < K; i++) {
    const p = basin[i];
    H -= p * Math.log(p + EPS);
  }
  return Math.log(K) - H;
}

export interface ComputeMotivatorsArgs {
  /** Basin from the previous tick. Omit/null on cold start →
   * curiosity = 0. */
  prevBasin?: Basin | null;
  /** Rolling window of recent (Φ, I_Q) tuples. < 2 entries →
   * integration = 0. */
  integrationHistory?: Array<[number, number]>;
  /** Cap on history length used for CV. Default 20 ticks. */
  integrationWindow?: number;
}

export function computeMotivators(
  s: BasinState,
  args: ComputeMotivatorsArgs = {},
): Motivators {
  const {
    prevBasin = null,
    integrationHistory = [],
    integrationWindow = 20,
  } = args;

  // Surprise — direct passthrough from ne.
  const surprise = s.neurochemistry.norepinephrine;

  // I_Q at current tick.
  const iQ = basinInformation(s.basin);

  // Curiosity — d(log I_Q)/dt across one tick.
  let curiosity = 0;
  if (prevBasin && prevBasin.length === BASIN_DIM) {
    const iQPrev = basinInformation(prevBasin);
    curiosity = Math.log(iQ + EPS) - Math.log(iQPrev + EPS);
  }

  // Investigation — settled-state motivator. Clamped to [0, 1] so it
  // composes with other Layer 1 / Layer 2B values.
  const investigation = Math.max(0, 1 - s.basinVelocity);

  // Integration — CV of (Φ × I_Q) over rolling window. Low = stable.
  let integration = 0;
  if (integrationHistory.length >= 2) {
    const window = integrationHistory.slice(-integrationWindow);
    const products = window.map(([phi, iq]) => phi * iq);
    const n = products.length;
    const mean = products.reduce((a, b) => a + b, 0) / n;
    if (mean > EPS) {
      const variance =
        products.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
      integration = Math.sqrt(variance) / mean;
    }
  }

  // Transcendence — distance from κ-anchor (KAPPA_STAR = 64).
  // Rises both when super-coherent (κ >> κ*) and super-decoherent
  // (κ << κ*); both states transcend the operating mode.
  const transcendence = Math.abs(s.kappa - KAPPA_STAR);

  return {
    surprise,
    curiosity,
    investigation,
    integration,
    transcendence,
    iQ,
  };
}
