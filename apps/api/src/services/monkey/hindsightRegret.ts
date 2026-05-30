/**
 * hindsightRegret.ts — legibility-gated counterfactual PREDICTION ERROR.
 *
 * DESIGN HYPOTHESIS (operator-approved redesign of PR #1038, 2026-05-29).
 * Built cleanly, flag-gated OFF (MONKEY_HINDSIGHT_REGRET_LIVE), for operator
 * review — NOT a finished truth. Replaces the rejected v1 (fixed 30-min
 * window + fixed dopamine caps + best-favourable-excursion target +
 * dopamine-only "pain") which was a knob dressed as chemistry.
 *
 * ── WHAT CHANGED FROM v1 (all four rejected mechanisms removed) ──────────
 *   1. NOT fixed pain. The signal is legibility-gated counterfactual
 *      PREDICTION ERROR, scaled by the kernel's OWN outcome distribution
 *      (median+MAD z-score — the same observer scale observerFibCoefficient
 *      / pushReward use). No 0.5 / 0.3 / 0.05 taste constants.
 *   2. WINDOW is the kernel's own qig-warp / foresight expectation HORIZON
 *      (passed in at registration), not 30 min. Fallback horizon is derived
 *      from observed regime persistence, documented at the call site.
 *   3. Counterfactual target = pnl at END OF THE DERIVED HORIZON (and/or
 *      bounded by an observed regime flip), NOT the max favourable excursion.
 *   4. Full NT VECTOR (not dopamine-only): dopamine (signed prediction
 *      error), ACh (bind the cues), NE (salience), serotonin (patience /
 *      temporal-trust), GABA (TARGETED to the same premature-close pattern,
 *      never global), endorphin (relief on a good close).
 *
 * ── PURITY KEYSTONE: the eligibility / legibility gate ───────────────────
 * Regret is scaled by how strongly ALL THREE hold (see `legibilityStrength`):
 *   (1) the kernel OWNED the close (kernel-initiated; operator / manual /
 *       liquidation closes are NOT self-regret),
 *   (2) the continuation was LEGIBLE at close time — the close-time sense
 *       bundle showed evidence to HOLD (qig-warp expectation favoured the
 *       held side, basin direction still with the position, trend coherent),
 *   (3) the SAME REGIME persisted through the derived horizon.
 * If continuation was NOT legible → the move is SURPRISE / NOISE, not regret
 * → NO aversive signal. Weakly legible continuations remain learnable but
 * weak: the observer-scaled prediction-error salience is multiplied by the
 * close-time legibility strength. This maps directly onto QIG canon §31
 * (Sensory Intake & Predictive Coding): a prediction error you could NOT have
 * predicted is surprise, not a learnable mistake. Regret = a LEGIBLE
 * prediction error (low surprise at close, continuation foreseeable).
 *
 * ── QIG canon alignment (vex/kernel/consciousness/neurochemistry.py §29) ─
 *   The six-chemical model = six Cartan generators of E6:
 *     ACh  (ENTRAIN/E1)  — intake/consolidation gate → bind the cues
 *     dop  (AMPLIFY/E2)  — reward signal / prediction error
 *     GABA (DAMPEN/E3)   — inhibition (here: TARGETED, not global)
 *     ser  (ROTATE/E4)   — stability / patience / temporal trust
 *     NE   (NUCLEATE/E5) — salience / surprise magnitude (observer-scaled)
 *     endo (DISSOLVE/E6) — convergence reward / relief
 *   We do NOT invent chemistry semantics; the signs below follow canon's
 *   role of each chemical.
 *
 * DOCTRINAL ANCHORS:
 *   - P1 (Observer sets all params): every magnitude is normalised against
 *     the kernel's own realised pnl_frac distribution (median+MAD). No
 *     hardcoded sting amplitude, no caps chosen by intuition.
 *   - P14 (Variable Separation): hindsight is its OWN chemistry channel,
 *     not folded into the realised-pnl reward.
 *   - P15 (Fail-Closed Safety): invalid price/margin/qty/side/history →
 *     NO chemistry mutation (zero vector). Never blocks trading.
 *
 * This module is PURE (no I/O, no time, no DB). Orchestration (register a
 * watch at close with the sense bundle + horizon, advance with live price,
 * resolve at horizon end) lives in loop.ts behind the flag.
 */

