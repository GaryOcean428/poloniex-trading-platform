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

import { KAPPA_STAR, BASIN_DIM, type Basin, normalizedEntropy, maxMass, fisherRao, toSimplex } from './basin.js';
import { MODE_PROFILES, MonkeyMode } from './modes.js';
import type { NeurochemicalState } from './neurochemistry.js';
import type { EmotionState } from './emotions.js';
import { ROTATION_WR_MIN_SAMPLES } from './kernel_rotation.js';

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
// ─── Proposal #10 — lane parameter envelope (TS parity) ────────────
//
// Two-lane initial split with trend as opt-in. SL/TP percentages give
// each lane its own retreat tolerance, expressed as ROI on margin
// (post-v0.8.6 rescale — see below):
//   scalp ~5%   ROI adverse / 5%  reward — fast tape harvesting
//   swing ~15%  ROI adverse / 15% reward — absorbs retraces
//   trend ~40%  ROI adverse / 40% reward — rides macro trend (opt-in)
// Budget fractions sum to <= 1 across position-bearing lanes; trend
// defaults to 0 in this batch and is governance-bumped via the param
// registry once the arbiter has 5+ closed trades per lane.
//
// v0.8.6 RESCALE (2026-05-01) — slPct / tpPct semantics changed
// from "raw price movement %" to "ROI on margin %". The previous
// scale (sl=0.4%/1.5%/4% raw) almost never tripped at typical 15-20x
// leverage because raw price moves stay tiny while ROI on margin
// scales with leverage. Live failure: ETH long sat at -4.4% ROI for
// 4+ hours without the 1.5% raw SL firing because raw price only
// moved -0.30%. Rescale preserves order-of-magnitude intent at
// ~15-20x leverage. Mirror in ml-worker/scripts/recalibrate_lane_sl_tp_to_roi.sql.
export const LANE_PARAMETER_DEFAULTS: Record<
  'scalp' | 'swing' | 'trend',
  { tpPct: number; budgetFrac: number }
> = {
  // 2026-05-25 — per-lane budget caps removed per operator autonomy doctrine.
  // 2026-05-26 (Path A) — per-lane SL (slPct) removed entirely.
  //   Hard SL was a P5 violation: externally-imposed ROI threshold that
  //   fired regardless of kernel's own perception state. Adverse exits
  //   now flow through shouldExit (Fisher-Rao disagreement) and
  //   shouldAutoFlatten (Pillar 1 catastrophic backstop). The TP side
  //   stays chemistry-derived. See feedback_observer_derives_not_knobs.md.
  scalp: { tpPct: 0.03, budgetFrac: 1.0 },
  swing: { tpPct: 0.15, budgetFrac: 1.0 },
  trend: { tpPct: 0.40, budgetFrac: 1.0 },
};

/**
 * 2026-05-25 — notional ceiling removed per operator autonomy doctrine.
 * The kernel's own learning loop is the restraint:
 *   - Exchange enforces real maintenance margin / liquidation
 *   - push_reward on close feeds gaba on losses → smaller next size
 *   - Kelly cap on leverage is observer-derived (when stats are
 *     informative, it tightens; when not, defers to geometric)
 * Retained as 0 (no-op) so consumers reading the export don't crash;
 * the cap-enforcement code in currentPositionSize is also stripped.
 */
export const NOTIONAL_CEILING_RATIO = 0;

export function laneParam(
  lane: 'scalp' | 'swing' | 'trend',
  key: 'tpPct' | 'budgetFrac',
): number {
  // Mirror to ml-worker/src/monkey_kernel/executive.py::lane_param.
  // Path A (2026-05-26): 'slPct' removed from lane params — see
  // LANE_PARAMETER_DEFAULTS doc.
  return LANE_PARAMETER_DEFAULTS[lane][key];
}

export function laneBudgetFraction(
  lane: 'scalp' | 'swing' | 'trend' | 'observe',
): number {
  if (lane === 'observe') return 0;
  return laneParam(lane, 'budgetFrac');
}

