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
import type { EmotionState } from './emotions.js';

export type Direction = 'long' | 'short' | 'flat';

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
/**
 * Kelly leverage cap (proposal #3). TS parity to
 * ``ml-worker/src/monkey_kernel/executive.py:kelly_leverage_cap``.
 *
 * Returns the Kelly-criterion leverage cap applied AS A CAP on top of
 * the geometric leverage formula. Pure scalar / Euclidean — allowed
 * here because it does not replace the geometric formula, only
 * lowers it. The geometric raw_lev formula stays Fisher-Rao pure.
 *
 * Edge cases:
 *   * No losses (avgLoss=0)    → return maxLev (defer to geometric).
 *   * No wins (avgWin=0)       → return 1.
 *   * pWin <= 0 / avgWin <= 0  → return 1.
 *   * f* > 1                   → clamp to 1 (full-Kelly maximum).
 *   * f* < 0 (negative edge)   → return 1.
 */
export function kellyLeverageCap(
  pWin: number,
  avgWin: number,
  avgLoss: number,
  maxLev: number,
): number {
  if (pWin <= 0 || avgWin <= 0) return 1;
  const absLoss = Math.abs(avgLoss);
  if (absLoss <= 1e-12) return maxLev;
  const b = avgWin / absLoss;
  if (b <= 0) return 1;
  const q = 1 - pWin;
  let fStar = (pWin * b - q) / b;
  fStar = Math.max(0, Math.min(1, fStar));
  return Math.max(1, Math.round(fStar * maxLev));
}

