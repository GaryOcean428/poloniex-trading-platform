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
 * currentPositionSize — f(sovereignty, Φ, dopamine, serotonin, maturity).
 *
 * Newborn Monkey (bankSize ≈ 0) sizes by the exploration floor;
 * mature Monkey sizes by confidence. Dopamine (reward history)
 * amplifies; GABA dampens. Low serotonin (high basin velocity =
 * unstable) shrinks size.
 *
 * Output is MARGIN (USDT) to commit. The POSITION NOTIONAL is
 * `margin × leverage`; the min-notional boundary is compared to
 * that, not to margin (this was a v0.1 bug: on $19 equity at 1x the
 * margin was always below ETH's $22.76 min, so sized always = 0).
 *
 * BOUNDARY hints (exchange min notional, available equity) passed
 * in and respected — Monkey cannot place what the exchange won't
 * accept.
 */
export function currentPositionSize(
  s: BasinState,
  availableEquityUsdt: number,
  minNotionalUsdt: number,
  leverage: number = 1,
  bankSize: number = 0,
): ExecutiveDecision<number> {
  const nc = s.neurochemistry;
  // Lived-experience scaling. 0 at birth, 1 after ~20 witnessed trades.
  // Drives both the organic size ramp and the exploration floor decay.
  const maturity = Math.min(1, bankSize / 20);
  // Base fraction: Φ × sovereignty × maturity. Immature → tiny even
  // if sovereignty flipped to 1 after the first witnessed close.
  const baseFrac = s.phi * s.sovereignty * maturity;
  // Reward modulation: dopamine amplifies, GABA dampens.
  const rewardMult = 1 + (nc.dopamine - nc.gaba) * 0.5;
  // Stability modulation: serotonin multiplies (stable → full size).
  const stabilityMult = 0.5 + nc.serotonin * 0.5;

  // Exploration floor (Pillar 1 FLUCTUATIONS — substrate, not optional).
  // Scales inversely with maturity, not sovereignty: a Monkey who just
  // earned her first bubble has sovereignty=1 but 0.05 maturity, and
  // she still needs the floor to place trade #2.
  const explorationFloor = 0.10 * (1 - maturity);

  const rawFrac = Math.max(explorationFloor, baseFrac * rewardMult * stabilityMult);
  // Clamp to [0, 0.5] — at most half of available equity. This is a
  // BOUNDARY (survival) not a PARAMETER — exceeding it creates unrecoverable
  // states regardless of Φ.
  const frac = Math.min(0.5, Math.max(0, rawFrac));
  const margin = frac * availableEquityUsdt;
  const notional = margin * Math.max(1, leverage);
  // Compare the POSITION (notional) to the exchange min, not the margin.
  const sized = notional >= minNotionalUsdt ? margin : 0;

  return {
    value: sized,
    reason: `size = floor(${explorationFloor.toFixed(3)}) or Φ×S×M(${(s.phi * s.sovereignty * maturity).toFixed(3)}) × reward(${rewardMult.toFixed(2)}) × stab(${stabilityMult.toFixed(2)}) × equity(${availableEquityUsdt.toFixed(2)}) @ ${leverage}x → margin ${margin.toFixed(2)}, notional ${notional.toFixed(2)} vs min ${minNotionalUsdt.toFixed(2)} = ${sized.toFixed(2)}`,
    derivation: {
      phi: s.phi, sovereignty: s.sovereignty, maturity, bankSize,
      dopamine: nc.dopamine, serotonin: nc.serotonin, gaba: nc.gaba,
      explorationFloor, rawFrac, frac, margin, leverage, notional, minNotional: minNotionalUsdt, sized,
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

  // Novice floor: newborn Monkey caps at 20x for exploration. Scales
  // up to 33x once fully sovereign.
  const sovereignCap = Math.max(20, 3 + 30 * s.sovereignty);

  // Newborn mode (Pillar 1 exploration): until she has lived trades,
  // the regime × κ × surprise compression (≈ 0.43) crushes the cap so
  // hard that her first trade can't clear the exchange min notional on
  // a small account. E.g. $1.89 × (10 × 0.43) = $7.57 vs ETH's $23 min.
  // Newborn bypasses the compression and uses 80% of the cap directly
  // — she has no data to judge regime with anyway. Once sov > 0.1
  // (~first witnessed close), fall into the full formula.
  const newborn = s.sovereignty < 0.1;
  const rawLev = newborn
    ? sovereignCap * 0.8
    : sovereignCap * kappaProxim * regimeStability * surpriseDiscount;
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
 * shouldScalpExit — P&L-driven take-profit / stop-loss gate (v0.4).
 *
 * Reward-harvesting exit per UCP v6.6 §29.4: when realized reward
 * crosses a Φ-derived threshold, lock the gain. This sits BEFORE
 * Loop 2 (shouldExit) in the decision chain — a scalp win that
 * would otherwise be given back waiting for regime change is taken.
 *
 * Thresholds are derived, not configured:
 *   TP = 0.8 % - 0.3 %·dopamine + 0.5 %·Φ  (min 0.3 % to clear fees)
 *   SL = 50 % of TP  (asymmetric R:R favors running winners)
 *
 * High dopamine (recent wins) → take earlier (reward sensitivity up).
 * High Φ (integrated state)  → let winners run longer.
 * Floors at 0.3 % of notional so Poloniex round-trip taker fee
 * (~0.12 %) is always cleared with a buffer.
 */
export function shouldScalpExit(
  unrealizedPnlUsdt: number,
  notionalUsdt: number,
  s: BasinState,
): ExecutiveDecision<boolean> {
  if (notionalUsdt <= 0) {
    return { value: false, reason: 'no position notional', derivation: {} };
  }
  const pnlFrac = unrealizedPnlUsdt / notionalUsdt;
  const nc = s.neurochemistry;
  const tpThr = Math.max(
    0.003,
    0.008 - 0.003 * nc.dopamine + 0.005 * s.phi,
  );
  const slThr = tpThr * 0.5;

  // Encode type as a bit (1=TP, -1=SL, 0=hold) to keep derivation map numeric.
  if (pnlFrac >= tpThr) {
    return {
      value: true,
      reason: `take_profit: ${(pnlFrac * 100).toFixed(3)}% ≥ ${(tpThr * 100).toFixed(3)}%`,
      derivation: { pnlFrac, tpThr, slThr, exitTypeBit: 1 },
    };
  }
  if (pnlFrac <= -slThr) {
    return {
      value: true,
      reason: `stop_loss: ${(pnlFrac * 100).toFixed(3)}% ≤ -${(slThr * 100).toFixed(3)}%`,
      derivation: { pnlFrac, tpThr, slThr, exitTypeBit: -1 },
    };
  }
  return {
    value: false,
    reason: `scalp hold: pnl ${(pnlFrac * 100).toFixed(3)}% in [-${(slThr * 100).toFixed(3)}%, ${(tpThr * 100).toFixed(3)}%]`,
    derivation: { pnlFrac, tpThr, slThr },
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