export function currentPositionSize(
  s: BasinState,
  availableEquityUsdt: number,
  minNotionalUsdt: number,
  leverage: number = 1,
  bankSize: number = 0,
  mode: MonkeyMode = MonkeyMode.INVESTIGATION,
  lane: 'scalp' | 'swing' | 'trend' = 'swing',
): ExecutiveDecision<number> {
  // ─── Proposal #10 lane-budget — applied as a MARGIN CAP, not an
  // equity haircut (fix/lane-budget-size-zero-regression).
  //
  // Original PR #610 implementation multiplied availableEquityUsdt by
  // laneFrac BEFORE the size formula. That double-dipped against the
  // already-cap'd availableEquity (loop.ts already shrinks it via
  // sizeFraction × kernel-share) and broke the v0.6.6 lift-to-min
  // path on small accounts: with $90 equity → halved to $45 the
  // requiredFrac for a $75.78 BTC min at 14x was 0.126 (fine), but
  // the loop's per-symbol cap further reduces availableEquity below
  // the size-fraction-relief floor, so the effective pool seen here
  // routinely fell to ~$5 on production. Halving that to $2.50
  // pushed requiredFrac past the 0.5 safety clamp → no lift fired
  // and every entry returned size=0. Trend lane (budget=0) also
  // collapsed every tick where chooseLane picked it — there is no
  // "softmax fall-through" to a positive-budget lane.
  //
  // The correct semantic: budgetFrac caps the MARGIN a single
  // position can claim against full equity. Sizing math sees the
  // full available pool; the final margin is min(formula, cap).
  // This preserves the "trend is opt-in" promise (budget=0 → cap=0
  // → margin=0) AND lets lift-to-min reach the exchange minimum on
  // small accounts AND preserves the cross-lane partition invariant
  // (scalp's margin ≤ 50% of equity even when scalp+swing both
  // active).
  const laneFrac = laneBudgetFraction(lane);
  const laneMarginCap = laneFrac * availableEquityUsdt;
  const nc = s.neurochemistry;
  // 2026-05-25 (observer-derive PR) — replaces magic-number tuning
  // with observer-grounded shapes per the autonomy doctrine
  // ([[feedback_observer_derives_not_knobs]]).
  //
  //   1. maturity rate ties to ROTATION_WR_MIN_SAMPLES — the same
  //      n-trades threshold the per-symbol selfObs uses for Wilson-CI
  //      firmness (see kernel_rotation.ts). At n trades, the rolling
  //      WR is statistically firm, so "matured" semantically means
  //      "kernel has enough data to trust its own track record."
  //      Not a tuned rate; same threshold across the whole system.
  //   2. rewardMult = 1 + (dopamine - gaba). The chemistry inputs are
  //      already observer-derived (see neurochemistry.ts post-#920);
  //      the unit coefficient is STRUCTURAL — neutral chemistry
  //      (dop = gaba) produces unit-size multiplier by construction.
  //   3. stabilityMult = 0.75 + serotonin × 0.5. STRUCTURAL band
  //      [0.75, 1.25]: max-stress serotonin shaves 25% off sizing,
  //      max-calm adds 25%. Same shape as a continuous modulator.
  //      The 0.75/0.5 split is the design choice of the mapping
  //      function's range, not a tuning of internal parameters.
  const maturity = Math.min(1, bankSize / ROTATION_WR_MIN_SAMPLES);
  const baseFrac = s.phi * s.sovereignty * maturity;
  const rewardMult = 1 + (nc.dopamine - nc.gaba);
  const stabilityMult = 0.75 + nc.serotonin * 0.5;

  // Exploration floor — Pillar 1 FLUCTUATIONS. 2026-05-25 (CC2 audit
  // F3): the previous `EXPLORATION_FLOOR = 0.20` magic constant is
  // replaced by the fraction that clears the exchange minimum
  // notional at current leverage — the SAME observer-derived quantity
  // that lift-to-min uses. This unifies two paths into one and grounds
  // the floor in actual exchange state, not a guessed constant.
  //
  // Fresh kernels (maturity ≈ 0) explore at exactly the min-clearing
  // frac; mature kernels let chemistry drive without floor support.
  // The floor is capped at 0.5 (the survival cap) so a tiny equity
  // pool combined with a large min-notional doesn't override the
  // upstream policy bound.
  const minClearingFrac =
    availableEquityUsdt > 0 && leverage > 0
      ? Math.min(0.5, (minNotionalUsdt * 1.05) / (leverage * availableEquityUsdt))
      : 0;
  const explorationFloor = minClearingFrac * (1 - maturity);

  const rawFrac = Math.max(explorationFloor, baseFrac * rewardMult * stabilityMult);
  // 2026-05-25 — frac clamp at 0.5: BOUNDARY (survival) not PARAMETER.
  //
  // History: an earlier same-day strip (#916) raised this to 1.0 on
  // the theory "the exchange rejects margin > equity anyway." CC2
  // audit + operator (Braden) directive restored it to 0.5. The
  // earlier strip confused two different boundaries:
  //   * Exchange margin requirement bounds absolute commitment
  //     (equity × exchangeMaxLev).
  //   * THIS survival cap bounds the KERNEL's own self-imposed risk:
  //     at most half of available equity in any single position so
  //     an adverse move doesn't create unrecoverable states
  //     regardless of how strong the Φ signal looked.
  // Exchange rejection is structurally downstream; this is upstream
  // policy. They are not substitutes for each other.
  //
  // Sizing magnitude relief comes from chemistry variance restoration
  // (#920/#927), maturity rate (#925, bankSize / ROTATION_WR_MIN_SAMPLES),
  // and per-lane / cell sizing — NOT from removing this survival cap.
  let frac = Math.min(0.5, Math.max(0, rawFrac));
  let margin = frac * availableEquityUsdt;
  let notional = margin * Math.max(1, leverage);

  // v0.6.6 "lift to minimum" — if we're below exchange min notional but
  // a fraction up to 0.5 CAN clear it, auto-raise to just enough.
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

  // 2026-05-25 — lane margin cap retained as a STRUCTURAL safety only:
  // it bounds margin to availableEquity (1.0 budgetFrac after the strip).
  // The cap effectively never binds with budgetFrac=1.0 unless a future
  // operator-MANDATE lane budget is introduced via the UI.
  let cappedByLane = false;
  if (margin > laneMarginCap) {
    margin = laneMarginCap;
    notional = margin * Math.max(1, leverage);
    cappedByLane = true;
  }

  // 2026-05-25 — code-side notional ceiling removed. The kernel's own
  // chemistry + the exchange's real liquidation point are the
  // restraints. cappedByNotional kept in derivation for backwards-
  // compatible telemetry consumers, but always 0 going forward.
  const cappedByNotional = 0;

  const sized = notional >= minNotionalUsdt ? margin : 0;

  return {
    value: sized,
    reason: `size[${lane}] = ${liftedToMin ? 'lifted-to-min ' : ''}${cappedByLane ? 'lane-capped ' : ''}floor(${explorationFloor.toFixed(3)}) or Φ×S×M(${(s.phi * s.sovereignty * maturity).toFixed(3)}) × reward(${rewardMult.toFixed(2)}) × stab(${stabilityMult.toFixed(2)}) × equity(${availableEquityUsdt.toFixed(2)}) @ ${leverage}x → margin ${margin.toFixed(2)} (lane-cap ${laneMarginCap.toFixed(2)}), notional ${notional.toFixed(2)} vs min ${minNotionalUsdt.toFixed(2)} = ${sized.toFixed(2)}`,
    derivation: {
      phi: s.phi, sovereignty: s.sovereignty, maturity, bankSize,
      dopamine: nc.dopamine, serotonin: nc.serotonin, gaba: nc.gaba,
      explorationFloor, rawFrac, frac, margin, leverage, notional,
      minNotional: minNotionalUsdt, sized, liftedToMin: liftedToMin ? 1 : 0,
      laneBudgetFrac: laneFrac,
      laneMarginCap, cappedByLane: cappedByLane ? 1 : 0,
      // 2026-05-25 — notional ceiling removed. Telemetry fields retained
      // as constants so dashboards / row consumers don't break.
      notionalCeilingRatio: 0,
      notionalCeiling: 0,
      cappedByNotional,
      // 2026-05-25 (CC2 audit F5): mode wired into derivation for
      // telemetry rather than left as a `void mode;` code smell. The
      // formula itself is mode-agnostic — mode-specific sizing now
      // expressed via chemistry — but downstream consumers (logs,
      // dashboards) record which mode was active for the entry.
      mode: mode === MonkeyMode.EXPLORATION ? 0
        : mode === MonkeyMode.INVESTIGATION ? 1
        : mode === MonkeyMode.INTEGRATION ? 2
        : mode === MonkeyMode.DRIFT ? 3
        : 4,
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
 * SEMANTIC: this is a CAP, not a replacement. It exists to PREVENT
 * over-sizing when Kelly is confident about a positive edge. When
 * Kelly is UNINFORMATIVE (no wins, no losses, near-break-even, or
 * negative edge — i.e. the rolling stats give us no reason to tighten),
 * the cap defers to the geometric formula by returning ``maxLev``.
 *
 * Why not return 1 for negative/zero edge?  Because the geometric
 * formula already encodes risk through κ-proximity, regime stability
 * and surprise discount. A weak Kelly statistic is a signal that
 * Kelly is uninformative, not a signal to crush leverage to 1 —
 * doing so would (a) make every position untradeable on small
 * accounts (margin × 1 < exchange min notional) and (b) silently
 * override the Fisher-Rao formula, defeating the "cap-only" promise.
 *
 * The cap activates ONLY when f* > 0, in which case it scales
 * leverage to a Kelly-justified ceiling but is floored at
 * ``KELLY_CAP_TRADABLE_FLOOR`` so a tiny positive edge can't
 * collapse leverage to 1 either. The floor is a SAFETY_BOUND
 * (preserves tradability), not a parameter.
 *
 * Edge cases:
 *   * No losses (avgLoss=0)    → return maxLev (defer to geometric).
 *   * No wins (avgWin=0)       → return maxLev (uninformative).
 *   * pWin <= 0                → return maxLev (uninformative).
 *   * b <= 0                   → return maxLev (uninformative).
 *   * f* <= 0 (negative edge)  → return maxLev (uninformative).
 *   * f* > 1                   → clamp to 1 (full-Kelly maximum).
 *   * 0 < f* ≤ 1               → cap = max(floor, round(f* × maxLev)).
 */
export const KELLY_CAP_TRADABLE_FLOOR = 8;

export function kellyLeverageCap(
  pWin: number,
  avgWin: number,
  avgLoss: number,
  maxLev: number,
): number {
  // Uninformative Kelly inputs → defer to geometric formula. Returning
  // maxLev makes the cap a no-op (the final clamp picks min(geometric,
  // kelly, max) so kelly=maxLev never binds).
  if (pWin <= 0 || avgWin <= 0) return maxLev;
  const absLoss = Math.abs(avgLoss);
  if (absLoss <= 1e-12) return maxLev;
  const b = avgWin / absLoss;
  if (b <= 0) return maxLev;
  const q = 1 - pWin;
  const fStar = (pWin * b - q) / b;
  // Negative or zero edge: Kelly says don't bet, but the geometric
  // formula already discounts via regime/κ/surprise — the cap should
  // not be the path that crushes leverage.
  if (fStar <= 0) return maxLev;
  const fStarClamped = Math.min(1, fStar);
  const rawCap = Math.round(fStarClamped * maxLev);
  // Floor at KELLY_CAP_TRADABLE_FLOOR so a small positive Kelly
  // fraction (e.g. f*=0.05 × maxLev=20 → 1) doesn't crush leverage
  // below the tradable minimum on small accounts. The floor is
  // bounded by maxLev so it never raises leverage above the exchange
  // boundary.
  return Math.max(1, Math.min(maxLev, Math.max(KELLY_CAP_TRADABLE_FLOOR, rawCap)));
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
  // ``kellyCap = maxLev`` (no-op) when rolling stats are absent
  // (cold start) OR when stats are uninformative (break-even,
  // negative edge, no wins/losses) — see kellyLeverageCap docstring.
  // The 2026-04-30 live-trading bug: pre-fix kellyLeverageCap returned
  // 1 for negative/zero edge, the min() then forced lev=1 regardless
  // of the geometric formula. Fixed by treating uninformative stats
  // as "Kelly defers to geometric" via maxLev.
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
  /** Proposal #10: lane scope. The "side mismatch" rejection is now
   *  internal to one lane — another lane on the same symbol can hold
   *  the opposite side without blocking this lane's DCA decision. */
  lane?: 'scalp' | 'swing' | 'trend';
}): ExecutiveDecision<boolean> {
  const {
    heldSide, sideCandidate, currentPrice, initialEntryPrice,
    addCount, lastAddAtMs, nowMs, sovereignty,
  } = req;
  const lane = req.lane ?? 'swing';

  if (heldSide !== sideCandidate) {
    return {
      value: false,
      reason: `side mismatch in lane ${lane} (${sideCandidate} vs held ${heldSide})`,
      derivation: { rule: 1, lane: lane === 'scalp' ? 0 : lane === 'swing' ? 1 : 2 },
    };
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
    reason: `DCA_OK[${lane}]: ${(priceDelta * 100).toFixed(2)}% from entry, addCount=${addCount}, sov=${sovereignty.toFixed(2)}`,
    derivation: { rule: 0, priceDelta, addCount, sovereignty },
  };
}

/**
 * shouldBracketExit — mechanical synthetic-bracket exit (Phase B2).
 *
 * The commit-and-revise exit model: at entry the kernel commits a
 * geometry-derived TP/SL bracket (Phase B1 persists tpPrice/slPrice on
 * the trade row). This gate is the *mechanical enforcer* — no
 * discretion, no per-tick judgement: has the mark price crossed the
 * committed level? Poloniex v3 has no native TP/SL order, so the
 * kernel watches the price and fires the close itself; the decision
 * was already made at entry.
 *
 * When this gate is live (MONKEY_BRACKET_EXIT_LIVE) and a row carries a
 * bracket, it REPLACES the discretionary profit-take path
 * (shouldProfitHarvest / shouldAggregateHarvest / scalp-TP). The
 * loss-side time/tape safety gates (slow-bleed, fast-adverse) still run
 * — a bracket SL is a price stop, not a time stop.
 *
 * LONG: TP above entry, SL below. SHORT mirrored. A null level is
 * simply not checked (ATR-warmup entries have NULL columns); null on
 * BOTH → no_bracket, caller falls through to the legacy gates.
 *
 * exitTypeBit 11 = BRACKET_TP, 12 = BRACKET_SL.
 */
export function shouldBracketExit(
  markPrice: number,
  heldSide: 'long' | 'short',
  tpPrice: number | null,
  slPrice: number | null,
): ExecutiveDecision<boolean> {
  if (tpPrice === null && slPrice === null) {
    return { value: false, reason: 'no_bracket', derivation: {} };
  }
  const tpHit = tpPrice !== null && (
    heldSide === 'long' ? markPrice >= tpPrice : markPrice <= tpPrice
  );
  if (tpHit) {
    return {
      value: true,
      reason: `bracket_tp: mark ${markPrice} ${heldSide === 'long' ? '>=' : '<='} TP ${tpPrice}`,
      derivation: { markPrice, tpPrice: tpPrice as number, exitTypeBit: 11 },
    };
  }
  const slHit = slPrice !== null && (
    heldSide === 'long' ? markPrice <= slPrice : markPrice >= slPrice
  );
  if (slHit) {
    return {
      value: true,
      reason: `bracket_sl: mark ${markPrice} ${heldSide === 'long' ? '<=' : '>='} SL ${slPrice}`,
      derivation: { markPrice, slPrice: slPrice as number, exitTypeBit: 12 },
    };
  }
  return {
    value: false,
    reason: 'within_bracket',
    derivation: {
      markPrice,
      ...(tpPrice !== null ? { tpPrice } : {}),
      ...(slPrice !== null ? { slPrice } : {}),
    },
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

  // ABSOLUTE-USD harvest — operator-observed gap (2026-05-19):
  //
  // Peak tracking is per-(symbol, lane) inside each kernel instance.
  // With multi-kernel + multi-agent (monkey-position + monkey-swing
  // running K + T sides), a single user-facing position is split into
  // subsets. A $5+ user-visible profit fragments into ~$1-2 per subset
  // — below the % activation threshold (0.2-0.4% of subset notional) on
  // wider lanes (trend at 40% TP target), so no subset arms the
  // trailing harvest. Market reverses, turtle_stop fires for a loss,
  // and the operator watches a $5+ peak round-trip to red.
  //
  // Fix: parallel absolute-USD gate. When peak ≥ MONKEY_HARVEST_ABS_PEAK_USD
  // (default $3) AND current has given back to ≤ peak × (1 - giveback)
  // BUT still positive, harvest. Independent of % activation so it
  // fires regardless of subset size or lane width. Default $3 matches
  // operator expectation: "kernels should take the small wins, fees
  // aren't a factor on this tier".
  //
  // 2026-05-25 strip — abs-USD harvest threshold dropped to 0 per
  // operator autonomy doctrine. Every peak is considered for harvest;
  // chemistry decides whether to lock in (peak give-back > threshold)
  // or let it run. The $3 magic number is gone.
  const absPeakMinUsd = 0;
  if (
    peakPnlUsdt >= absPeakMinUsd
    && currentFrac > 0
    && unrealizedPnlUsdt < peakPnlUsdt * (1 - giveback)
  ) {
    return {
      value: true,
      reason: `abs_usd_harvest: peak $${peakPnlUsdt.toFixed(2)} → now $${unrealizedPnlUsdt.toFixed(2)} < $${(peakPnlUsdt * (1 - giveback)).toFixed(2)} floor (threshold $${absPeakMinUsd.toFixed(2)}, giveback ${(giveback * 100).toFixed(0)}%)`,
      derivation: {
        currentPnlUsdt: unrealizedPnlUsdt,
        peakPnlUsdt,
        absPeakMinUsd,
        absoluteFloor: peakPnlUsdt * (1 - giveback),
        giveback,
        exitTypeBit: 4,
      },
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
 * shouldAggregateHarvest — cross-kernel aggregate-PnL harvest gate.
 *
 * Companion to shouldProfitHarvest. While shouldProfitHarvest decides
 * based on a SINGLE kernel's view of its own subset of a position,
 * shouldAggregateHarvest decides based on the AGGREGATE position
 * across all in-process kernels + agents (read from aggregatePeakTracker,
 * which FAT populates each cycle from the exchange-side position view).
 *
 * Why both: per-subset peaks fragment a $3+ aggregate profit into
 * ~$0.50-$1.50 chunks — below the % activation threshold AND below the
 * abs-USD threshold in #855. The aggregate gate sees the user-facing
 * peak directly and fires when the aggregate has given back, regardless
 * of how the position is split internally.
 *
 * Decision flow per tick (in loop.ts):
 *   1. Call shouldProfitHarvest with local subset PnL + peak. If fires
 *      on the existing % or per-subset abs path → close subset.
 *   2. ALSO call shouldAggregateHarvest with aggregate PnL + peak from
 *      the cross-kernel tracker. If fires → close subset.
 *   Each kernel running this evaluates the SAME aggregate state and
 *   independently closes its own subset; total realized ≈ aggregate
 *   current at firing time.
 *
 * The threshold defaults to MONKEY_HARVEST_AGG_PEAK_USD (default $3 —
 * tracks the operator's stated expectation) and is independent of
 * MONKEY_HARVEST_ABS_PEAK_USD which gates the per-subset abs path.
 *
 * Returns { value: false } when aggregate inputs are null/undefined
 * (FAT hasn't observed yet); caller falls through to the per-subset
 * path with no behaviour change.
 */
export function shouldAggregateHarvest(
  aggregateCurrentPnlUsdt: number | null,
  aggregatePeakPnlUsdt: number | null,
  s: BasinState,
): ExecutiveDecision<boolean> {
  if (
    aggregateCurrentPnlUsdt === null
    || aggregatePeakPnlUsdt === null
  ) {
    return {
      value: false,
      reason: 'aggregate_unavailable: FAT has not observed yet',
      derivation: {},
    };
  }

  // 2026-05-25 strip — MONKEY_HARVEST_AGG_PEAK_USD env + $3 default
  // removed. Aggregate peak with give-back triggers harvest regardless
  // of magnitude; chemistry decides whether to act on small wins.
  const absPeakMinUsd = 0;

  // Use the SAME serotonin-scaled giveback as the per-subset path so
  // the discipline is consistent across the two harvest gates.
  // (Calm market → wider giveback, lets winners run; unstable market →
  // tighter, harvests sooner.)
  const giveback = 0.30 + 0.20 * s.neurochemistry.serotonin;
  const floor = aggregatePeakPnlUsdt * (1 - giveback);

  if (
    aggregatePeakPnlUsdt >= absPeakMinUsd
    && aggregateCurrentPnlUsdt > 0
    && aggregateCurrentPnlUsdt < floor
  ) {
    return {
      value: true,
      reason: `aggregate_harvest: peak $${aggregatePeakPnlUsdt.toFixed(2)} → now $${aggregateCurrentPnlUsdt.toFixed(2)} < $${floor.toFixed(2)} floor (threshold $${absPeakMinUsd.toFixed(2)}, giveback ${(giveback * 100).toFixed(0)}%)`,
      derivation: {
        aggregateCurrentPnlUsdt,
        aggregatePeakPnlUsdt,
        absPeakMinUsd,
        floor,
        giveback,
        exitTypeBit: 5,
      },
    };
  }

  return {
    value: false,
    reason: `aggregate_hold: peak $${aggregatePeakPnlUsdt.toFixed(2)}, current $${aggregateCurrentPnlUsdt.toFixed(2)}, floor $${floor.toFixed(2)} (threshold $${absPeakMinUsd.toFixed(2)})`,
    derivation: {
      aggregateCurrentPnlUsdt, aggregatePeakPnlUsdt,
      absPeakMinUsd, floor, giveback,
    },
  };
}

/**
 * shouldSlowBleedExit — time-based escape for slow adverse bleeds.
 *
 * Evidence (2026-05-19 19:00:13 incident): BTC short held 103 minutes
 * through a 0.334% adverse raw price move. At lev=22 that's +7.3% ROI
 * on margin — below the 15% swing-lane SL threshold by design. The
 * SL gate held correctly under its own rules; the time axis was
 * uncovered. Position bled $13.34 across the hold.
 *
 * Doctrine: a position that's still red after holding >60min AND has
 * accumulated ≥50% of its SL budget AND has clearly-adverse tape
 * alignment is "we were wrong, the move isn't coming." Get out via
 * time-axis rather than waiting for SL to trip.
 *
 * Gating (all must hold):
 *   lane ∈ {swing, trend}  — scalp has its own fast TP/SL, skip
 *   heldMs >= 60 min       — give the thesis time to play out
 *   roiFrac < 0            — must be in the red
 *   |roiFrac| >= 0.5×laneSL — bled at least half the SL budget
 *   tape adverse (align ≤ -0.2) — tape supports the opposite side
 *
 * Doesn't override SL (still fires at 15% / 40% as configured per lane);
 * fires sooner when time + tape evidence is conclusive.
 *
 * Per red-team audit promotion (claude.ai 2026-05-19): this is the
 * single highest-EV gate addition for the BTC bleed pattern observed
 * across the day. Validated against the 7-position 17:16-19:00 stuck
 * positions earlier — would have closed each at ~60min instead of
 * 103min, cutting ~$8 off the worst-case adverse hold.
 */
export function shouldSlowBleedExit(args: {
  unrealizedPnlUsdt: number;
  notionalUsdt: number;
  leverage: number;
  heldMs: number;
  tapeTrend: number;
  heldSide: 'long' | 'short';
  lane: LaneType;
}): ExecutiveDecision<boolean> {
  const { unrealizedPnlUsdt, notionalUsdt, leverage, heldMs, tapeTrend, heldSide, lane } = args;
  // Encode lane / heldSide as numeric flags so derivation typing
  // (Record<string, number>) is satisfied. scalp=0/swing=1/trend=2,
  // long=1/short=-1.
  const laneCode = lane === 'scalp' ? 0 : lane === 'swing' ? 1 : 2;
  const sideCode = heldSide === 'long' ? 1 : -1;
  if (lane !== 'swing' && lane !== 'trend') {
    return { value: false, reason: 'scalp_lane_skip', derivation: { laneCode } };
  }
  if (notionalUsdt <= 0) {
    return { value: false, reason: 'no_position', derivation: {} };
  }
  const heldS = heldMs / 1000;
  const minHeldS = 60 * 60;  // 60 min
  if (heldS < minHeldS) {
    return { value: false, reason: 'under_60min', derivation: { heldS, minHeldS } };
  }
  // ROI on margin (matching #828's currentRoi convention so the user
  // can reason about the gate in same terms as displayed PnL%).
  const roiFrac = (unrealizedPnlUsdt / notionalUsdt) * Math.max(1, leverage);
  if (roiFrac >= 0) {
    return { value: false, reason: 'not_in_loss', derivation: { roiFrac } };
  }
  // Qualifying-magnitude gate. Two independent arms (either trips):
  //
  //   PCT arm  — |roiFrac| ≥ 0.5 × laneSL. The original gate.
  //   ABS arm  — |unrealizedPnlUsdt| ≥ MONKEY_SLOW_BLEED_ABS_USD.
  //
  // The ABS arm was added 2026-05-20 from a Poloniex-export audit:
  // an ETH position bled −$2.59 over 2h54m but sat at only ≈−0.8%
  // ROI the whole hold — far below the 7.5%/20% half-SL pct gate, so
  // slow-bleed never fired. Same %-vs-$ mismatch that motivated the
  // absolute-USD harvest gates (#855/#856). The ABS arm makes the
  // loss-side time-exit symmetric with the win-side harvest: if a
  // position is still red by more than the harvest peak threshold
  // after 60min + adverse tape, the thesis is wrong — exit.
  //
  // Default $3 mirrors MONKEY_HARVEST_AGG_PEAK_USD so win/loss
  // discipline is symmetric out of the box; tune via env if the
  // realized-PnL distribution argues for it.
  // Path A (2026-05-26): laneSL removed from registry; pct-arm dead.
  // The abs-arm with absBleedUsd=0 means "any negative USD with adverse
  // tape after 60min qualifies". Pct-arm went away with lane SL params.
  // Chemistry's gaba response learns the give-up threshold from the
  // realized losses fed back through push_reward.
  const absBleedUsd = 0;
  const absArm = Math.abs(unrealizedPnlUsdt) >= absBleedUsd;
  if (!absArm) {
    return {
      value: false, reason: 'under_abs_bleed_usd',
      derivation: { roiFrac, unrealizedPnlUsdt, absBleedUsd },
    };
  }
  // Tape alignment with held side: for long, positive tape is aligned;
  // for short, negative tape is aligned. Adverse = alignment < -0.2.
  const alignment = heldSide === 'long' ? tapeTrend : -tapeTrend;
  if (alignment > -0.2) {
    return {
      value: false, reason: 'tape_neutral_or_aligned',
      derivation: { alignment, tapeTrend, sideCode },
    };
  }
  const heldMin = (heldS / 60).toFixed(0);
  return {
    value: true,
    reason: `slow_bleed_exit[${lane}]: ${heldMin}min @ ROI=${(roiFrac * 100).toFixed(1)}% pnl=$${unrealizedPnlUsdt.toFixed(2)} (abs arm), tape adverse (align=${alignment.toFixed(2)})`,
    derivation: {
      roiFrac,
      unrealizedPnlUsdt, absBleedUsd,
      heldS, heldMs, alignment, tapeTrend, sideCode, laneCode,
      exitTypeBit: 9,  // SLOW_BLEED_EXIT
    },
  };
}

/**
 * shouldAggregateBleedExit — cross-kernel companion to shouldSlowBleedExit.
 *
 * shouldSlowBleedExit decides on a SINGLE kernel's subset. A position
 * split across kernels (monkey-position + monkey-swing × K + T) bleeds
 * in aggregate while each subset sits at a fraction of the loss — the
 * exact fragmentation that lets a −$2.59 ETH bleed run 2h54m without
 * any subset's gate tripping. This gate reads the AGGREGATE loss + age
 * from aggregatePeakTracker (FAT-populated) so the decision is made on
 * the user-facing position.
 *
 * Mirror of shouldAggregateHarvest on the loss side. Each kernel that
 * evaluates this closes its own subset; together they flatten the
 * aggregate. Fires when:
 *   - aggregate age ≥ MONKEY_SLOW_BLEED_MIN_MIN (default 60min)
 *   - aggregate current PnL ≤ −MONKEY_SLOW_BLEED_ABS_USD (default $3)
 *   - tape adverse to the held side (alignment ≤ -0.2)
 *
 * No lane / SL-percent arm here — the aggregate has no single lane and
 * the whole point is the dollar-magnitude axis the pct gate misses.
 *
 * Returns { value:false } when aggregate inputs are null (FAT has not
 * observed yet); caller falls through to per-subset shouldSlowBleedExit.
 */
export function shouldAggregateBleedExit(
  aggregateCurrentPnlUsdt: number | null,
  aggregateAgeMs: number | null,
  tapeTrend: number,
  heldSide: 'long' | 'short',
  s: BasinState,
): ExecutiveDecision<boolean> {
  if (aggregateCurrentPnlUsdt === null || aggregateAgeMs === null) {
    return {
      value: false,
      reason: 'aggregate_unavailable: FAT has not observed yet',
      derivation: {},
    };
  }
  // Phase 3 doctrine (2026-05-26): bleed-exit is chemistry-derived,
  // not fixed-dollars + fixed-minutes. Removes:
  //   MONKEY_SLOW_BLEED_ABS_USD (was 3.0)
  //   MONKEY_SLOW_BLEED_MIN_MIN (was 60)
  //
  // Gate semantics:
  //   - In a loss (pnl < 0)
  //   - Tape adverse to held side (alignment < -0.2)
  //   - Kernel inhibition exceeds reassurance: gaba > serotonin
  //
  // The gaba > serotonin comparison IS the doctrine-clean threshold:
  // both are kernel-internal observables, and their crossing point is
  // structural (no operator-picked constant between them). When
  // inhibition exceeds reassurance, the kernel itself signals "I'm
  // anxious about this position." Combined with adverse tape and
  // realised loss, the kernel exits its own bleed.
  //
  // Position age is logged for telemetry but does NOT gate firing —
  // the kernel decides via its own chemistry whether the age has
  // mattered.
  const ageMin = aggregateAgeMs / 60_000;
  if (aggregateCurrentPnlUsdt >= 0) {
    return {
      value: false, reason: `not_in_loss (pnl=$${aggregateCurrentPnlUsdt.toFixed(2)})`,
      derivation: { aggregateCurrentPnlUsdt, ageMin },
    };
  }
  const alignment = heldSide === 'long' ? tapeTrend : -tapeTrend;
  if (alignment > -0.2) {
    return {
      value: false, reason: 'tape_neutral_or_aligned',
      derivation: { alignment, tapeTrend, aggregateCurrentPnlUsdt, ageMin },
    };
  }
  const gaba = s.neurochemistry.gaba;
  const serotonin = s.neurochemistry.serotonin;
  if (gaba <= serotonin) {
    return {
      value: false,
      reason: `kernel_unbothered (gaba=${gaba.toFixed(3)} <= ser=${serotonin.toFixed(3)})`,
      derivation: { gaba, serotonin, aggregateCurrentPnlUsdt, ageMin, alignment },
    };
  }
  return {
    value: true,
    reason: `aggregate_bleed_exit: pnl=$${aggregateCurrentPnlUsdt.toFixed(2)}, gaba=${gaba.toFixed(3)} > ser=${serotonin.toFixed(3)}, tape adverse (align=${alignment.toFixed(2)}), age=${ageMin.toFixed(0)}min`,
    derivation: {
      aggregateCurrentPnlUsdt, ageMin, alignment, tapeTrend,
      gaba, serotonin,
      exitTypeBit: 10,  // AGGREGATE_BLEED_EXIT
    },
  };
}

/**
 * shouldScalpExit — Φ-derived take-profit gate (Path A, 2026-05-26).
 *
 * **Take-profit-only** since Path A (P5 alignment). The hard-SL leg was
 * an externally-imposed ROI threshold that fired regardless of where
 * the kernel itself read the position going — a P5 (Observer-Sets-Params)
 * violation. Adverse exits now flow through:
 *   - `shouldExit` (Fisher-Rao disagreement between perception and
 *     strategy_forecast — kernel reads its own prediction limit)
 *   - `shouldAutoFlatten` (P15 catastrophic backstop on entropy/fhealth)
 *
 * TP threshold is chemistry-derived (unchanged):
 *   TP = mode.tpBaseFrac - 0.3 %·dopamine + 0.5 %·Φ (min `tpFloorRaw`)
 *
 * High dopamine (recent wins) → take earlier (reward sensitivity up).
 * High Φ (integrated state)  → let winners run longer.
 */
export function shouldScalpExit(
  unrealizedPnlUsdt: number,
  notionalUsdt: number,
  s: BasinState,
  mode: MonkeyMode = MonkeyMode.INVESTIGATION,
  lane: 'scalp' | 'swing' | 'trend' = 'swing',
  leverage: number = 1,
): ExecutiveDecision<boolean> {
  // v0.8.6 (2026-05-01) — pnlFrac semantics CHANGED from
  // "PnL / notional" (raw price movement %) to "PnL / margin"
  // ("ROI on margin %"). Leverage is now threaded in so we can
  // derive margin from notional / leverage. This fixes the live
  // failure where an ETH long sat at -4.4% ROI for 4+ hours without
  // the 1.5% raw-price SL firing because raw price only moved -0.30%
  // (the SL gate was reading raw movement, not ROI on margin). Lane
  // SL/TP defaults are rescaled to the ROI scale in the same rev —
  // see LANE_PARAMETER_DEFAULTS.
  //
  // For back-compat with cold callers, leverage defaults to 1, in
  // which case ROI == raw move and the gate behaves as before. All
  // production callers (loop.ts) pass the live position leverage.
  if (notionalUsdt <= 0) {
    return { value: false, reason: 'no position notional', derivation: {} };
  }
  // ROI on margin = (PnL / notional) × leverage. lev=1 collapses to the
  // legacy raw-move semantic; at typical 15-20x live leverage it scales
  // the gate up to its intended sensitivity range.
  const lev = leverage > 0 ? leverage : 1;
  const rawFrac = unrealizedPnlUsdt / notionalUsdt;
  const roiFrac = rawFrac * lev;
  const nc = s.neurochemistry;
  // Mode picks the baseline; Φ + dopamine modulate within that mode.
  const profile = MODE_PROFILES[mode];
  // Geometric thresholds are on the raw-price-move scale.
  //
  // The 0.003 (0.3% raw) floor was originally justified as
  // "clear ~0.12% round-trip taker fee with buffer." Operator confirmed
  // 2026-05-19 they're on a fee-free Polo tier, so the fee-clearing
  // rationale is dead. Only the noise-floor rationale remains, and that
  // can be much lower than 0.3% (BTC tick noise is single-bp scale).
  //
  // Lowered floor 0.003 → 0.001 (0.1% raw, 10bp) — still well above
  // tick-noise, but lets the geometric TP fire at lower leverage where
  // lane TP (15% ROI) would otherwise dominate the threshold.
  //
  // Phase 7 (2026-05-27) — MONKEY_SCALP_TP_FLOOR_RAW (was 0.001) removed.
  // Doctrine: the floor is the 1% noise-floor sentinel from PR #950's
  // Fibonacci reward shape, divided by leverage to get to the raw-price
  // scale. Below this, the kernel learns nothing from the close anyway
  // (oceanCoeff = 0). So the TP floor IS the noise-floor / lev — making
  // it observer-derived from leverage (an observable at decision time).
  //
  // At lev=10: floor = 0.01/10 = 0.001 (matches old default).
  // At lev=20: floor = 0.0005 (looser raw-floor for higher-leverage trades).
  // At lev=1:  floor = 0.01    (10× the raw move needed to clear noise).
  //
  // Self-scales with leverage; no external constant. The 0.01 is the
  // 1% noise floor from #950 — already a doctrinal structural constant
  // (the Fibonacci reward's tier-0 boundary).
  const NOISE_FLOOR_ROI = 0.01;
  const tpFloorRaw = NOISE_FLOOR_ROI / Math.max(1, lev);
  const geometricTpRaw = Math.max(
    tpFloorRaw,
    profile.tpBaseFrac - 0.003 * nc.dopamine + 0.005 * s.phi,
  );
  const geometricTp = geometricTpRaw * lev;
  // Proposal #10 — per-lane TP envelope. Path A (2026-05-26) removed the SL
  // envelope entirely (P5 alignment). Adverse exits now flow through
  // shouldExit (Fisher-Rao disagreement) + shouldAutoFlatten (Pillar 1).
  const laneTp = laneParam(lane, 'tpPct');
  const tpThr = Math.max(geometricTp, laneTp);

  // Encode type as a bit (1=TP, 0=hold) — SL bit (-1) removed by Path A.
  if (roiFrac >= tpThr) {
    return {
      value: true,
      reason: `take_profit[${lane}]: roi ${(roiFrac * 100).toFixed(3)}% ≥ ${(tpThr * 100).toFixed(3)}% (lev=${lev.toFixed(0)}x)`,
      derivation: {
        roiFrac, rawFrac, leverage: lev,
        tpThr,
        laneTpPct: laneTp,
        exitTypeBit: 1,
      },
    };
  }
  return {
    value: false,
    reason: `scalp hold[${lane}]: roi ${(roiFrac * 100).toFixed(3)}% < ${(tpThr * 100).toFixed(3)}% (lev=${lev.toFixed(0)}x) [Path A: no SL gate]`,
    derivation: {
      roiFrac, rawFrac, leverage: lev,
      tpThr,
      laneTpPct: laneTp,
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


// ═══════════════════════════════════════════════════════════════
//  Lane selection — simplex projection over basin features
//  (QIG-pure replacement for the prior softmax path).
// ═══════════════════════════════════════════════════════════════

export type LaneType = 'scalp' | 'swing' | 'trend' | 'observe';

/**
 * Select execution lane from basin geometry via Δ³ simplex projection.
 *
 * QIG purity note: the prior implementation used Math.exp normalisation
 * (softmax) which is forbidden by the kernel doctrine — see
 * QIG_PURITY_KERNEL_REFERENCE.md §2. The replacement is `toSimplex`
 * (positive-orthant clamp + L1 normalize) — same shape (probability over
 * lanes) but principled derivation. Discovered 2026-05-19 cross-review
 * of "softmax temperature spread" metaphor — even mentioning softmax
 * reaches for the Euclidean substrate-assumption that the doctrine
 * exists to prevent.
 *
 * The score vector + additive priors flow through `toSimplex`:
 *   scores = base lane scores from basin geometry (already pure)
 *   shifts = SENSE-2c winrate priors + REGIME-1 cell laneBias (additive)
 *   probs  = toSimplex(scores + shifts)
 *
 * No temperature parameter. The earlier `τ = 1/κ` framing imported the
 * Euclidean exploration-exploitation concept; κ already informs many
 * other gates (entry threshold, leverage, conviction streak). The
 * simplex projection is parameter-free by design.
 *
 * Optional `lanePrior` callback (SENSE-2c Phase 2) — returns a per-lane
 * observed-winrate in [0, 1]; treated as additive bias on the score
 * with neutral=0.5 (so `rate - 0.5` becomes the shift, 0 means no signal).
 *
 * Optional `cellLaneBias` (REGIME-1 Phase 3) — the lane recommended by
 * the compositional 3×3 cell matrix. Adds a fixed +0.5 score boost to
 * that lane (strong nudge but not a hard override since the base score
 * also contributes).
 */
export function chooseLane(
  s: BasinState,
  tapeTrend: number = 0,
  lanePrior?: (lane: LaneType) => number | null,
  cellLaneBias?: LaneType | null,
): ExecutiveDecision<LaneType> {
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

  // SENSE-2c Phase 2 — per-lane session prior, centred on 0.5 so the
  // additive shift on the score is 0 at the neutral rate. Lanes with
  // stronger time-of-day-similar history get a positive shift; lanes
  // with weaker history get a negative shift. Callbacks returning null
  // are treated as neutral (shift = 0).
  const priorShift: Record<LaneType, number> = { scalp: 0, swing: 0, trend: 0, observe: 0 };
  if (lanePrior) {
    for (const k of Object.keys(scores) as LaneType[]) {
      const rate = lanePrior(k);
      if (rate !== null && Number.isFinite(rate)) {
        priorShift[k] = rate - 0.5;
      }
    }
  }
  // REGIME-1 Phase 3 — compositional cell lane bias. Adds a fixed +0.5
  // boost to the cell-recommended lane's score. Stacks with SENSE-2c
  // prior. 'observe' bias is intentionally not boosted — DISSOLVER cells
  // get size=0 elsewhere, so steering the lane to observe here is
  // redundant and would prevent the eventual sense2c prior recovery
  // when the regime transitions.
  if (cellLaneBias && cellLaneBias !== 'observe') {
    priorShift[cellLaneBias] += 0.5;
  }

  // QIG-pure simplex projection: positive-orthant clamp + L1 normalize.
  // `toSimplex` IS the canonical replacement per basin.ts (uses
  // Math.max(x, EPS) then divides by sum). Same probability-over-lanes
  // shape as softmax, no exp normalisation.
  const lanesOrdered: LaneType[] = ['scalp', 'swing', 'trend', 'observe'];
  const scoreVec = lanesOrdered.map((l) => scores[l] + priorShift[l]);
  const simplex = toSimplex(scoreVec);
  const probs: Record<LaneType, number> = { scalp: 0, swing: 0, trend: 0, observe: 0 };
  for (let i = 0; i < lanesOrdered.length; i++) {
    probs[lanesOrdered[i]!] = simplex[i]!;
  }

  let lane: LaneType = 'swing';
  let maxProb = 0;
  for (const [k, v] of Object.entries(probs) as [LaneType, number][]) {
    if (v > maxProb) {
      maxProb = v;
      lane = k;
    }
  }

  // ─── fix/lane-budget-size-zero-regression: structural-zero fallback ───
  //
  // If the chosen position-bearing lane has budgetFrac=0 (e.g. trend is
  // opt-in via the parameter registry and defaults to 0), the upstream
  // sizer collapses every entry to 0. Fall through to the next-highest
  // lane that is *capable* of holding capital. 'observe' is decision-
  // only and stays as-is (the loop maps it to swing for sizing).
  const isZeroBudgetPosLane = (l: LaneType): boolean =>
    (l === 'scalp' || l === 'swing' || l === 'trend') && laneBudgetFraction(l) === 0;
  let fallbackFrom: LaneType | null = null;
  if (isZeroBudgetPosLane(lane)) {
    fallbackFrom = lane;
    let nextProb = -1;
    let next: LaneType = lane;
    for (const [k, v] of Object.entries(probs) as [LaneType, number][]) {
      if (k === lane) continue;
      if (k === 'observe') continue;
      if (isZeroBudgetPosLane(k)) continue;
      if (v > nextProb) {
        nextProb = v;
        next = k;
      }
    }
    if (next !== lane) {
      lane = next;
    }
  }

  return {
    value: lane,
    reason: `lane=${lane}${fallbackFrom && fallbackFrom !== lane ? ` (fallback from ${fallbackFrom}, budget=0)` : ''} (simplex: scalp=${probs.scalp.toFixed(3)} swing=${probs.swing.toFixed(3)} trend=${probs.trend.toFixed(3)} observe=${probs.observe.toFixed(3)})`,
    derivation: {
      phi: s.phi,
      sovereignty: s.sovereignty,
      basinVelocity: s.basinVelocity,
      tapeTrend,
      fallbackFromZeroBudget: fallbackFrom && fallbackFrom !== lane ? 1 : 0,
      lanePriorShiftScalp: priorShift.scalp,
      lanePriorShiftSwing: priorShift.swing,
      lanePriorShiftTrend: priorShift.trend,
      lanePriorShiftObserve: priorShift.observe,
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
 * Pure geometric direction — no emotion conviction gate.
 *
 * geometric_signal = basinDir + 0.5 * tapeTrend.
 * Returns 'long' when positive, 'short' when negative, 'flat' when
 * the signal is exactly zero (vanishingly rare in practice).
 *
 * Basin dominates; tape consensus tilts when basin is ambiguous.
 *
 * Used by the TS execution path: the Layer 2B emotion conviction gate
 * (confidence < anxiety) is Python-side only until the full emotion
 * stack (motivators / sensations / foresight) is ported to TS. When
 * κ deviates from κ*=64 by more than 1 unit — normal operating range
 * — transcendence = |κ − κ*| > 1 makes confidence = (1−transcendence)×Φ
 * negative, which means confidence < anxiety for every tick, collapsing
 * every entry to 'flat'. Pure geometry is the documented TS contract.
 */
export function geometricDirection(args: {
  basinDir: number;
  tapeTrend: number;
}): Direction {
  const geometricSignal = args.basinDir + 0.5 * args.tapeTrend;
  if (geometricSignal > 0) return 'long';
  if (geometricSignal < 0) return 'short';
  return 'flat';
}

/**
 * Geometric direction read with emotion conviction gate.
 *
 * geometric_signal = basinDir + 0.5 * tapeTrend.
 * Returns 'long' when positive, 'short' when negative, 'flat' when
 * zero or when emotions.confidence < emotions.anxiety (low conviction
 * overrides any geometric lean).
 *
 * Basin dominates; tape consensus tilts when basin is ambiguous.
 *
 * NOTE: use geometricDirection() in the TS execution path — the
 * confidence < anxiety gate fires for any κ that deviates from κ*=64
 * by more than 1 unit, which is the normal operating range. This
 * function is kept for Python parity (kernel_direction in executive.py)
 * and for when the full TS emotion stack is ported.
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

/**
 * shouldExtendBracket — revise a committed bracket on fresh intel (Phase C).
 *
 * The "revise" half of commit-and-revise. Once a position carries a
 * synthetic bracket (Phase B), each tick re-reads the geometry. When the
 * fresh Fisher-Rao state says the move has further to run, the kernel:
 *   - EXTENDS the take-profit further out (never pulls it in), and
 *   - TRAILS the stop-loss toward profit (never widens it).
 *
 * Both edits are strictly monotonic in the position's favour — a bracket
 * can only ever improve. That invariant is what makes revision safe to
 * run every tick: it cannot turn a winning thesis into a worse one.
 *
 * TP extension gates (all must hold):
 *   - position is in profit (currentRoiFrac > 0) — never chase a TP out
 *     on a losing position
 *   - conviction ≥ MONKEY_BRACKET_EXTEND_CONV (default 0.5) — only a
 *     well-integrated, confident basin earns a longer target
 *   - the freshly-projected TP is strictly further than the current one
 *
 * SL trail gates:
 *   - position is in profit — trailing a stop on a red position is just
 *     a tighter loss; the loss-side safety gates own that
 *   - profit is meaningful enough to avoid flat sub-dime stop ratchets
 *   - the trailed SL is strictly better (higher for long, lower for
 *     short) than the current SL
 *
 * Returns `newTp` / `newSl` as numbers when a revision is warranted,
 * null when that side is unchanged. Pure — caller performs the DB write.
 */
export interface BracketRevision {
  /** True iff at least one of newTp / newSl is non-null. */
  changed: boolean;
  /** Revised take-profit price, or null to leave it unchanged. */
  newTp: number | null;
  /** Revised stop-loss price, or null to leave it unchanged. */
  newSl: number | null;
  /** Human-readable summary for telemetry / the trade reason field. */
  reason: string;
}

export function shouldExtendBracket(args: {
  heldSide: 'long' | 'short';
  entryPrice: number;
  markPrice: number;
  currentTp: number | null;
  currentSl: number | null;
  /** Fresh FR bracket distances this tick (frBracketDistances output).
   *  Used as a FALLBACK when oceanTrailRetracementPct is not provided
   *  (back-compat for the executeEntry path which still anchors the
   *  initial bracket via ATR/Pine geometry). */
  freshTpDistance: number;
  freshSlDistance: number;
  /** Fresh conviction = φ × rConf ∈ [0,1]. */
  conviction: number;
  /** Current unrealized ROI as a fraction (e.g. +0.02 = +2%). */
  currentRoiFrac: number;
  /** Current unrealized PnL in USDT; used to reject sub-meaningful ratchets. */
  currentPnlUsdt: number;
  /** Ocean-tier trail retracement window as a fraction of mark price
   *  (e.g. 0.05 = 5%). Matrix tier-3 doctrine extension (2026-05-26):
   *  when supplied, this replaces freshSlDistance as the authoritative
   *  SL trail distance — `oceanTrailRetracement(coherenceStreak)` reads
   *  one kernel-observable (consecutive coherent ticks per shouldExit)
   *  and picks a Fibonacci-tier retracement from {3%, 5%, 8%, 13%, 21%}.
   *  When omitted, falls back to freshSlDistance (legacy ATR path). */
  oceanTrailRetracementPct?: number;
}): BracketRevision {
  const {
    heldSide, entryPrice, markPrice, currentTp, currentSl,
    freshTpDistance, freshSlDistance, conviction, currentRoiFrac, currentPnlUsdt,
    oceanTrailRetracementPct,
  } = args;

  // Phase 4 doctrine (2026-05-26): bracket-extend conviction threshold
  // removed. Was MONKEY_BRACKET_EXTEND_CONV (default 0.5) — operator-
  // prescribed minimum conviction before TP extension fires. Replaced
  // by "extend on any positive conviction" — same pattern as Path A
  // (#940) and the 2026-05-25 minTrailRoi strip just below.
  //
  // The 0.5 was filtering ~half of in-profit moments where conviction
  // (phi × regimeConfidence) was below the operator's bar. The
  // doctrine-clean shape: the kernel extends whenever in-profit + TP
  // exists; chemistry learns via push_reward feedback whether
  // aggressive extension protects (locks in upside) or over-tightens
  // (gets shaken out by noise). No env knob between observable and
  // action.
  const convThreshold = 0;
  const inProfit = currentRoiFrac > 0;
  // 2026-05-25 strip — bracket trail minimums dropped to 0 per
  // operator autonomy doctrine. Trail activates on any positive
  // ROI; chemistry learns whether early trailing protects or
  // over-tightens via push_reward feedback on close outcomes.
  //
  // 2026-05-26 (#948) — sub-1% ROI noise floor moved to the LEARNING
  // signal (ocean_reward.ts emits zero positive chemistry below 1%).
  // The trail itself fires on any positive ROI; chemistry stops
  // valuing sub-1% closes; setup-selection re-routes via learning.
  // This is the canonical "reward shape, not gate" pattern —
  // shouldExtendBracket does NOT gate the kernel's action.
  const minTrailRoi = 0;
  const minTrailProfitUsdt = 0;
  const meaningfulProfit =
    currentRoiFrac >= minTrailRoi
    && currentPnlUsdt >= minTrailProfitUsdt;
  const long = heldSide === 'long';

  // Ocean-tier SL retracement, per Matrix tier-3 doctrine extension
  // (2026-05-26). When oceanTrailRetracementPct is provided, it
  // overrides the legacy freshSlDistance (ATR-derived). The new
  // distance is `mark × pct` — i.e. the SL sits `pct` below mark
  // (long) or above mark (short). Same tier value drives both the
  // trail retracement window AND the SL distance (linked first-ship
  // per Matrix's recommendation; decoupling is a follow-on if data
  // shows the responsiveness budget needs separating).
  const effectiveSlDistance =
    oceanTrailRetracementPct !== undefined && oceanTrailRetracementPct > 0
      ? markPrice * oceanTrailRetracementPct
      : freshSlDistance;

  // ── TP extension ────────────────────────────────────────────────
  let newTp: number | null = null;
  if (inProfit && conviction >= convThreshold && currentTp !== null) {
    const candidateTp = long
      ? entryPrice + freshTpDistance
      : entryPrice - freshTpDistance;
    // "Further out" = away from entry in the profit direction.
    const further = long ? candidateTp > currentTp : candidateTp < currentTp;
    if (further) newTp = candidateTp;
  }

  // ── SL trail ────────────────────────────────────────────────────
  // Trail the stop `effectiveSlDistance` behind the mark, ratcheting
  // only in the favourable direction. Distance source: Ocean-tier
  // retracement when supplied, else legacy ATR-derived freshSlDistance.
  let newSl: number | null = null;
  if (inProfit && meaningfulProfit && currentSl !== null) {
    const candidateSl = long
      ? markPrice - effectiveSlDistance
      : markPrice + effectiveSlDistance;
    const better = long ? candidateSl > currentSl : candidateSl < currentSl;
    if (better) newSl = candidateSl;
  }

  const changed = newTp !== null || newSl !== null;
  const trailSource =
    oceanTrailRetracementPct !== undefined && oceanTrailRetracementPct > 0
      ? `ocean ${(oceanTrailRetracementPct * 100).toFixed(0)}%`
      : 'ATR';
  return {
    changed,
    newTp,
    newSl,
    reason: changed
      ? `extend_bracket: ${newTp !== null ? `TP->${newTp.toFixed(2)} ` : ''}`
        + `${newSl !== null ? `SL->${newSl.toFixed(2)} ` : ''}`
        + `(conv=${conviction.toFixed(2)}, roi=${(currentRoiFrac * 100).toFixed(2)}%, trail=${trailSource})`
      : `bracket_hold: no favourable revision (conv=${conviction.toFixed(2)}, `
        + `inProfit=${inProfit}, meaningfulProfit=${meaningfulProfit}, trail=${trailSource})`,
  };
}
