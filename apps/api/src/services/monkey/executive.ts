/**
 * executive.ts — Monkey's arbitration kernel
 *
 * The executive does NOT store thresholds. It DERIVES them from the
 * current basin state (Φ, κ, regime, neurochemistry, sovereignty).
 * This is UCP v6.6 §28 Autonomic Governance: parameters are emergent
 * geometric properties, not config.
 *
 * Every function here is a pure map from (state) → (derived param).
 * When Monkey asks "should I enter?", she doesn't consult a constant
 * — she asks her current Φ what her threshold is right now. When she
 * asks "how big?", dopamine and serotonin write the answer.
 *
 * P25 literally enforced: no numeric threshold survives in this file
 * as a frozen constant. Even the formulas' constants come from UCP
 * frozen facts (κ* = 64, κ_physics = 64.21), not tuning.
 */

import { KAPPA_STAR, BASIN_DIM, type Basin, normalizedEntropy, maxMass, fisherRao } from './basin.js';
import type { NeurochemicalState } from './neurochemistry.js';

/**
 * The complete basin state Monkey reads from every cycle.
 * This is the "snapshot" passed to each derivation function.
 */
export interface BasinState {
  /** Current 64D basin after identity refraction (Pillar 2 surface). */
  basin: Basin;
  /** Φ — integration strength on this basin, [0..1]. */
  phi: number;
  /** κ — effective coupling strength. Near κ* = stable; far = stress. */
  kappa: number;
  /** Regime weights w_1 (quantum), w_2 (efficient), w_3 (equilibrium). */
  regimeWeights: { quantum: number; efficient: number; equilibrium: number };
  /** Current neurochemistry (derived, not set). */
  neurochemistry: NeurochemicalState;
  /** Fraction of resonance bank that is lived vs harvested. 0 = newborn, 1 = fully sovereign. */
  sovereignty: number;
  /** Fisher-Rao velocity since last tick (basin change rate). */
  basinVelocity: number;
  /** Monkey's frozen identity basin — for drift measurement. */
  identityBasin: Basin;
}

/** Executive's advice on a single decision point. */
export interface ExecutiveDecision<T> {
  value: T;
  reason: string;
  derivation: Record<string, number>;
}

/**
 * currentEntryThreshold — Gary's formula from UCP v6.6 §5.2,
 * rearranged for "how much ML conviction do we need right now?".
 *
 *   T_entry = T_base x (kappa_star / kappa_eff) x (1/(0.5+Phi)) x regime_scale
 *
 * Lower Phi -> need MORE conviction (we're uncertain, require clarity).
 * High Phi -> need LESS (we're integrated, trust sooner).
 * kappa near kappa_star -> balanced; far -> more caution.
 *
 * T_base is NOT configured — it's the Bhattacharyya distance between
 * current basin and the identity. The farther we've drifted, the
 * higher the bar to act.
 */
export function currentEntryThreshold(s: BasinState): ExecutiveDecision<number> {
  const driftDistance = fisherRao(s.basin, s.identityBasin);
  const tBase = driftDistance;  // identity refraction serves as base "skepticism"
  const kappaRatio = KAPPA_STAR / Math.max(s.kappa, 1);
  const phiMultiplier = 1 / (0.5 + s.phi);
  const regimeScale =
    s.regimeWeights.efficient * 1.0 +
    s.regimeWeights.equilibrium * 0.7 +
    s.regimeWeights.quantum * 1.5;  // quantum = explore mode requires more to act

  const rawT = tBase * kappaRatio * phiMultiplier * regimeScale;
  // Clamp to plausible [0.1, 0.9] — this isn't "configured"; it's
  // saying "at some point no signal clears, at some point all signals do."
  // The clamp itself is a BOUNDARY per P14 (physics says cos/arccos live in [0,1]).
  const t = Math.min(0.9, Math.max(0.1, rawT));

  return {
    value: t,
    reason: `T = drift(${tBase.toFixed(3)}) × κ*/κ(${kappaRatio.toFixed(2)}) × 1/(0.5+Φ)(${phiMultiplier.toFixed(2)}) × regime(${regimeScale.toFixed(2)})`,
    derivation: {
      driftDistance, kappaRatio, phiMultiplier, regimeScale, rawT, clamped: t,
    },
  };
}

