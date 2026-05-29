/**
 * hindsightRegret.ts — counterfactual-regret reward signal.
 *
 * Operator intent (2026-05-29, verbatim): "rather than a knob, it needs to
 * feel the pain of this. not so much that its scared to make a trade but
 * enough that it thinks about thinking about the trend a second time before
 * closing." + "something akin to hindsight. e.g. 'if i just left it i would
 * have got the reward'."
 *
 * CONCEPT (counterfactual regret minimisation):
 *   When the kernel closes a position, we keep watching the symbol for a
 *   forward window. We track what the *closed* position WOULD have earned
 *   had it been held. If holding would have beaten the realised close
 *   (the trend continued in the position's favour) we emit an AVERSIVE
 *   "closed too early" chemistry signal scaled by the foregone gain. If
 *   closing was correct (price moved against the old position, holding
 *   would have lost more) we emit NO regret — optionally a mild positive
 *   "good close" reinforcement.
 *
 *   The ASYMMETRY is load-bearing: regret fires ONLY when holding would
 *   have won. That is what stops the signal from making the kernel scared
 *   to ever close — there is no penalty for a correct exit, only for an
 *   exit that left money on the table in a continuing favourable trend.
 *
 * DOCTRINAL ANCHORS:
 *   - P1 (Observer sets all params from frozen facts): the regret MAGNITUDE
 *     is normalised against the kernel's own realised pnl_frac distribution
 *     (MAD), exactly like observerFibCoefficient / pushReward. There is no
 *     hardcoded "how much a foregone gain should sting" knob. The transform
 *     shape (tanh) and the output cap are STRUCTURAL design constants,
 *     mirroring the trade-outcome reward channel.
 *   - P14 (Variable Separation): hindsight regret is its OWN chemistry
 *     channel. It is NOT folded into the realised-pnl reward — a position
 *     that closed at a tiny realised win can still produce a large regret
 *     signal if the trend ran on without it. The realised reward already
 *     fired at close; regret is computed later, from the counterfactual.
 *   - P15 (Fail-Closed Safety): all inputs are validated; non-finite inputs
 *     produce zero deltas. Never blocks trading.
 *
 * This module is PURE (no I/O, no time, no DB). The orchestration that
 * registers a watch at close, advances it with live price each tick, and
 * pushes the resulting deltas lives in loop.ts behind
 * MONKEY_HINDSIGHT_REGRET_LIVE (default OFF).
 */

/** A position that was closed and is now being watched for counterfactual pnl. */
export interface HindsightWatch {
  symbol: string;
  /** +1 for a closed long, -1 for a closed short. */
  sideSign: 1 | -1;
  /** Base-asset quantity that was closed (magnitude, > 0). */
  qty: number;
  /** Price at which the position was closed (exit price). */
  exitPrice: number;
  /** Realised net pnl (USDT) the close actually booked (Polo-authoritative). */
  realizedPnlUsdt: number;
  /** Margin (USDT) backing the closed position — for pnl_frac normalisation. */
  marginUsdt: number;
  /** ms epoch the close happened. */
  closedAtMs: number;
  /** ms epoch this watch should stop being evaluated and be retired. */
  expiresAtMs: number;
  /**
   * Best (most favourable) counterfactual pnl seen so far over the window.
   * For a closed long this is the pnl at the HIGHEST price seen since close;
   * for a closed short, at the LOWEST. Seeded to realizedPnlUsdt so a window
   * that only ever moves adversely yields zero foregone gain (no regret).
   */
  bestCounterfactualPnlUsdt: number;
}

/** Output of the regret transform — a chemistry delta plus telemetry. */
export interface HindsightRegretDeltas {
  /**
   * Aversive dopamine delta (<= 0) when holding would have won; a small
   * positive "good close" reinforcement (>= 0) when closing was correct;
   * 0 when neither (e.g. break-even or insufficient data).
   */
  dopamineDelta: number;
  /** Foregone gain (USDT): max(0, bestCounterfactual - realized). */
  foregoneGainUsdt: number;
  /** The pnl_frac that the regret transform actually consumed (normalised). */
  regretFrac: number;
  source: string;
}

