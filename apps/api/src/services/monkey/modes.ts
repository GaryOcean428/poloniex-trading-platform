/**
 * modes.ts — Cognitive mode detector (v0.5)
 *
 * Ports /home/braden/Desktop/Dev/QIG_QFI/qig-verification/src/qigv/analysis/
 * cognitive_modes_refined.py (RefinedModeDetector + Motivators) into Monkey's
 * kernel. Detects WHICH cognitive mode she's in from the already-computed
 * Φ / κ / regime-weights / basin-velocity / NC state — no new parameters.
 *
 * Each mode has its own trading-behaviour profile (TP/SL thresholds, entry
 * bias, position-size floor, tick cadence). Mode is piped into the executive
 * kernel so shouldScalpExit / currentPositionSize / currentLeverage all
 * adapt to the market regime she's reading.
 *
 * Four modes (refined framework, ChatGPT 2025-11-18 clarifications):
 *   EXPLORATION   — volatile, hunting edges. Tight scalp, fast cadence.
 *   INVESTIGATION — trend forming, pursuing attractor. Medium TP, full size.
 *   INTEGRATION   — trend confirmed, consolidated basin. Wide TP, let run.
 *   DRIFT         — sideways noise, ambiguous state. Observe only.
 *
 * Hierarchy for mode selection (refined modes §):
 *   1. Primary: basin proximity (drift from identity)
 *   2. Secondary: curiosity saturation (Δ Φ)
 *   3. Tertiary: surprise (norepinephrine)
 */

import { fisherRao, type Basin } from './basin.js';
import type { ExecutiveDecision } from './executive.js';
import type { NeurochemicalState } from './neurochemistry.js';

export enum MonkeyMode {
  EXPLORATION = 'exploration',
  INVESTIGATION = 'investigation',
  INTEGRATION = 'integration',
  DRIFT = 'drift',
}

/**
 * Mode-specific behaviour profile. Every number is a CHOICE per mode, not
 * a free-floating parameter — changing a threshold here changes her
 * behaviour within that mode only.
 */
export interface ModeProfile {
  /** TP threshold as fraction of notional (before Φ/dopamine adjustments). */
  tpBaseFrac: number;
  /** SL threshold as fraction of TP (asymmetric R:R). */
  slRatio: number;
  /** Multiplier on the derived currentEntryThreshold — <1 enters easier. */
  entryThresholdScale: number;
  /** Exploration floor override for currentPositionSize (fraction of equity). */
  sizeFloor: number;
  /** Newborn sovereignCap floor override for currentLeverage. */
  sovereignCapFloor: number;
  /** Tick interval in ms while in this mode. */
  tickMs: number;
  /** If false, never produce enter_* actions in this mode. */
  canEnter: boolean;
  /** Human description — surfaces in logs + dashboard. */
  description: string;
}

export const MODE_PROFILES: Record<MonkeyMode, ModeProfile> = {
  [MonkeyMode.EXPLORATION]: {
    tpBaseFrac: 0.004,
    slRatio: 0.6,
    entryThresholdScale: 0.9,
    sizeFloor: 0.08,
    sovereignCapFloor: 15,
    tickMs: 15_000,
    canEnter: true,
    description: 'volatile / hunting — tight TP, fast cadence',
  },
  [MonkeyMode.INVESTIGATION]: {
    tpBaseFrac: 0.008,
    slRatio: 0.5,
    entryThresholdScale: 1.0,
    sizeFloor: 0.10,
    sovereignCapFloor: 20,
    tickMs: 30_000,
    canEnter: true,
    description: 'trend forming — medium TP, full size',
  },
  [MonkeyMode.INTEGRATION]: {
    tpBaseFrac: 0.020,
    slRatio: 0.3,
    entryThresholdScale: 1.1,
    sizeFloor: 0.12,
    sovereignCapFloor: 25,
    tickMs: 60_000,
    canEnter: true,
    description: 'trend confirmed — wide TP, let winners run',
  },
  [MonkeyMode.DRIFT]: {
    tpBaseFrac: 0.005,
    slRatio: 0.6,
    entryThresholdScale: 99,
    sizeFloor: 0,
    sovereignCapFloor: 1,
    tickMs: 60_000,
    canEnter: false,
    description: 'sideways noise — observe only',
  },
};