export function currentLeverage(
  s: BasinState,
  maxLeverageBoundary: number,
  mode: MonkeyMode = MonkeyMode.INVESTIGATION,
  tapeTrend: number = 0,
  rollingStats?: { winRate: number; avgWin: number; avgLoss: number } | null,
): ExecutiveDecision<number> {
  const kappaDist = Math.abs(s.kappa - KAPPA_STAR);
  const kappaProxim = Math.exp(-kappaDist / 20);  // bell: 1 at κ*, decays with distance
  const regimeStability = s.regimeWeights.equilibrium + 0.5 * s.regimeWeights.efficient;
  const surpriseDiscount = 1 - 0.5 * s.neurochemistry.norepinephrine;

  // Per-mode newborn floor. EXPLORATION 15, INVESTIGATION 20, INTEGRATION 25.
  // Scales up to 33x once fully sovereign.
  const modeFloor = MODE_PROFILES[mode].sovereignCapFloor;
  const sovereignCap = Math.max(modeFloor, 3 + 30 * s.sovereignty);

  // ─── USER CONTRIBUTION POINT — flatness leverage boost (v0.6.7) ───
  //
  // The standard formula `regimeStability × kappaProxim × surpriseDiscount`
  // COMPRESSES leverage on any non-equilibrium signal. Problem: the
  // quantum dim (basin[0]) is computed from absolute ATR, so a genuinely
  // calm market with small ATR still reads as "quantum" and pins
  // regimeStability low, crushing leverage down (~14x observed). On a
  // truly flat tape, leverage should go UP — small moves amplify into
  // real wins without amplifying risk proportionally.
  //
  // `tapeTrend` is the signed log-return over 50 candles, squashed to
  // [-1, +1]. Magnitude near 0 = genuinely calm market.
  //
  // Pick a flatness → leverage multiplier. Candidates:
  //   flatness = Math.max(0, 1 - Math.abs(tapeTrend) * K)    ∈ [0, 1]
  //   flatMult = 1 + BOOST * flatness                        ∈ [1, 1+BOOST]
  // with K and BOOST the shape knobs. Examples:
  //
  //   K=3,  BOOST=0.3    conservative: up to +30% at dead flat, decays fast
  //   K=5,  BOOST=0.5    moderate   : up to +50% at dead flat, decays at |t|>0.2
  //   K=10, BOOST=0.8    aggressive : up to +80% at dead flat, decays at |t|>0.1
  //
  // User's pick (2026-04-21): aggressive. "On flat movement would allow
  // for quicker ins and outs on higher leverage." Small moves at 25x
  // margin-gain produce real wins on $20 account where 14x would
  // barely clear fees.
  const FLATNESS_K = 10;        // narrow "flat" band: boost only when |tape| < ~0.10
  const FLATNESS_BOOST = 0.8;   // up to +80% leverage at dead-flat (33 → ~59 ceiling)
  const flatness = Math.max(0, 1 - Math.abs(tapeTrend) * FLATNESS_K);
  const flatMult = 1 + FLATNESS_BOOST * flatness;
  // ────────────────────────────────────────────────────────────────────

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
    : sovereignCap * kappaProxim * regimeStability * surpriseDiscount * flatMult;
  // Proposal #3: Kelly cap layer. Applied AFTER the geometric formula.
  // ``kellyCap = maxLev`` (no-op) when rolling stats are absent, so
  // cold-start behaviour is unchanged.
  const kellyCap = rollingStats
    ? kellyLeverageCap(rollingStats.winRate, rollingStats.avgWin, rollingStats.avgLoss, maxLeverageBoundary)
    : maxLeverageBoundary;
  const lev = Math.max(
    1,
    Math.min(
      Math.floor(kellyCap),
      maxLeverageBoundary,
      Math.round(rawLev),
    ),
  );

  return {
    value: lev,
    reason: `lev = sovcap(${sovereignCap.toFixed(1)}) × κ-prox(${kappaProxim.toFixed(3)}) × regstab(${regimeStability.toFixed(2)}) × surp(${surpriseDiscount.toFixed(2)}) kelly_cap=${kellyCap} → ${lev}x`,
    derivation: {
      kappa: s.kappa, kappaDist, kappaProxim, regimeStability,
      surprise: s.neurochemistry.norepinephrine, surpriseDiscount, sovereignCap, rawLev,
      kellyCap,
      lev,
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
  /**
   * Proposal #4 — sustained tape-flip streak. Number of consecutive
   * recent ticks where alignment <= -0.25. Trend-flip harvest fires
   * only when streak >= ``tapeFlipStreakRequired`` (default 3) so a
   * single noise tick can't trigger an exit.
   *
   * Proposal #2 — peak-tracking trailing stop. Trend-flip harvest now
   * also requires peak_frac >= ``peakGivebackMinPct`` (default 1%)
   * AND current_frac < peak_frac * (1 - peakGivebackThreshold)
   * (default 30% giveback) — only fire when we've already captured
   * meaningful profit AND given back a meaningful chunk.
   */
  tapeFlipStreak: number = 0,
  peakGivebackMinPct: number = 0.01,
  peakGivebackThreshold: number = 0.30,
  tapeFlipStreakRequired: number = 3,
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
  // 2026-04-29: formula was inverted vs the doctrine — high serotonin
  // gave 0.30 (tightest), so calm-market profits were harvested early.
  // Realized-PnL audit (28 closes, 11.5h) showed avg-win/avg-loss ratio
  // of 1.06 — barely above fees. Letting winners run further in stable
  // regimes is the lever that moves EV/close from marginal to comfortable.
  const giveback = 0.30 + 0.20 * s.neurochemistry.serotonin;
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
  // she's green, harvest now — but only if the tape flip is SUSTAINED
  // (proposal #4) AND the peak-tracking guard fires (proposal #2).
  const alignmentNow = heldSide === 'long' ? tapeTrend : -tapeTrend;
  const TREND_FLIP_THRESHOLD = -0.25;  // strongly against the position
  const peakGivebackFloor = peakFrac * (1 - peakGivebackThreshold);
  const peakGuardPass = peakFrac >= peakGivebackMinPct && currentFrac < peakGivebackFloor;
  const streakPass = tapeFlipStreak >= tapeFlipStreakRequired;
  if (
    currentFrac > 0
    && alignmentNow <= TREND_FLIP_THRESHOLD
    && peakFrac >= activation
    && peakGuardPass     // proposal #2
    && streakPass        // proposal #4
  ) {
    return {
      value: true,
      reason: `trend_flip_harvest: pnl +${(currentFrac * 100).toFixed(3)}%, tape flipped (align=${alignmentNow.toFixed(2)}, streak=${tapeFlipStreak}), peak +${(peakFrac * 100).toFixed(3)}% gave back to ${(currentFrac * 100).toFixed(3)}%`,
      derivation: {
        currentFrac, peakFrac, alignment: alignmentNow,
        tapeFlipStreak, peakGivebackFloor,
        exitTypeBit: 3,
      },
    };
  }

  return {
    value: false,
    reason: `profit_hold: current ${(currentFrac * 100).toFixed(3)}%, peak ${(peakFrac * 100).toFixed(3)}%, trail-floor ${(trailingFloor * 100).toFixed(3)}%`,
    derivation: {
      currentFrac, peakFrac, trailingFloor, activation, giveback,
      alignment: alignmentNow, tapeFlipStreak,
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


// ═══════════════════════════════════════════════════════════════
//  Lane selection — softmax over basin features (parity with Python)
// ═══════════════════════════════════════════════════════════════

export type LaneType = 'scalp' | 'swing' | 'trend' | 'observe';

/**
 * Select execution lane from basin geometry via softmax.
 * Temperature τ = 1/κ — high κ = exploitation, low κ = exploration.
 */
export function chooseLane(
  s: BasinState,
  tapeTrend: number = 0,
): ExecutiveDecision<LaneType> {
  // κ → 0 must yield τ → ∞ (exploration); only clamp away from div-by-zero.
  const tau = 1.0 / Math.max(s.kappa, 1e-6);

  const scalpScore = (1 - s.phi) * (1 - s.sovereignty) * (1 - Math.min(s.basinVelocity, 1));
  const trendScore = s.phi * s.sovereignty * Math.abs(tapeTrend);
  const observeScore = Math.min(s.basinVelocity, 1) * 0.8;
  const swingScore = 0.3;

  const scores: Record<LaneType, number> = {
    scalp: scalpScore,
    swing: swingScore,
    trend: trendScore,
    observe: observeScore,
  };

  const maxS = Math.max(...Object.values(scores));
  const expScores: Record<LaneType, number> = { scalp: 0, swing: 0, trend: 0, observe: 0 };
  let total = 0;
  for (const [k, v] of Object.entries(scores) as [LaneType, number][]) {
    const e = Math.exp((v - maxS) / Math.max(tau, 1e-6));
    expScores[k] = e;
    total += e;
  }
  const probs: Record<LaneType, number> = { scalp: 0, swing: 0, trend: 0, observe: 0 };
  for (const [k, v] of Object.entries(expScores) as [LaneType, number][]) {
    probs[k] = v / total;
  }

  let lane: LaneType = 'swing';
  let maxProb = 0;
  for (const [k, v] of Object.entries(probs) as [LaneType, number][]) {
    if (v > maxProb) {
      maxProb = v;
      lane = k;
    }
  }

  return {
    value: lane,
    reason: `lane=${lane} (tau=${tau.toFixed(4)}, scalp=${probs.scalp.toFixed(3)} swing=${probs.swing.toFixed(3)} trend=${probs.trend.toFixed(3)} observe=${probs.observe.toFixed(3)})`,
    derivation: {
      tau,
      phi: s.phi,
      sovereignty: s.sovereignty,
      basinVelocity: s.basinVelocity,
      tapeTrend,
    },
  };
}


// ═══════════════════════════════════════════════════════════════
//  Agent K kernel direction + entry gate (post #ml-separation)
// ═══════════════════════════════════════════════════════════════
//
// Mirrors monkey_kernel/executive.py kernel_direction +
// kernel_should_enter. Used by loop.ts in place of the old
// ml_side / OVERRIDE_REVERSE / TURNING_SIGNAL path. ML now lives
// in a separate Agent M module (services/ml_agent/) with its own
// capital share allocated by the arbiter.

/**
 * Geometric direction read with emotion conviction gate.
 *
 * geometric_signal = basinDir + 0.5 * tapeTrend.
 * Returns 'long' when positive, 'short' when negative, 'flat' when
 * zero or when emotions.confidence < emotions.anxiety (low conviction
 * overrides any geometric lean).
 *
 * Basin dominates; tape consensus tilts when basin is ambiguous.
 */
export function kernelDirection(args: {
  basinDir: number;
  tapeTrend: number;
  emotions: EmotionState;
}): Direction {
  if (args.emotions.confidence < args.emotions.anxiety) return 'flat';
  const geometricSignal = args.basinDir + 0.5 * args.tapeTrend;
  if (geometricSignal > 0) return 'long';
  if (geometricSignal < 0) return 'short';
  return 'flat';
}

/**
 * Conviction gate. The emotion stack is the threshold — no external
 * strength comparison. Wonder amplifies confidence; anxiety + confusion
 * comprise hesitation.
 *
 * Enter when: confidence × (1 + wonder) > anxiety + confusion.
 */
export function kernelShouldEnter(args: { emotions: EmotionState }): boolean {
  const conviction = args.emotions.confidence * (1.0 + args.emotions.wonder);
  const hesitation = args.emotions.anxiety + args.emotions.confusion;
  return conviction > hesitation;
}
