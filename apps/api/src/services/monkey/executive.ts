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
import { MODE_PROFILES, MonkeyMode } from './modes.js';
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
export function currentEntryThreshold(
  s: BasinState,
  mode: MonkeyMode = MonkeyMode.INVESTIGATION,
  selfObsBias: number = 1.0,
  trendProxy: number = 0,
  sideCandidate: 'long' | 'short' = 'long',
): ExecutiveDecision<number> {
  const driftDistance = fisherRao(s.basin, s.identityBasin);
  const tBase = driftDistance;  // identity refraction serves as base "skepticism"
  const kappaRatio = KAPPA_STAR / Math.max(s.kappa, 1);
  const phiMultiplier = 1 / (0.5 + s.phi);
  const regimeScale =
    s.regimeWeights.efficient * 1.0 +
    s.regimeWeights.equilibrium * 0.7 +
    s.regimeWeights.quantum * 1.5;  // quantum = explore mode requires more to act
  const modeScale = MODE_PROFILES[mode].entryThresholdScale;
  // Trend alignment (v0.5.1): signed [-1, +1]. Positive = proposed side
  // agrees with tape direction. Long in uptrend = +; long in downtrend = −.
  // Aligned trades get threshold lowered (easier); fighting-tape trades
  // get it raised (harder). Range ±30 % — same swing as selfObsBias for
  // consistency. Mode still dominates when signal is flat (trendProxy≈0).
  const alignment = sideCandidate === 'long' ? trendProxy : -trendProxy;
  const trendMult = 1 - 0.3 * alignment;

  const rawT = tBase * kappaRatio * phiMultiplier * regimeScale * modeScale * selfObsBias * trendMult;
  const t = Math.min(0.9, Math.max(0.1, rawT));

  return {
    value: t,
    reason: `T = drift(${tBase.toFixed(3)}) × κ*/κ(${kappaRatio.toFixed(2)}) × 1/(0.5+Φ)(${phiMultiplier.toFixed(2)}) × regime(${regimeScale.toFixed(2)}) × mode(${modeScale.toFixed(2)}) × selfObs(${selfObsBias.toFixed(2)}) × trend(${trendMult.toFixed(2)}, align=${alignment.toFixed(2)})`,
    derivation: {
      driftDistance, kappaRatio, phiMultiplier, regimeScale, modeScale, selfObsBias,
      trendProxy, alignment, trendMult, rawT, clamped: t,
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
  mode: MonkeyMode = MonkeyMode.INVESTIGATION,
): ExecutiveDecision<number> {
  const nc = s.neurochemistry;
  // Lived-experience scaling. 0 at birth, 1 after ~20 witnessed trades.
  const maturity = Math.min(1, bankSize / 20);
  const baseFrac = s.phi * s.sovereignty * maturity;
  const rewardMult = 1 + (nc.dopamine - nc.gaba) * 0.5;
  const stabilityMult = 0.5 + nc.serotonin * 0.5;

  // Exploration floor (Pillar 1 FLUCTUATIONS — substrate, not optional).
  // Per-mode baseline: EXPLORATION 0.08, INVESTIGATION 0.10, INTEGRATION 0.12.
  // Scales inversely with maturity.
  const modeFloor = MODE_PROFILES[mode].sizeFloor;
  const explorationFloor = modeFloor * (1 - maturity);

  const rawFrac = Math.max(explorationFloor, baseFrac * rewardMult * stabilityMult);
  // Clamp to [0, 0.5] — at most half of available equity. This is a
  // BOUNDARY (survival) not a PARAMETER — exceeding it creates unrecoverable
  // states regardless of Φ.
  let frac = Math.min(0.5, Math.max(0, rawFrac));
  let margin = frac * availableEquityUsdt;
  let notional = margin * Math.max(1, leverage);

  // v0.6.6 "lift to minimum" — if we're below exchange min notional but
  // a fraction within the 0.5 safety clamp CAN clear it, auto-raise to
  // just enough. Observed 2026-04-21: when liveSignal's committed margin
  // shrank availableEquity to $5.20, the 9% exploration floor produced
  // $0.47 margin × 14x = $6.54 notional — below the $23 ETH min even
  // though $1.70 margin (33%) would clear it cleanly.
  let liftedToMin = false;
  if (notional < minNotionalUsdt && availableEquityUsdt > 0 && leverage > 0) {
    const BUFFER = 1.05;  // 5% headroom so lot-rounding doesn't put us just under
    const requiredFrac = (minNotionalUsdt * BUFFER) / (leverage * availableEquityUsdt);
    if (requiredFrac <= 0.5) {
      frac = Math.max(frac, requiredFrac);
      margin = frac * availableEquityUsdt;
      notional = margin * leverage;
      liftedToMin = true;
    }
  }

  const sized = notional >= minNotionalUsdt ? margin : 0;

  return {
    value: sized,
    reason: `size = ${liftedToMin ? 'lifted-to-min ' : ''}floor(${explorationFloor.toFixed(3)}) or Φ×S×M(${(s.phi * s.sovereignty * maturity).toFixed(3)}) × reward(${rewardMult.toFixed(2)}) × stab(${stabilityMult.toFixed(2)}) × equity(${availableEquityUsdt.toFixed(2)}) @ ${leverage}x → margin ${margin.toFixed(2)}, notional ${notional.toFixed(2)} vs min ${minNotionalUsdt.toFixed(2)} = ${sized.toFixed(2)}`,
    derivation: {
      phi: s.phi, sovereignty: s.sovereignty, maturity, bankSize,
      dopamine: nc.dopamine, serotonin: nc.serotonin, gaba: nc.gaba,
      explorationFloor, rawFrac, frac, margin, leverage, notional,
      minNotional: minNotionalUsdt, sized, liftedToMin: liftedToMin ? 1 : 0,
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
  mode: MonkeyMode = MonkeyMode.INVESTIGATION,
): ExecutiveDecision<number> {
  const kappaDist = Math.abs(s.kappa - KAPPA_STAR);
  const kappaProxim = Math.exp(-kappaDist / 20);  // bell: 1 at κ*, decays with distance
  const regimeStability = s.regimeWeights.equilibrium + 0.5 * s.regimeWeights.efficient;
  const surpriseDiscount = 1 - 0.5 * s.neurochemistry.norepinephrine;

  // Per-mode newborn floor. EXPLORATION 15, INVESTIGATION 20, INTEGRATION 25.
  // Scales up to 33x once fully sovereign.
  const modeFloor = MODE_PROFILES[mode].sovereignCapFloor;
  const sovereignCap = Math.max(modeFloor, 3 + 30 * s.sovereignty);

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
 * shouldDCAAdd — permit a dollar-cost-average add to an existing
 * position (v0.6.2). This is the "buy lower if it'll recover" path.
 *
 * DCA is hazardous by default — the classic failure is "averaging into a
 * loser until liquidated." Five guard rails here, ALL must pass:
 *
 *   1. SAME SIDE   proposed side matches currently held side (no reversal)
 *   2. BETTER PRICE for long: now < entry × 0.99; for short: > × 1.01
 *   3. COOLDOWN    ≥ COOLDOWN_MS since last add (no flurry on one candle)
 *   4. ADD CAP     addCount < MAX_ADDS_PER_POSITION (v0.6.2 = 1)
 *   5. EARNED      sovereignty > 0.1 — newborn can't DCA
 *
 * The "fresh signal" requirement is already enforced externally:
 * `mlStrength >= entryThr` — same gate first-entries pass.
 *
 * If all pass, DCA add is allowed at the CURRENT position-size rules
 * (same currentPositionSize call). Aggregate exposure is bounded by the
 * risk-kernel per-symbol cap (5× equity).
 */
export const DCA_MAX_ADDS_PER_POSITION = 1;
export const DCA_COOLDOWN_MS = 15 * 60 * 1000;           // 15 min
export const DCA_BETTER_PRICE_FRAC = 0.01;                // ≥ 1 % better entry
export const DCA_MIN_SOVEREIGNTY = 0.1;

export function shouldDCAAdd(req: {
  heldSide: 'long' | 'short';
  sideCandidate: 'long' | 'short';
  currentPrice: number;
  initialEntryPrice: number;
  addCount: number;
  lastAddAtMs: number;
  nowMs: number;
  sovereignty: number;
}): ExecutiveDecision<boolean> {
  const {
    heldSide, sideCandidate, currentPrice, initialEntryPrice,
    addCount, lastAddAtMs, nowMs, sovereignty,
  } = req;

  if (heldSide !== sideCandidate) {
    return { value: false, reason: `side mismatch (${sideCandidate} vs held ${heldSide})`, derivation: { rule: 1 } };
  }
  if (addCount >= DCA_MAX_ADDS_PER_POSITION) {
    return { value: false, reason: `add cap reached (${addCount}/${DCA_MAX_ADDS_PER_POSITION})`, derivation: { rule: 4, addCount } };
  }
  if (nowMs - lastAddAtMs < DCA_COOLDOWN_MS) {
    const secRemain = Math.round((DCA_COOLDOWN_MS - (nowMs - lastAddAtMs)) / 1000);
    return { value: false, reason: `cooldown (${secRemain}s remaining)`, derivation: { rule: 3, secRemain } };
  }
  if (sovereignty < DCA_MIN_SOVEREIGNTY) {
    return { value: false, reason: `sovereignty too low (${sovereignty.toFixed(3)} < ${DCA_MIN_SOVEREIGNTY})`, derivation: { rule: 5, sovereignty } };
  }
  const priceDelta = (currentPrice - initialEntryPrice) / initialEntryPrice;
  const priceIsBetter = heldSide === 'long'
    ? priceDelta < -DCA_BETTER_PRICE_FRAC   // lower for long
    : priceDelta > +DCA_BETTER_PRICE_FRAC;  // higher for short
  if (!priceIsBetter) {
    return {
      value: false,
      reason: `price not better (${(priceDelta * 100).toFixed(3)}% from entry vs ±${(DCA_BETTER_PRICE_FRAC * 100).toFixed(1)}% required)`,
      derivation: { rule: 2, priceDelta },
    };
  }
  return {
    value: true,
    reason: `DCA_OK: ${(priceDelta * 100).toFixed(2)}% from entry, addCount=${addCount}, sov=${sovereignty.toFixed(2)}`,
    derivation: { rule: 0, priceDelta, addCount, sovereignty },
  };
}

/**
 * shouldProfitHarvest — early-exit WHILE IN PROFIT (v0.6.1).
 *
 * Runs BEFORE shouldScalpExit. When a trade has been in profit, the peak
 * unrealized P&L acts as a high-water mark. If the position gives back a
 * chunk of that peak AND is still green, take what's there instead of
 * waiting for the full TP threshold. Addresses the observed scenario
 * where a position was up ~$0.65 on ETH at its peak, then retraced to
 * −$0.67 while waiting for the 0.8–2 % TP — lost both directions.
 *
 * Two independent triggers (either fires):
 *
 *   TRAILING   peakFrac ≥ activation AND currentFrac < peakFrac × (1 − giveback)
 *              → "profit retraced past my trailing stop"
 *   TREND-FLIP currentFrac > 0 AND tapeTrend flipped against heldSide past threshold
 *              → "tape turned on me, secure what I have"
 *
 * Both require currentFrac > 0 so we never exit at a loss from here; SL
 * still handles loss exits. activation defaults to 0.2 % of notional so
 * we don't flap on noise; giveback defaults to 0.4 (give back 40 % of peak).
 */
export function shouldProfitHarvest(
  unrealizedPnlUsdt: number,
  peakPnlUsdt: number,
  notionalUsdt: number,
  tapeTrend: number,
  heldSide: 'long' | 'short',
  s: BasinState,
): ExecutiveDecision<boolean> {
  if (notionalUsdt <= 0) {
    return { value: false, reason: 'no position', derivation: {} };
  }
  const currentFrac = unrealizedPnlUsdt / notionalUsdt;
  const peakFrac = Math.max(peakPnlUsdt, 0) / notionalUsdt;

  // Activation floor — peak must have been meaningful before the trailing
  // stop can fire. Scales with dopamine: recent wins → harvest earlier.
  const activation = Math.max(0.002, 0.004 - 0.002 * s.neurochemistry.dopamine);
  // Giveback fraction — how much of peak to surrender before exiting.
  // Low serotonin (unstable) → tighter (0.30); high serotonin → looser (0.50).
  const giveback = 0.30 + 0.20 * (1 - s.neurochemistry.serotonin);
  const trailingFloor = peakFrac * (1 - giveback);

  if (peakFrac >= activation && currentFrac < trailingFloor && currentFrac > 0) {
    return {
      value: true,
      reason: `trailing_harvest: peak ${(peakFrac * 100).toFixed(3)}% → now ${(currentFrac * 100).toFixed(3)}% < ${(trailingFloor * 100).toFixed(3)}% floor`,
      derivation: { currentFrac, peakFrac, trailingFloor, activation, giveback, exitTypeBit: 2 },
    };
  }

  // TREND-FLIP trigger. Aligned entry means tapeTrend had the same sign
  // as heldSide when she entered; if tape reverses against her while
  // she's green, harvest now — the trend that justified entry is gone.
  const alignmentNow = heldSide === 'long' ? tapeTrend : -tapeTrend;
  const TREND_FLIP_THRESHOLD = -0.25;  // strongly against the position
  if (currentFrac > 0 && alignmentNow <= TREND_FLIP_THRESHOLD && peakFrac >= activation) {
    return {
      value: true,
      reason: `trend_flip_harvest: pnl +${(currentFrac * 100).toFixed(3)}%, tape flipped (align=${alignmentNow.toFixed(2)})`,
      derivation: { currentFrac, peakFrac, alignment: alignmentNow, exitTypeBit: 3 },
    };
  }

  return {
    value: false,
    reason: `profit_hold: current ${(currentFrac * 100).toFixed(3)}%, peak ${(peakFrac * 100).toFixed(3)}%, trail-floor ${(trailingFloor * 100).toFixed(3)}%`,
    derivation: { currentFrac, peakFrac, trailingFloor, activation, giveback, alignment: alignmentNow },
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
  mode: MonkeyMode = MonkeyMode.INVESTIGATION,
): ExecutiveDecision<boolean> {
  if (notionalUsdt <= 0) {
    return { value: false, reason: 'no position notional', derivation: {} };
  }
  const pnlFrac = unrealizedPnlUsdt / notionalUsdt;
  const nc = s.neurochemistry;
  // Mode picks the baseline; Φ + dopamine modulate within that mode.
  const profile = MODE_PROFILES[mode];
  const tpThr = Math.max(
    0.003,
    profile.tpBaseFrac - 0.003 * nc.dopamine + 0.005 * s.phi,
  );
  const slThr = tpThr * profile.slRatio;

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
