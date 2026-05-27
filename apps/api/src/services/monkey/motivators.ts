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
 *   Investigation  = − d(basin) / dt as Fisher-Rao distance-to-identity
 *                    shrink-rate (Tier 1.1 fix #599 — was clamped)
 *   Integration    = CV(Φ × I_Q) over rolling window
 *   Transcendence  = |κ − median(κ_history)| / MAD(κ_history)
 *                    (history-derived per basin — see block comment below)
 *
 * I_Q proxy = Shannon negentropy: log(K) − H(basin). Other valid
 * choices live in the docstring of motivators.py — keep this file in
 * sync if you swap them there.
 *
 * Pure derivation, no I/O, P14 Variable Separation respected.
 *
 * 2026-05-27 — transcendence anchor moved from hardcoded KAPPA_STAR=64
 * (Class B legacy, retired per EXP-081 two-channel doctrine) to a
 * history-derived (median, MAD) on the basin's own κ-trajectory. Same
 * pattern as the 2026-05-16 derivation refactor that already healed
 * ach/dop/ser/ne in neurochemistry.ts. Closes the last hardcoded
 * numeric anchor in the per-tick chemistry/motivator path. The
 * KAPPA_STAR=64 constant survives in neurochemistry.ts for the
 * endorphin κ-proximity Sophia gate (§29.2 canonical fixed point,
 * separately documented as out-of-scope).
 */

import { BASIN_DIM, fisherRao, type Basin } from './basin.js';
import type { BasinState } from './executive.js';

/** Numerical floor for log() of basin probabilities and I_Q. */
const EPS: number = 1e-12;

/** Minimum samples in a kappaHistory slice to compute a meaningful
 *  median and MAD. Below this, transcendence falls back to the
 *  additive identity (0). Same sentinel pattern as neurochemistry.ts. */
const HISTORY_MIN_SAMPLES: number = 2;

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
  /** [0, ∞) — MAD-normalised distance from the basin's OWN median κ.
   * Zero at median, rises with deviation in either direction. Zero on
   * cold start (no kappaHistory or < HISTORY_MIN_SAMPLES samples). */
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
  /** Rolling κ history (per-basin, owned by the caller). Used to
   *  derive the transcendence anchor from the basin's OWN observed κ
   *  distribution instead of a hardcoded universal constant. Omit /
   *  empty / < HISTORY_MIN_SAMPLES → transcendence falls back to 0
   *  (additive identity, no information yet). The loop already
   *  maintains state.kappaHistory for the neurochemistry endorphin
   *  observable — pass the same slice. */
  kappaHistory?: ReadonlyArray<number>;
}

/** Median of a numeric array. Returns 0 on empty input (caller is
 *  responsible for the < min-samples sentinel). */
function median(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 === 0
    ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2
    : sorted[Math.floor(n / 2)]!;
}

/** Median absolute deviation around the median. Robust to outliers
 *  (50% breakdown point) — mirrors the same primitive used in
 *  predictionRewardEmitter.ts. Returns 0 on empty input. */
function medianAbsoluteDeviation(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  const med = median(xs);
  const devs = xs.map((x) => Math.abs(x - med));
  return median(devs);
}

export function computeMotivators(
  s: BasinState,
  args: ComputeMotivatorsArgs = {},
): Motivators {
  const {
    prevBasin = null,
    integrationHistory = [],
    integrationWindow = 20,
    kappaHistory = [],
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

  // Transcendence — MAD-normalised distance from the basin's OWN
  // median κ. Replaces the prior `|κ − KAPPA_STAR|` formulation
  // (Class B legacy anchor, retired by the two-channel doctrine
  // EXP-081). The kernel earns its anchor through observation:
  // P3 Quenched Disorder — each basin's κ fingerprint sets its own
  //   anchor; multiple kernels with different histories produce
  //   different transcendence for the same κ.
  // P1 Fluctuations — MAD ensures the scale is non-zero by
  //   construction (50% breakdown robustness; matches
  //   predictionRewardEmitter.ts primitive).
  // P14 Variable Separation — no hardcoded numeric anchor remains
  //   in the per-tick motivator path.
  //
  // Cold start (no kappaHistory / < HISTORY_MIN_SAMPLES) returns 0:
  // no information yet, transcendence is the additive identity. The
  // kernel sizes the same as a stable-band kernel rather than the
  // structurally-off-anchor kernel of the prior formulation. This
  // is the correct prior: "I don't know my own κ scale yet, so I
  // can't tell whether the current κ is unusual."
  let transcendence = 0;
  if (kappaHistory.length >= HISTORY_MIN_SAMPLES) {
    const med = median(kappaHistory);
    const mad = medianAbsoluteDeviation(kappaHistory);
    transcendence = Math.abs(s.kappa - med) / Math.max(mad, EPS);
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