// ── Structural constants (NOT operator knobs) ───────────────────────────
//
// REGRET_DOP_CAP mirrors the trade-outcome dopamine cap (0.5 in pushReward).
// Regret is the same CLASS of signal as a realised loss ("the kernel was
// wrong about when to exit"), so the foregone gain must be able to sting
// comparably to a real loss. But it is BOUNDED so a huge foregone gain
// cannot produce unbounded aversion — the kernel must still be willing to
// close when it should. tanh saturates the magnitude into [0, CAP).
export const REGRET_DOP_CAP = 0.5;

// GOOD_CLOSE_DOP small positive reinforcement when the close avoided a worse
// outcome (counterfactual <= realized). Kept much smaller than the regret
// cap so the asymmetry favours "don't punish closing" without actively
// teaching the kernel to close eagerly. Mirrors the loss-side mood-dip cap
// (0.1) magnitude in pushReward, applied here as a *reward* for good timing.
export const GOOD_CLOSE_DOP = 0.05;

const EPS = 1e-12;

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Counterfactual pnl (USDT) of holding the CLOSED position to `price`.
 *
 *   long  : (price - exitPrice) * qty   — gains if price rises after exit
 *   short : (exitPrice - price) * qty   — gains if price falls after exit
 *
 * This is the pnl the position would have ADDED beyond the exit, i.e. the
 * marginal pnl of NOT closing. Added to the realised pnl it gives the total
 * "if I'd just left it" pnl.
 *
 * Returns null on any non-finite / invalid input (fail-closed).
 */
export function counterfactualPnlUsdt(
  watch: Pick<HindsightWatch, 'sideSign' | 'qty' | 'exitPrice' | 'realizedPnlUsdt'>,
  price: number,
): number | null {
  if (!isFiniteNumber(price) || price <= 0) return null;
  if (!isFiniteNumber(watch.qty) || watch.qty <= 0) return null;
  if (!isFiniteNumber(watch.exitPrice) || watch.exitPrice <= 0) return null;
  if (!isFiniteNumber(watch.realizedPnlUsdt)) return null;
  if (watch.sideSign !== 1 && watch.sideSign !== -1) return null;
  // Marginal pnl of holding past the exit, then add what was already booked.
  const marginal = (price - watch.exitPrice) * watch.sideSign * watch.qty;
  return watch.realizedPnlUsdt + marginal;
}

/**
 * Advance a watch with a fresh observed price: update the running "best
 * counterfactual pnl" (most favourable to having held). Pure — returns a
 * new watch object, does not mutate the input.
 *
 * On invalid price the watch is returned unchanged (best-effort).
 */
export function advanceWatch(watch: HindsightWatch, price: number): HindsightWatch {
  const cf = counterfactualPnlUsdt(watch, price);
  if (cf === null) return watch;
  if (cf > watch.bestCounterfactualPnlUsdt) {
    return { ...watch, bestCounterfactualPnlUsdt: cf };
  }
  return watch;
}

/**
 * Median absolute deviation around the median. Robust to outliers — the
 * same statistic pushReward uses to normalise pnl_frac.
 */
export function medianAbsoluteDeviation(xs: number[]): number {
  const finite = xs.filter(isFiniteNumber);
  if (finite.length === 0) return 0;
  const sorted = [...finite].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
    : sorted[Math.floor(sorted.length / 2)]!;
  const devs = sorted.map((x) => Math.abs(x - median)).sort((a, b) => a - b);
  return devs.length % 2 === 0
    ? (devs[devs.length / 2 - 1]! + devs[devs.length / 2]!) / 2
    : devs[Math.floor(devs.length / 2)]!;
}

