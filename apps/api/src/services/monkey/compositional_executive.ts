/**
 * compositional_executive.ts — REGIME-1 main PR (compositional cell matrix).
 *
 * Phase axis (CREATOR / PRESERVER / DISSOLVER) from Layer-1 CAL-3 (qig_warp).
 * Direction axis (TREND_UP / CHOP / TREND_DOWN) from Layer-2 TrajectoryObserver.
 *
 * Replaces the monolithic mode-detection logic with a 3×3 cell lookup. Every
 * cell has a coherent (laneBias, sizeMultiplier, harvestTightness) tuple
 * encoding the intent of "what should the executive do in this joint state."
 *
 * Per docs/regime-classification-hierarchy.md §"The composition":
 *
 * |             | TREND_UP                              | CHOP                                       | TREND_DOWN                              |
 * | CREATOR     | Aggressive trend-follow, max size     | Trade lightly, expect breakout             | Aggressive trend-follow (short)         |
 * | PRESERVER   | Ride established trend, tight stops   | Mean-revert (consolidating)                | Ride established short, tight stops     |
 * | DISSOLVER   | Don't trade — momentum reverting      | Sit out (max entropy)                      | Don't trade — momentum reverting        |
 *
 * QIG-pure: every multiplier and bias is a discrete-choice mapping from
 * (phase, direction) — no free knob is interpolated. The cells encode
 * the intent; they are not interpolation parameters.
 */

export type RegimePhase = 'CREATOR' | 'PRESERVER' | 'DISSOLVER';
export type TrajectoryDirection = 'TREND_UP' | 'CHOP' | 'TREND_DOWN';
export type CellLaneBias = 'trend' | 'swing' | 'scalp' | 'observe';
export type HarvestTightness = 'loose' | 'normal' | 'tight';

export interface CellAction {
  phase: RegimePhase;
  direction: TrajectoryDirection;
  /** Recommended lane bias. Folded into chooseLane as an additive shift
   *  similar to time-of-day prior. */
  laneBias: CellLaneBias;
  /** Multiplier on capped equity. 0 = suppress all new entries this tick;
   *  1.0 = normal sizing; > 1.0 = scaled-up sizing (capped at 1.0 — the
   *  "max size" cell does not request more than the existing budget). */
  sizeMultiplier: number;
  /** Tightness of the exit harvest envelope. 'loose' lets winners run;
   *  'tight' captures on touch; 'normal' is the default behaviour. */
  harvestTightness: HarvestTightness;
  /** Short human-readable cell label for logs/telemetry. */
  label: string;
}

/**
 * Look up the cell action for a (phase, direction) joint state.
 *
 * Pure function — no rolling state, no thresholds. Same inputs always
 * yield the same output.
 */