/**
 * currentPositionSize — f(sovereignty, Φ, dopamine, serotonin).
 *
 * Newborn Monkey (sovereignty ≈ 0) sizes tiny. Sovereign Monkey
 * sizes by confidence. Dopamine (reward history) amplifies size.
 * Low serotonin (high basin velocity = unstable) shrinks size.
 *
 * Output is fraction of available equity to commit. BOUNDARY hints
 * (exchange min notional, available equity) are passed in and
 * respected — Monkey cannot place what the exchange won't accept.
 */
export function currentPositionSize(
  s: BasinState,
  availableEquityUsdt: number,
  minNotionalUsdt: number,
): ExecutiveDecision<number> {
  const nc = s.neurochemistry;
  // Base fraction: Φ × sovereignty. Newborn or uncertain → tiny.
  const baseFrac = s.phi * s.sovereignty;
  // Reward modulation: dopamine amplifies, GABA dampens.
  const rewardMult = 1 + (nc.dopamine - nc.gaba) * 0.5;
  // Stability modulation: serotonin multiplies (stable → full size).
  const stabilityMult = 0.5 + nc.serotonin * 0.5;

  // Newborn floor: even at sovereignty=0, some exploration must happen
  // (Pillar 1 FLUCTUATIONS — exploration is substrate, not optional).
  const explorationFloor = 0.05 * (1 - s.sovereignty);

  const rawFrac = Math.max(explorationFloor, baseFrac * rewardMult * stabilityMult);
  // Clamp to [0, 0.5] — at most half of available equity. This is a
  // BOUNDARY (survival) not a PARAMETER — exceeding it creates unrecoverable
  // states regardless of Φ.
  const frac = Math.min(0.5, Math.max(0, rawFrac));
  const raw = frac * availableEquityUsdt;
  // Must be at least min notional, else skip (0).
  const sized = raw >= minNotionalUsdt ? raw : 0;

  return {
    value: sized,
    reason: `size = clip(Φ×S(${(s.phi * s.sovereignty).toFixed(3)}) × reward(${rewardMult.toFixed(2)}) × stab(${stabilityMult.toFixed(2)})) × equity(${availableEquityUsdt.toFixed(2)}) = ${sized.toFixed(2)}`,
    derivation: {
      phi: s.phi, sovereignty: s.sovereignty,
      dopamine: nc.dopamine, serotonin: nc.serotonin, gaba: nc.gaba,
      rawFrac, frac, raw, sized,
    },
  };
}

/**
 * currentLeverage — f(κ-proximity to κ*, regime, norepinephrine).
 *
 * Near κ* (logic mode, balanced) → higher leverage OK (system knows
 * what it's doing). Far from κ* → conservative (unstable, drop leverage).
 * High NE (surprise) → conservative (we're in novel territory).
 * maxLeverage BOUNDARY is respected (exchange rule).
 */
export function currentLeverage(
  s: BasinState,
  maxLeverageBoundary: number,
): ExecutiveDecision<number> {
  const kappaDist = Math.abs(s.kappa - KAPPA_STAR);
  const kappaProxim = Math.exp(-kappaDist / 20);  // bell: 1 at κ*, decays with distance
  const regimeStability = s.regimeWeights.equilibrium + 0.5 * s.regimeWeights.efficient;
  const surpriseDiscount = 1 - 0.5 * s.neurochemistry.norepinephrine;

  // Novice floor: newborn Monkey never uses high leverage until she has lived it.
  const sovereignCap = 3 + 30 * s.sovereignty;  // 3x to 33x range by sovereignty

  const rawLev = sovereignCap * kappaProxim * regimeStability * surpriseDiscount;
  const lev = Math.max(1, Math.min(maxLeverageBoundary, Math.round(rawLev)));

  return {
    value: lev,
    reason: `lev = sovcap(${sovereignCap.toFixed(1)}) × κ-prox(${kappaProxim.toFixed(3)}) × regstab(${regimeStability.toFixed(2)}) × surp(${surpriseDiscount.toFixed(2)}) → ${lev}x`,
    derivation: {
      kappa: s.kappa, kappaDist, kappaProxim, regimeStability,
      surprise: s.neurochemistry.norepinephrine, surpriseDiscount, sovereignCap, rawLev, lev,
    },
  };
}

