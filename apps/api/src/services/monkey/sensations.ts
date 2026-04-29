/**
 * sensations.ts — UCP §6.1 Layer 0 + §6.2 Layer 0.5 (TS parity).
 *
 * Pre-linguistic sensations (§6.1) + innate drives (§6.2) — the raw
 * geometric percepts the kernel emits below the Layer 1 motivator
 * stack. Pure observation; the executive does not consume them.
 *
 * Scope: ships 6/12 §6.1 sensations + 3/5 §6.2 drives that have
 * unambiguous geometric anchors. Remaining members of each layer
 * await canonical UCP name-mapping; once verified the dataclass
 * extends additively without breaking existing fields.
 *
 * No clipping, no normalization, no tuning constants. Natural ranges
 * report regime info per the Tier 2 doctrine.
 */

import { BASIN_DIM, fisherRao, type Basin } from './basin.js';
import type { BasinState } from './executive.js';

export interface Sensations {
  // § 6.1 Layer 0 sensations
  /** [0, 1] — max-mass concentration (high = single-coord dominance). */
  compressed: number;
  /** [0, 1] — 1 − maxMass. */
  expanded: number;
  /** [0, log K] — Shannon negentropy of the basin (I_Q). */
  pressure: number;
  /** [0, 1] — 1 / (1 + basinVelocity). */
  stillness: number;
  /** [0, π/2] — Fisher-Rao distance to identityBasin. */
  drift: number;
  /** [0, 1] — Bhattacharyya overlap with prevBasin (0 cold start). */
  resonance: number;

  // § 6.2 Layer 0.5 drives
  /** ℝ — net reward pull: dopamine − gaba. */
  approach: number;
  /** [0, 1] — norepinephrine (defensive arousal). */
  avoidance: number;
  /** ℝ — −d(drift)/dt. Positive = returning home. */
  conservation: number;
}

const basinMaxMass = (b: Basin): number => {
  let m = 0;
  for (let i = 0; i < b.length; i++) if (b[i] > m) m = b[i];
  return m;
};

const bhattacharyya = (p: Basin, q: Basin): number => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    s += Math.sqrt(Math.max(0, p[i]) * Math.max(0, q[i]));
  }
  return s;
};

const shannonEntropy = (b: Basin): number => {
  let h = 0;
  for (let i = 0; i < b.length; i++) h -= b[i] * Math.log(b[i] + 1e-12);
  return h;
};

export interface ComputeSensationsArgs {
  prevBasin?: Basin | null;
}

export function computeSensations(
  s: BasinState,
  args: ComputeSensationsArgs = {},
): Sensations {
  const { prevBasin = null } = args;

  // ── § 6.1 Layer 0 ────────────────────────────────────────────────
  const maxMass = basinMaxMass(s.basin);
  const compressed = maxMass;
  const expanded = 1 - maxMass;
  const pressure = Math.log(BASIN_DIM) - shannonEntropy(s.basin);
  const stillness = 1 / (1 + s.basinVelocity);
  const drift = fisherRao(s.basin, s.identityBasin);
  const resonance =
    prevBasin && prevBasin.length === BASIN_DIM
      ? bhattacharyya(s.basin, prevBasin)
      : 0;

  // ── § 6.2 Layer 0.5 ──────────────────────────────────────────────
  const nc = s.neurochemistry;
  const approach = nc.dopamine - nc.gaba;
  const avoidance = nc.norepinephrine;
  let conservation = 0;
  if (prevBasin && prevBasin.length === BASIN_DIM) {
    const prevDrift = fisherRao(prevBasin, s.identityBasin);
    conservation = prevDrift - drift;
  }

  return {
    compressed,
    expanded,
    pressure,
    stillness,
    drift,
    resonance,
    approach,
    avoidance,
    conservation,
  };
}