/**
 * Pure regret transform: resolve a (expired) watch into a chemistry delta.
 *
 * @param watch        the watch being resolved (with its accumulated best
 *                     counterfactual pnl).
 * @param pnlFracHistory  the kernel's own realised pnl_frac distribution —
 *                     used to derive the normalisation scale (MAD), exactly
 *                     like pushReward / observerFibCoefficient. Observer-set,
 *                     no hardcoded magnitude.
 *
 * Semantics:
 *   - foregoneGain = max(0, bestCounterfactual - realized).
 *     If holding would NOT have beaten the close (price moved against the
 *     old position) foregoneGain == 0 → no regret. Optionally a small
 *     positive "good close" reinforcement when the close strictly avoided a
 *     worse outcome.
 *   - regretFrac = foregoneGain / margin (the foregone gain as a fraction of
 *     the capital that was at risk), then normalised by the MAD of the
 *     kernel's realised pnl_frac history so the sting is measured in the
 *     same units the kernel feels its real wins/losses.
 *   - dopamineDelta = -tanh(regretFracNormalized) * REGRET_DOP_CAP  (<= 0).
 *
 * Fail-closed: invalid margin / non-finite values → zero delta.
 */
export function resolveRegret(
  watch: Pick<
    HindsightWatch,
    'bestCounterfactualPnlUsdt' | 'realizedPnlUsdt' | 'marginUsdt'
  >,
  pnlFracHistory: number[],
): HindsightRegretDeltas {
  const { bestCounterfactualPnlUsdt: best, realizedPnlUsdt: realized, marginUsdt } = watch;

  if (!isFiniteNumber(best) || !isFiniteNumber(realized)) {
    return { dopamineDelta: 0, foregoneGainUsdt: 0, regretFrac: 0, source: 'hindsight_invalid' };
  }
  if (!isFiniteNumber(marginUsdt) || marginUsdt <= 0) {
    return { dopamineDelta: 0, foregoneGainUsdt: 0, regretFrac: 0, source: 'hindsight_no_margin' };
  }

  const foregoneGainUsdt = best - realized;

  // ── Good-close branch: holding would NOT have beaten the close ────────
  // (foregoneGain <= 0). The exit avoided a worse outcome. No regret; mild
  // positive reinforcement so correct exits are gently encouraged without
  // teaching eager closing.
  if (foregoneGainUsdt <= EPS) {
    return {
      dopamineDelta: GOOD_CLOSE_DOP,
      foregoneGainUsdt: 0,
      regretFrac: 0,
      source: 'hindsight_good_close',
    };
  }

  // ── Regret branch: holding would have won. Aversive, bounded. ─────────
  const regretFrac = foregoneGainUsdt / marginUsdt;

  // Observer-derived normalisation: scale the regret fraction by the MAD of
  // the kernel's own realised pnl_frac history, mirroring pushReward's
  // pnlFracNormalized. With < MIN_SAMPLES or zero MAD we fall back to the
  // raw fraction (still bounded by tanh + cap). This keeps the sting in the
  // same magnitude band as the kernel's real wins/losses.
  const MIN_SAMPLES = 5;
  let regretFracNormalized = regretFrac;
  if (pnlFracHistory.length >= MIN_SAMPLES) {
    const mad = medianAbsoluteDeviation(pnlFracHistory);
    if (mad > EPS) regretFracNormalized = regretFrac / mad;
  }

  const dopamineDelta = -Math.tanh(regretFracNormalized) * REGRET_DOP_CAP;

  return {
    dopamineDelta,
    foregoneGainUsdt,
    regretFrac,
    source: 'hindsight_regret',
  };
}

/** Feature-flag helper. Default OFF — behaviour byte-identical when unset. */
export function isHindsightRegretLive(): boolean {
  return process.env.MONKEY_HINDSIGHT_REGRET_LIVE === 'true';
}
