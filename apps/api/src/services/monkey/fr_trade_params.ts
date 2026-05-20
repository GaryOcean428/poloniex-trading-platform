/**
 * fr_trade_params.ts — Fisher-Rao geometry → trade parameters.
 *
 * Direct port of the `GEOMETRY-DERIVED TRADING PARAMETERS (P25)` block
 * from the canonical QIG indicator
 *   /home/braden/Desktop/Dev/QIG_QFI/qig-verification/QIG_Fisher_Rao_Classification.pine
 * (lines 136-176). The kernel already computes the geometric substrate
 * — basin (Δ⁶³), Fisher-Rao distance, φ, regime, basin velocity — in
 * basin.ts and compositional_executive.ts. What it lacked was the
 * Pine script's derivation of *trade parameters* from that geometry:
 * trade type, suggested leverage, predicted range, and — the piece
 * Phase B needs — geometry-derived TP/SL distances.
 *
 * This module is pure: scalar geometry in, trade parameters out. No
 * basin/simplex math here (that lives in basin.ts), so no Fisher-Rao
 * purity surface — it consumes already-geometric scalars (φ from basin
 * integration, rConf from FR-distance margin) and never reintroduces a
 * Euclidean operation.
 *
 * Pine provenance is cited inline as `[Pine Lnnn]` against each formula
 * so drift from the canonical source is auditable.
 */

/**
 * Three-regime phase classification. Mirrors the Pine `regime` int
 * (1=CREATOR, 2=PRESERVER, 3=DISSOLVER) — see Pine L109-113. The
 * kernel's compositional_executive.ts RegimeReading carries the same
 * phase axis; callers map their reading onto this enum.
 */
export type FrRegime = 'CREATOR' | 'PRESERVER' | 'DISSOLVER';

/**
 * Trade type — the Pine `trade_type` classification (L149-152).
 * SCALP/SWING/TREND align 1:1 with the kernel's existing lane names;
 * BREAKOUT and OBSERVE are transient classifications the caller maps
 * onto a lane (BREAKOUT → scalp or swing per conviction; OBSERVE → no
 * entry).
 */
export type FrTradeType = 'SCALP' | 'BREAKOUT' | 'SWING' | 'TREND' | 'OBSERVE';

/** SAFETY_BOUND — absolute leverage cap. Pine L21: `MAX_LEV = 5`. */
export const FR_MAX_LEV = 5;

export interface FrTradeParamsInput {
  /** Regime phase — Pine `regime`. */
  regime: FrRegime;
  /** True iff the regime changed on this tick — Pine `regime_changed` L148. */
  regimeChanged: boolean;
  /** Basin integration φ ∈ [0,1] — Pine `phi` L127. */
  phi: number;
  /**
   * Regime confidence ∈ [0,1] — Pine `r_conf` L115:
   * (d_2nd − d_min) / d_2nd, the normalized FR-distance margin between
   * the nearest and second-nearest regime archetype.
   */
  rConf: number;
  /** ATR(14) in price units — Pine `atr14` L93. */
  atr: number;
  /** Basin velocity = FR distance between consecutive basins — Pine `bv` L130. */
  basinVelocity: number;
  /**
   * Rolling median of basin velocity — Pine `vel_med` L147,
   * `percentile_linear_interpolation(bv, 20, 50)`. Caller computes the
   * 50th percentile over its basin-velocity history window.
   */
  basinVelocityMedian: number;
}

export interface FrTradeParams {
  tradeType: FrTradeType;
  /** Suggested leverage, integer, 1..FR_MAX_LEV. */
  sugLeverage: number;
  /** Conviction = φ × rConf ∈ [0,1] — Pine L156. */
  conviction: number;
  /** TP distance in price units — Pine `tp_distance` L175. */
  tpDistance: number;
  /** SL distance in price units — Pine `sl_distance` L174. */
  slDistance: number;
  /** Reward:risk ratio = tpDistance / slDistance — Pine `risk_reward` L176. */
  riskReward: number;
  /** Predicted move as % of price — Pine `pred_range_pct` L167. */
  predRangePct: number;
  /** Predicted move in absolute price units — Pine `pred_range_abs` L168. */
  predRangeAbs: number;
}