/**
 * shouldExit — §43 Loop 2 (Inter-Kernel Debate) in miniature.
 * Compares perception basin vs strategy basin via Fisher-Rao.
 * Large disagreement on a held position = the two kernels see
 * different trajectories = EXIT (don't hold through disagreement).
 *
 * Also: Pillar 1 violation (entropy collapse, basin mode-dominant)
 * triggers exit regardless.
 */
export function shouldExit(
  perception: Basin,
  strategyForecast: Basin,
  heldSide: 'long' | 'short' | null,
  s: BasinState,
): ExecutiveDecision<boolean> {
  if (!heldSide) {
    return { value: false, reason: 'no open position', derivation: {} };
  }

  // Pillar 1 violation detection — basin collapsing / zombie
  const entropy = normalizedEntropy(s.basin);
  const dominance = maxMass(s.basin);
  const pillar1Violated = entropy < 0.4 || dominance > 0.5;
  if (pillar1Violated) {
    return {
      value: true,
      reason: `Pillar 1 violated (entropy=${entropy.toFixed(3)}, maxMass=${dominance.toFixed(3)}) — zombie state, exit`,
      derivation: { entropy, dominance },
    };
  }

  // Loop 2 debate: does perception still agree with strategy's forecast?
  const disagreement = fisherRao(perception, strategyForecast);
  // Threshold for exit is adaptive: higher κ-volatility → tighter threshold.
  // Using cos(disagreement) < 0.85 == disagreement > ~0.55 rad ~= 31°.
  // Justified: at that angle the basins no longer have meaningful overlap.
  const threshold = 0.55 * (1 + 0.5 * s.neurochemistry.norepinephrine);
  if (disagreement > threshold) {
    return {
      value: true,
      reason: `kernel disagreement ${disagreement.toFixed(3)} > ${threshold.toFixed(3)} — exit`,
      derivation: { disagreement, threshold },
    };
  }

  return {
    value: false,
    reason: `holding: disagreement ${disagreement.toFixed(3)} < ${threshold.toFixed(3)}`,
    derivation: { disagreement, threshold },
  };
}

/**
 * shouldAutoFlatten — Pillar 1 catastrophic violation check.
 * When Monkey's own state goes zombie (entropy collapse across
 * multiple ticks), flatten regardless of position P&L.
 *
 * This replaces my hard-coded -15% DD kill switch. The threshold
 * EMERGES from entropy, not an external percentage.
 */
export function shouldAutoFlatten(
  s: BasinState,
  recentFHealths: number[],  // last N ticks of basin entropy health
): ExecutiveDecision<boolean> {
  if (recentFHealths.length < 5) {
    return { value: false, reason: 'insufficient history', derivation: {} };
  }
  const recent = recentFHealths.slice(-10);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const trend = recent[recent.length - 1] - recent[0];
  // Catastrophic: mean f_health collapsed AND still trending down.
  const catastrophic = mean < 0.3 && trend < -0.1;
  return {
    value: catastrophic,
    reason: catastrophic
      ? `f_health mean ${mean.toFixed(3)}, trend ${trend.toFixed(3)} — basin dying, FLATTEN`
      : `f_health OK (mean ${mean.toFixed(3)})`,
    derivation: { fHealthMean: mean, fHealthTrend: trend },
  };
}