export function evaluateCell(
  phase: RegimePhase,
  direction: TrajectoryDirection,
): CellAction {
  // CREATOR — h-dominated, broken-symmetry → discovery + breakouts
  if (phase === 'CREATOR') {
    if (direction === 'TREND_UP') return {
      phase, direction, laneBias: 'trend', sizeMultiplier: 1.0,
      harvestTightness: 'normal',
      label: 'CREATOR×TREND_UP: aggressive trend-follow',
    };
    if (direction === 'TREND_DOWN') return {
      phase, direction, laneBias: 'trend', sizeMultiplier: 1.0,
      harvestTightness: 'normal',
      label: 'CREATOR×TREND_DOWN: aggressive trend-follow (short)',
    };
    // CHOP within CREATOR — symmetry-breaking imminent, trade lightly.
    // 2026-05-19: sizeMultiplier bumped 0.5 → 0.75 per user report
    // "small positions, low leverage, tiny wins." Doctrine preserved
    // (still "lightly" — full size = 1.0 for trending cells, 0.75 here)
    // but the prior 0.5 compounded with sizeFraction 0.5 to leave bot
    // at 0.25× equity per side — entries were structurally too small
    // to produce meaningful absolute wins. Env-tunable for operator tuning.
    return {
      phase, direction, laneBias: 'scalp',
      sizeMultiplier: Number(process.env.REGIME_CREATOR_CHOP_SIZE_MULT) || 0.75,
      harvestTightness: 'tight',
      label: 'CREATOR×CHOP: trade lightly, expect breakout',
    };
  }

  // PRESERVER — J-dominated, ordered → continuation favoured
  if (phase === 'PRESERVER') {
    if (direction === 'TREND_UP') return {
      phase, direction, laneBias: 'trend', sizeMultiplier: 1.0,
      harvestTightness: 'loose',
      label: 'PRESERVER×TREND_UP: ride established trend',
    };
    if (direction === 'TREND_DOWN') return {
      phase, direction, laneBias: 'trend', sizeMultiplier: 1.0,
      harvestTightness: 'loose',
      label: 'PRESERVER×TREND_DOWN: ride established short',
    };
    // CHOP within PRESERVER — consolidating before continuation, mean-revert.
    // sizeMultiplier env-tunable (default 0.85, bumped from 0.7 in 2026-05-19
    // sizing-knobs pass — preservation cells still get full conviction since
    // continuation is the likely outcome).
    return {
      phase, direction, laneBias: 'swing',
      sizeMultiplier: Number(process.env.REGIME_PRESERVER_CHOP_SIZE_MULT) || 0.85,
      harvestTightness: 'normal',
      label: 'PRESERVER×CHOP: mean-revert (consolidating)',
    };
  }

  // DISSOLVER — disordered, direction unreliable → reduced conviction.
  //
  // 2026-05-26: hard 0.0 multiplier replaced with 0.2 SAFETY_BOUND floor.
  // The 0.0 multiplier was a code-side cap that fully froze the kernel
  // whenever the phase classifier fired DISSOLVER — observationally
  // dominant on ETH/BTC during chop-heavy hours, leading to long
  // periods of zero entries (e.g. ~30+ consecutive ticks on 2026-05-26
  // 12:07-12:14 UTC with cellSizeMul=0 / sizeValue=0 / no trades).
  //
  // The autonomy doctrine (cf. polytrade_autonomy_doctrine,
  // polytrade_code_side_caps_stripped) is that the kernel restrains
  // itself via chemistry feedback, not via hardcoded "don't trade"
  // gates. Catastrophic safety is owned by should_auto_flatten (P15).
  //
  // The 0.2 floor mirrors the existing CHOP suppression filter at
  // loop.ts ~3681 (`Math.max(0.2, 1 - confidence)`) — both encode the
  // same SAFETY_BOUND that the kernel always attempts a defensive-
  // sized position rather than fully sitting out.
  //
  // harvestTightness stays 'tight' — when sizing is reduced, exits
  // are aggressive to protect the smaller position from chop bleed.
  // laneBias stays 'observe' so chooseLane biases toward the smallest
  // lane (scalp) consistent with reduced-conviction sizing.
  const DISSOLVER_FLOOR = 0.2;
  if (direction === 'TREND_UP' || direction === 'TREND_DOWN') {
    return {
      phase, direction, laneBias: 'observe', sizeMultiplier: DISSOLVER_FLOOR,
      harvestTightness: 'tight',
      label: `DISSOLVER×${direction}: reduced conviction — momentum reverting`,
    };
  }
  return {
    phase, direction, laneBias: 'observe', sizeMultiplier: DISSOLVER_FLOOR,
    harvestTightness: 'tight',
    label: 'DISSOLVER×CHOP: reduced conviction (max entropy)',
  };
}

/**
 * Maps a TrajectoryRegime string from regime.ts to the TrajectoryDirection
 * axis label used by the cell matrix. Returns null if the regime is not
 * one of the recognised direction values.
 */
export function regimeToDirection(regime: string): TrajectoryDirection | null {
  if (regime === 'TREND_UP') return 'TREND_UP';
  if (regime === 'TREND_DOWN') return 'TREND_DOWN';
  if (regime === 'CHOP') return 'CHOP';
  return null;
}

/**
 * Maps a canonical phase regime string from CAL-3 / qig_warp to the
 * RegimePhase axis. Returns null if the input is not one of the
 * recognised phase regimes.
 */
export function canonicalToPhase(regime: string | null): RegimePhase | null {
  if (regime === 'creator') return 'CREATOR';
  if (regime === 'preserver') return 'PRESERVER';
  if (regime === 'dissolver') return 'DISSOLVER';
  return null;
}