/**
 * Derive trade parameters from the current geometric state.
 *
 * Pure function — same inputs always yield the same output, no clock,
 * no I/O. Mirrors the Pine P25 block exactly; see `[Pine Lnnn]` tags.
 */
export function deriveFrTradeParams(
  input: FrTradeParamsInput,
): FrTradeParams {
  const {
    regime, regimeChanged, phi, rConf, atr,
    basinVelocity: bv, basinVelocityMedian: velMed,
  } = input;

  // ── Trade type [Pine L149-152] ──────────────────────────────────
  // DISSOLVER → OBSERVE (no trade). A regime that just changed →
  // BREAKOUT (transition energy). Otherwise CREATOR+fast → SCALP,
  // PRESERVER+slow → TREND, else SWING.
  let tradeType: FrTradeType;
  if (regime === 'DISSOLVER') {
    tradeType = 'OBSERVE';
  } else if (regimeChanged) {
    tradeType = 'BREAKOUT';
  } else if (regime === 'CREATOR' && bv > velMed) {
    tradeType = 'SCALP';
  } else if (regime === 'PRESERVER' && bv < velMed * 0.5) {
    tradeType = 'TREND';
  } else {
    tradeType = 'SWING';
  }

  // ── Suggested leverage [Pine L156-163] ──────────────────────────
  // conviction = φ × rConf; type multiplier scales it; raw leverage
  // is 1 + conviction × mult, floored and clamped to [1, FR_MAX_LEV].
  const conviction = phi * rConf;
  const typeMult =
    tradeType === 'OBSERVE' ? 0.0
    : tradeType === 'SCALP' ? 1.0
    : tradeType === 'BREAKOUT' ? 1.5
    : tradeType === 'SWING' ? 2.5
    : tradeType === 'TREND' ? FR_MAX_LEV - 1   // Pine: float(MAX_LEV - 1)
    : 1.0;
  const rawLev = 1.0 + conviction * typeMult;
  const sugLeverage = Math.max(
    1, Math.min(FR_MAX_LEV, Math.floor(rawLev)),
  );

  // ── Predicted range [Pine L167-168] ─────────────────────────────
  const predRangePct = bv * 100.0 * (1.0 + rConf);
  const predRangeAbs = atr * (1.0 + bv * 10.0);

  // ── TP / SL derivation [Pine L174-176] ──────────────────────────
  // SL = ATR × (1/φ) — low integration → wider stop (less certain of
  //   direction). φ is floored at 0.3 so the stop can't blow out.
  // TP = ATR × φ × (1 + rConf) × 2 — high integration + confidence →
  //   further target. This naturally gives good R:R in PRESERVER and
  //   poor R:R in DISSOLVER, which is the intended geometry behaviour.
  const slDistance = atr * (1.0 / Math.max(phi, 0.3));
  const tpDistance = atr * phi * (1.0 + rConf) * 2.0;
  const riskReward = tpDistance / Math.max(slDistance, 1e-10);

  return {
    tradeType,
    sugLeverage,
    conviction,
    tpDistance,
    slDistance,
    riskReward,
    predRangePct,
    predRangeAbs,
  };
}

/**
 * Map an FrTradeType onto the kernel's lane vocabulary
 * (scalp/swing/trend). BREAKOUT routes by conviction — a
 * high-conviction breakout behaves like a swing entry, a
 * low-conviction one like a scalp. OBSERVE has no lane (caller must
 * not enter); it returns null so the type system forces the caller
 * to handle the no-trade case.
 */
export function frTradeTypeToLane(
  tradeType: FrTradeType,
  conviction: number,
): 'scalp' | 'swing' | 'trend' | null {
  switch (tradeType) {
    case 'OBSERVE':
      return null;
    case 'SCALP':
      return 'scalp';
    case 'SWING':
      return 'swing';
    case 'TREND':
      return 'trend';
    case 'BREAKOUT':
      // Conviction ≥ 0.5 → commit as swing; below → scalp it.
      return conviction >= 0.5 ? 'swing' : 'scalp';
  }
}