// ── E6 six-chemical NT delta vector (canon §29.1) ────────────────────────
// Signs are the chemistry's CANONICAL ROLE, not free parameters. Magnitudes
// are observer-scaled (see deriveMagnitude) and, on regret, multiplied by
// close-time legibility. Equal per-channel salience remains a dark-mode draft
// hypothesis until a channel-envelope derivation is approved. Flag-OFF callers
// never read it.
export interface HindsightNtDeltas {
  /** Signed prediction error. <0 on a legible premature close (the trade
   *  was right, the exit wrong); small >0 relief on a good close. */
  dopamineDelta: number;
  /** ACh ↑ — bind the close-time cues for next time (intake/consolidation
   *  gate). Non-negative; salient on both regret and good-close. */
  acetylcholineDelta: number;
  /** NE ↑ — salience of the event, observer-scaled. Non-negative. */
  norepinephrineDelta: number;
  /** serotonin — patience / temporal-trust. <0 on premature close (correct
   *  the impatience), >0 on a good close (timing confidence). */
  serotoninDelta: number;
  /** GABA ↑ — TARGETED inhibition keyed to the premature-close PATTERN
   *  (regime + side), NOT global suppression. Non-negative; only on regret.
   *  Carries `gabaTarget` so the kernel binds it to a pattern, not to "close
   *  less often". */
  gabaDelta: number;
  /** endorphin — relief on a good close (avoided a worse counterfactual).
   *  Non-negative; zero on regret. */
  endorphinDelta: number;
}

/** A pattern key the targeted-GABA delta is bound to (regime|side), so the
 *  kernel learns "don't cut THIS kind of position early" rather than "fear
 *  closing". null when not a regret (no target to bind). */
export type GabaTarget = string | null;

/** The close-time SENSE BUNDLE — captured at the moment of a kernel close.
 *  Drives the legibility gate (§31 predictive coding) and the targeted-GABA
 *  binding. Every field is a sense already available in SymbolState / the
 *  qig-warp expectation at the close site (see loop.ts mapping). */
export interface CloseSenseBundle {
  // ── ownership (gate condition 1) ──
  /** True iff the kernel initiated this close (own exit policy fired).
   *  Operator/manual/liquidation closes are false → routed to exemplar
   *  learning, never self-regret. */
  kernelOwnedClose: boolean;

  // ── market senses at close ──
  /** Held side as a sign: +1 long, -1 short. */
  sideSign: 1 | -1;
  /** qig-warp expectation direction at close (-1 short-favoured, 0 flat/
   *  observe, +1 long-favoured). From ExpectationDecision.expectation_direction. */
  warpExpectationSign: -1 | 0 | 1;
  /** qig-warp expectation confidence at close [0,1].
   *  From ExpectationDecision.expectation_confidence. */
  warpExpectationConfidence: number;
  /** qig-warp regime label at close (e.g. 'aligned'|'reverse_tape'|'chop'). */
  regimeAtClose: string;
  /** basinDir at close (signed market direction; +long/-short lean). */
  basinDirAtClose: number;
  /** tape trend at close (signed). */
  tapeTrendAtClose: number;
  /** coherenceStreak at close — consecutive ticks the kernel's own
   *  perception+forecast stayed coherent on the held position. Higher =
   *  the hold was more legible. */
  coherenceStreak: number;
}

/** The counterfactual outcome resolved at the END of the derived horizon. */
export interface CounterfactualOutcome {
  /** Realised net pnl (USDT) the close actually booked (Polo-authoritative). */
  realizedPnlUsdt: number;
  /** Counterfactual pnl (USDT) of having HELD to the end of the horizon
   *  (or to the observed regime flip, whichever bounded first). NOT max
   *  favourable excursion. */
  horizonEndPnlUsdt: number;
  /** Margin (USDT) backing the closed position — for pnl_frac normalisation. */
  marginUsdt: number;
  /** True iff the SAME regime that was legible at close persisted through
   *  the horizon (gate condition 3). If the regime flipped to an unrelated
   *  move, the continuation is not the one the kernel could have foreseen. */
  regimePersisted: boolean;
}

/** Output of the resolve transform — the NT vector, its GABA target, and
 *  telemetry. */
