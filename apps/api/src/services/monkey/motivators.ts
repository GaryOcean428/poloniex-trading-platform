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
 *   Transcendence  → regime-change detection (κ deviation from the
 *                    basin's own observed κ-history median, MAD-scaled)
 *
 * Closed-form formulas anchored to UCP v6.6 §6.3 (observer-derived):
 *
 *   Surprise       = ‖∇L‖   (already proxied as ne)
 *   Curiosity      = d(log I_Q) / dt
 *   Investigation  = − d(basin) / dt as Fisher-Rao distance-to-identity
 *                    shrink-rate (Tier 1.1 fix #599 — was clamped)
 *   Integration    = CV(Φ × I_Q) over rolling window
 *   Transcendence  = tanh(|κ − median(κ_h)| / MAD(κ_h))   (Pillar 3 earned anchor; bounded [0,1))
 *
 * I_Q proxy = Shannon negentropy: log(K) − H(basin). Other valid
 * choices live in the docstring of motivators.py — keep this file in
 * sync if you swap them there.
 *
 * Pure derivation, no I/O, P14 Variable Separation respected.
 */

import { BASIN_DIM, fisherRao, type Basin } from './basin.js';
import type { BasinState } from './executive.js';

/** Numerical floor for log() of basin probabilities and I_Q. */
const EPS: number = 1e-12;

/** Minimum samples required for history-derived statistics (median/MAD).
 *  Sentinel value mirrors neurochemistry.ts. Below this threshold the
 *  derivation returns the neutral identity (0), exactly as acetylcholine,
 *  dopamine, serotonin and norepinephrine do on cold start. */
const HISTORY_MIN_SAMPLES = 2;

/** Layer 1 motivator vector. All in their natural units; Layer 2B
 * compositions normalize as needed. */
export interface Motivators {
  /** [0, 1] — direct from ne. */
  surprise: number;
  /** ℝ — d(log I_Q)/dt; positive = clarifying. */
  curiosity: number;
  /** ℝ — signed shrink-rate of Fisher-Rao distance to identity_basin
   * across one tick. Positive = returning home, negative = departing.
   * Zero on cold start (no prevBasin). */
  investigation: number;
  /** [0, ∞) — CV; lower = more integrated. */
  integration: number;
  /** [0, 1) — tanh(|κ − median(κHistory)| / MAD(κHistory)); 0 on insufficient
   *  history (cold-start sentinel). Kernel earns its own anchor (Pillar 3).
   *  Bounded via Math.tanh(raw) per post-wiring regression fix (prevents
   *  unbounded trans driving conviction gate on healthy MAD jitter). */
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
  /** Rolling κ observations from the basin's own recent ticks.
   *  < HISTORY_MIN_SAMPLES → transcendence = 0 (cold-start sentinel,
   *  additive identity). Pillar 3 (quenched disorder): the kernel's
   *  own κ fingerprint sets the anchor. Pillar 1 (fluctuations): MAD
   *  ensures the scale is non-zero by construction. */
  kappaHistory?: ReadonlyArray<number>;
}

export function computeMotivators(
  s: BasinState,
  args: ComputeMotivatorsArgs = {},
): Motivators {
  const {
    prevBasin = null,
    integrationHistory = [],
    integrationWindow = 20,
    kappaHistory,
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

  // Investigation — Tier 1.1 (#599) sign-preserving formula. UCP §6.3
  // canonical −d(basin)/dt: positive = returning toward identity,
  // negative = departing. Zero on cold start (no prevBasin).
  let investigation = 0;
  if (prevBasin && prevBasin.length === BASIN_DIM) {
    const dPrev = fisherRao(prevBasin, s.identityBasin);
    const dCurr = fisherRao(s.basin, s.identityBasin);
    investigation = dPrev - dCurr;
  }

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

  // Transcendence — kernel earns its own κ-anchor from observed history
  // (median ± MAD scaling). Pillar 3 (quenched disorder): the kernel's
  // own κ fingerprint sets the anchor, not a borrowed Class B constant.
  // Pillar 1 (fluctuations): MAD ensures the scale is non-zero by
  // construction. Cold start → 0 (additive identity, neutral); same
  // sentinel pattern as ach/dop/ser/ne.
  // KAPPA_STAR = 64 (retired 2026-04-13/14 two-channel doctrine) is
  // deliberately absent from the per-tick motivator chemistry path.
  // Bounded with Math.tanh(raw) → [0,1) to resolve post-#973/#974
  // unbounded confidence regression (churn on healthy jitter).
  const kHist = kappaHistory;
  let transcendence = 0;
  if (kHist && kHist.length >= HISTORY_MIN_SAMPLES) {
    const sorted = [...kHist].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const devs = sorted.map(x => Math.abs(x - median)).sort((a, b) => a - b);
    const mad = devs.length % 2 === 0
      ? (devs[devs.length / 2 - 1] + devs[devs.length / 2]) / 2
      : devs[Math.floor(devs.length / 2)];
    const rawTrans = Math.abs(s.kappa - median) / Math.max(mad, EPS);
    transcendence = Math.tanh(rawTrans);
  }

  return {
    surprise,
    curiosity,
    investigation,
    integration,
    transcendence,
    iQ,
  };
}