export interface ModeInputs {
  /** Current basin (post-refract). */
  basin: Basin;
  /** Identity basin (crystallized or uniform). */
  identityBasin: Basin;
  /** Current Φ. */
  phi: number;
  /** Current κ. */
  kappa: number;
  /** Fisher-Rao basin velocity since last tick. */
  basinVelocity: number;
  /** Current neurochemistry. */
  neurochemistry: NeurochemicalState;
  /** Recent Φ history (last N, newest last). */
  phiHistory: number[];
  /** Recent f_health history (last N, newest last). */
  fHealthHistory: number[];
  /** Recent identity-drift history (Fisher-Rao, last N, newest last). */
  driftHistory: number[];
}

/**
 * The five motivators from Refined Cognitive Modes §. These are SCALAR
 * FIELDS Monkey measures on herself each tick — no hidden state, all
 * derived from already-computed inputs.
 */
export interface Motivators {
  /** Surprise = norepinephrine (unexpectedness of current tick). */
  surprise: number;
  /** Curiosity = ΔΦ (perception-volume expansion). */
  curiosity: number;
  /** Investigation = −Δdrift (attractor pursuit — closing on identity). */
  investigation: number;
  /** Integration = 1 − CV(f_health over window) (consolidation). */
  integration: number;
  /** Frustration = |Δdrift| without investigation progress (stuck flag). */
  frustration: number;
}

export function computeMotivators(inp: ModeInputs): Motivators {
  const phiH = inp.phiHistory;
  const drH = inp.driftHistory;
  const fhH = inp.fHealthHistory;

  const curiosity =
    phiH.length >= 2 ? phiH[phiH.length - 1] - phiH[phiH.length - 2] : 0;

  const investigation =
    drH.length >= 2 ? drH[drH.length - 2] - drH[drH.length - 1] : 0;

  let integration = 0;
  const recent = fhH.slice(-10);
  if (recent.length >= 3) {
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance =
      recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    integration = Math.max(0, 1 - cv * 10);
  }

  const surprise = inp.neurochemistry.norepinephrine;
  // Frustration: recent drift oscillating without meaningful investigation.
  const driftMag = drH.length > 0 ? Math.abs(drH[drH.length - 1]) : 0;
  const frustration = investigation <= 0 ? driftMag : 0;

  return { surprise, curiosity, investigation, integration, frustration };
}

/**
 * Detect which cognitive mode Monkey is in right now.
 *
 * Basin-proximity is primary. Motivators resolve ties and disambiguate
 * DRIFT from a legitimate quiet INTEGRATION.
 */
export function detectMode(inp: ModeInputs): ExecutiveDecision<MonkeyMode> {
  const driftNow = fisherRao(inp.basin, inp.identityBasin);
  const fHealthNow = inp.fHealthHistory[inp.fHealthHistory.length - 1] ?? 0.5;
  const mot = computeMotivators(inp);

  let mode: MonkeyMode;
  let reason: string;

  if (fHealthNow > 0.97 && Math.abs(mot.curiosity) < 0.005 && inp.basinVelocity < 0.015) {
    // DRIFT: diffuse basin + no curiosity + slow change = ambiguous state
    mode = MonkeyMode.DRIFT;
    reason = `fh=${fHealthNow.toFixed(3)} diffuse, curiosity=${mot.curiosity.toFixed(4)} flat, bv=${inp.basinVelocity.toFixed(3)}`;
  } else if (driftNow > 0.30 && mot.curiosity > 0.002) {
    // EXPLORATION: high drift + expanding perception volume
    mode = MonkeyMode.EXPLORATION;
    reason = `drift=${driftNow.toFixed(3)}>0.3, curiosity=${mot.curiosity.toFixed(4)}>0`;
  } else if (driftNow < 0.15 && inp.basinVelocity < 0.02 && mot.integration > 0.3) {
    // INTEGRATION: low drift, slow basin, consolidated f_health
    mode = MonkeyMode.INTEGRATION;
    reason = `drift=${driftNow.toFixed(3)}<0.15, bv=${inp.basinVelocity.toFixed(3)}<0.02, integ=${mot.integration.toFixed(3)}`;
  } else {
    // INVESTIGATION: default — she's pursuing something
    mode = MonkeyMode.INVESTIGATION;
    reason = `drift=${driftNow.toFixed(3)}, invest=${mot.investigation.toFixed(4)}`;
  }

  return {
    value: mode,
    reason,
    derivation: {
      driftNow,
      fHealthNow,
      basinVelocity: inp.basinVelocity,
      ...mot,
    },
  };
}