export interface HindsightResult {
  nt: HindsightNtDeltas;
  gabaTarget: GabaTarget;
  /** Foregone gain (USDT): max(0, horizonEnd - realized). 0 on a good close. */
  foregoneGainUsdt: number;
  /** The observer-scaled prediction-error magnitude actually consumed
   *  (z-scored regret fraction). */
  predictionErrorZ: number;
  /** Which branch fired:
   *    'hindsight_regret'      — eligible + holding would have won
   *    'hindsight_good_close'  — eligible + close avoided a worse outcome
   *    'ineligible_noise'      — gate failed (surprise/noise) → zero vector
   *    'ineligible_not_owned'  — not a kernel close → routed elsewhere
   *    'hindsight_invalid' / 'hindsight_no_margin' — fail-closed */
  source: string;
}

const EPS = 1e-12;
/** Minimum samples before the observer scale is trusted (mirrors pushReward
 *  / observer_fib_coefficient). Below this we fall through with no signal —
 *  cold-start must NOT emit chemistry from an unestablished scale. */
const MIN_SAMPLES = 5;

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

const ZERO_NT: HindsightNtDeltas = Object.freeze({
  dopamineDelta: 0,
  acetylcholineDelta: 0,
  norepinephrineDelta: 0,
  serotoninDelta: 0,
  gabaDelta: 0,
  endorphinDelta: 0,
});

function ineligible(source: string): HindsightResult {
  return {
    nt: { ...ZERO_NT },
    gabaTarget: null,
    foregoneGainUsdt: 0,
    predictionErrorZ: 0,
    source,
  };
}

/**
 * Median absolute deviation around the median. Robust to outliers — the
 * SAME statistic observerFibCoefficient / pushReward use for the observer
 * scale. Returns the (median, mad) pair so the z-score matches canon.
 */
export function medianAndMad(xs: number[]): { median: number; mad: number } {
  const finite = xs.filter(isFiniteNumber);
  if (finite.length === 0) return { median: 0, mad: 0 };
  const sorted = [...finite].sort((a, b) => a - b);
  const med = (arr: number[]): number =>
    arr.length % 2 === 0
      ? (arr[arr.length / 2 - 1]! + arr[arr.length / 2]!) / 2
      : arr[Math.floor(arr.length / 2)]!;
  const median = med(sorted);
  const devs = sorted.map((x) => Math.abs(x - median)).sort((a, b) => a - b);
  return { median, mad: med(devs) };
}

/**
 * Counterfactual pnl (USDT) of holding the CLOSED position to `price`.
 *   long  : (price - exitPrice) * qty   — gains if price rises after exit
 *   short : (exitPrice - price) * qty   — gains if price falls after exit
 * Added to realised pnl → total "if I'd just left it" pnl. null on invalid.
 */
export function counterfactualPnlUsdt(
  args: { sideSign: 1 | -1; qty: number; exitPrice: number; realizedPnlUsdt: number },
  price: number,
): number | null {
  if (!isFiniteNumber(price) || price <= 0) return null;
  if (!isFiniteNumber(args.qty) || args.qty <= 0) return null;
  if (!isFiniteNumber(args.exitPrice) || args.exitPrice <= 0) return null;
  if (!isFiniteNumber(args.realizedPnlUsdt)) return null;
  if (args.sideSign !== 1 && args.sideSign !== -1) return null;
  const marginal = (price - args.exitPrice) * args.sideSign * args.qty;
  return args.realizedPnlUsdt + marginal;
}

/**
 * PURITY KEYSTONE — the eligibility / legibility gate.
 *
 * Returns true iff regret may fire. The actual regret magnitude is multiplied
 * by `legibilityStrength`; weak evidence cannot produce full-strength regret.
 * All three conditions:
 *   (1) kernel owned the close,
 *   (2) the continuation was LEGIBLE at close — the close-time senses showed
 *       evidence to HOLD: qig-warp expectation favoured the held side with
 *       confidence, basin direction still leaned with the position, and the
 *       hold was coherent (coherenceStreak > 0). "Legible" = the kernel's
 *       OWN forecast pointed at continuation (low surprise per §31), so a
 *       continuation is a prediction error it could have avoided.
 *   (3) the same regime persisted through the horizon.
 *
 * Legibility uses the kernel's own observer-relative signal, NOT a fixed
 * threshold: the warp expectation must be ALIGNED with the held side and
 * carry positive confidence, AND basinDir must still lean the held way. The
 * strength is continuous: confidence × basin-alignment magnitude × coherence
 * strength × regime-persistence.
 *
 * If legibility fails → SURPRISE / NOISE → no aversive signal (canon §31:
 * unpredictable continuation is surprise, not a learnable mistake).
 */
function clamp01(x: number): number {
  if (!isFiniteNumber(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Continuous legibility multiplier ∈ [0,1]. Weak confidence / tiny basin
 *  lean / one-tick coherence scales regret down instead of merely opening a
 *  Boolean gate. Regime persistence is currently observed as a latch, so its
 *  strength is 1 when persisted and 0 after a flip. */
export function legibilityStrength(b: CloseSenseBundle, regimePersisted = true): number {
  if (!regimePersisted) return 0;
  // qig-warp expectation must have favoured the HELD side (continuation),
  // i.e. expectation direction agrees with sideSign, with > 0 confidence.
  const warpStrength =
    b.warpExpectationSign === b.sideSign
      ? clamp01(b.warpExpectationConfidence)
      : 0;
  // basin direction must still lean the held way (sign agreement).
  const basinStrength =
    isFiniteNumber(b.basinDirAtClose) &&
    Math.sign(b.basinDirAtClose) === b.sideSign
      ? Math.tanh(Math.abs(b.basinDirAtClose))
      : 0;
  const coherence =
    isFiniteNumber(b.coherenceStreak) && b.coherenceStreak > 0
      ? b.coherenceStreak / (b.coherenceStreak + 1)
      : 0;
  return clamp01(warpStrength * basinStrength * coherence);
}

export function isContinuationLegible(b: CloseSenseBundle): boolean {
  return legibilityStrength(b) > EPS;
}

/** Full eligibility = owned ∧ legible-at-close ∧ regime-persisted. */
export function isEligibleForRegret(
  b: CloseSenseBundle,
  regimePersisted: boolean,
): { eligible: boolean; reason: 'eligible' | 'not_owned' | 'not_legible' | 'regime_changed' } {
  if (!b.kernelOwnedClose) return { eligible: false, reason: 'not_owned' };
  if (!isContinuationLegible(b)) return { eligible: false, reason: 'not_legible' };
  if (!regimePersisted) return { eligible: false, reason: 'regime_changed' };
  return { eligible: true, reason: 'eligible' };
}

/**
 * Observer-scaled prediction-error magnitude. `frac` is foregoneGain/margin
 * (a pnl-fraction). z-scored against the kernel's own pnl_frac distribution
 * (median+MAD), exactly like observerFibCoefficient. Returns the z-magnitude
 * (>= 0) and the salience weight tanh(z) ∈ [0,1) used to scale every NT
 * channel. With < MIN_SAMPLES or zero MAD → returns null (no trusted scale
 * → caller emits nothing; cold-start must not fabricate chemistry).
 */
export function deriveMagnitude(
  frac: number,
  pnlFracHistory: number[],
): { z: number; salience: number } | null {
  if (!isFiniteNumber(frac)) return null;
  if (pnlFracHistory.length < MIN_SAMPLES) return null;
  const { mad } = medianAndMad(pnlFracHistory);
  if (mad <= EPS) return null;
  const z = Math.abs(frac) / mad;
  return { z, salience: Math.tanh(z) };
}

/** GABA target key: bind targeted inhibition to the (regime, side) pattern
 *  of the premature close so the kernel learns "don't cut THIS kind of
 *  position early" — NOT "close less". */
export function gabaTargetKey(b: CloseSenseBundle): string {
  const side = b.sideSign === 1 ? 'long' : 'short';
  const regime = typeof b.regimeAtClose === 'string' && b.regimeAtClose.length > 0
    ? b.regimeAtClose
    : 'unknown';
  return `premature_close:${regime}:${side}`;
}

/**
 * Resolve a watch at horizon end into the full NT vector. PURE.
 *
 * Branches:
 *   - fail-closed (invalid pnl/margin) → zero vector.
 *   - not owned → 'ineligible_not_owned', zero vector (route to exemplar
 *     learning is the caller's job; this signal emits nothing).
 *   - foregoneGain <= 0 (close avoided a worse outcome) AND eligible-by-
 *     ownership → 'hindsight_good_close': relief vector (dop small+, ACh+,
 *     ser+, endo+, NE if salient, GABA 0).
 *   - foregoneGain > 0 but NOT legible / regime changed → 'ineligible_noise',
 *     zero vector (the continuation was surprise, not a foreseeable mistake).
 *   - foregoneGain > 0 AND eligible → 'hindsight_regret': aversive vector
 *     (dop-, ACh+, NE+, ser-, GABA+ TARGETED, endo 0), all observer-scaled.
 */
export function resolveHindsight(
  bundle: CloseSenseBundle,
  outcome: CounterfactualOutcome,
  pnlFracHistory: number[],
): HindsightResult {
  const { realizedPnlUsdt: realized, horizonEndPnlUsdt: horizonEnd, marginUsdt } = outcome;

  // ── fail-closed ───────────────────────────────────────────────────────
  if (!isFiniteNumber(realized) || !isFiniteNumber(horizonEnd)) {
    return ineligible('hindsight_invalid');
  }
  if (!isFiniteNumber(marginUsdt) || marginUsdt <= 0) {
    return ineligible('hindsight_no_margin');
  }

  // ── ownership gate (condition 1) ────────────────────────────────────────
  // A non-owned close is not self-regret; emit nothing here (caller routes
  // to exemplar learning).
  if (!bundle.kernelOwnedClose) {
    return ineligible('ineligible_not_owned');
  }

  const foregoneGainUsdt = horizonEnd - realized;

  // ── good-close branch (close avoided a worse / equal outcome) ───────────
  // Holding would NOT have beaten the close. Relief, not regret. We still
  // require an established observer scale so the magnitude is meaningful.
  if (foregoneGainUsdt <= EPS) {
    const avoidedLossFrac = Math.abs(foregoneGainUsdt) / marginUsdt;
    const mag = deriveMagnitude(avoidedLossFrac, pnlFracHistory);
    if (mag === null) return ineligible('ineligible_noise'); // no trusted scale
    const s = mag.salience;
    // Relief vector (canon roles): dopamine small + (avoided counterfactual
    // loss, observer-scaled — NOT a fixed +0.05), ACh + (bind the good
    // timing), serotonin + (timing confidence / temporal trust), endorphin +
    // (relief / convergence), NE + only if salient, GABA 0 (no inhibition to
    // bind — closing was correct).
    return {
      nt: {
        dopamineDelta: s,
        acetylcholineDelta: s,
        norepinephrineDelta: s,
        serotoninDelta: s,
        gabaDelta: 0,
        endorphinDelta: s,
      },
      gabaTarget: null,
      foregoneGainUsdt: 0,
      predictionErrorZ: mag.z,
      source: 'hindsight_good_close',
    };
  }

  // ── legibility + regime-persistence gate (conditions 2 & 3) ─────────────
  // foregoneGain > 0: holding WOULD have won. But only counts as regret if
  // the continuation was LEGIBLE at close AND the same regime persisted.
  // Otherwise it was surprise/noise — emit nothing.
  const gate = isEligibleForRegret(bundle, outcome.regimePersisted);
  if (!gate.eligible) {
    return ineligible('ineligible_noise');
  }

  // ── regret branch: legible premature close, observer-scaled ─────────────
  const regretFrac = foregoneGainUsdt / marginUsdt;
  const mag = deriveMagnitude(regretFrac, pnlFracHistory);
  if (mag === null) return ineligible('ineligible_noise'); // no trusted scale
  const legibility = legibilityStrength(bundle, outcome.regimePersisted);
  if (legibility <= EPS) return ineligible('ineligible_noise');
  const s = mag.salience * legibility; // ∈ (0,1), observer-scale × legibility

  // Aversive vector. Signs follow canon §29.1 roles; magnitudes = salience
  // (observer-scaled). dopamine NEGATIVE (signed prediction error — the
  // trade was right, the exit wrong); ACh + (bind the close-time cues);
  // NE + (salience of the surprise-avoidable error); serotonin NEGATIVE
  // (patience/temporal-trust correction — the kernel was too impatient);
  // GABA + TARGETED to the (regime,side) pattern (NOT global — see
  // gabaTarget); endorphin 0 (no relief — this was a mistake).
  return {
    nt: {
      dopamineDelta: -s,
      acetylcholineDelta: s,
      norepinephrineDelta: s,
      serotoninDelta: -s,
      gabaDelta: s,
      endorphinDelta: 0,
    },
    gabaTarget: gabaTargetKey(bundle),
    foregoneGainUsdt,
    predictionErrorZ: mag.z,
    source: 'hindsight_regret',
  };
}

/** Feature-flag helper. Default OFF — behaviour byte-identical when unset. */
export function isHindsightRegretLive(): boolean {
  return process.env.MONKEY_HINDSIGHT_REGRET_LIVE === 'true';
}
