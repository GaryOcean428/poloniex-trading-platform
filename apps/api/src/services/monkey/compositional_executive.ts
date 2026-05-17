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
    // CHOP within CREATOR — symmetry-breaking imminent, trade lightly
    return {
      phase, direction, laneBias: 'scalp', sizeMultiplier: 0.5,
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
    // CHOP within PRESERVER — consolidating before continuation, mean-revert
    return {
      phase, direction, laneBias: 'swing', sizeMultiplier: 0.7,
      harvestTightness: 'normal',
      label: 'PRESERVER×CHOP: mean-revert (consolidating)',
    };
  }

  // DISSOLVER — disordered, direction unreliable → sit out
  // All three direction cells suppress entries; the direction is only
  // recorded for telemetry. The label distinguishes the three sub-cases
  // so retrospective analysis can see WHY the trade was suppressed.
  if (direction === 'TREND_UP' || direction === 'TREND_DOWN') {
    return {
      phase, direction, laneBias: 'observe', sizeMultiplier: 0.0,
      harvestTightness: 'tight',
      label: `DISSOLVER×${direction}: don't trade — momentum likely reverting`,
    };
  }
  return {
    phase, direction, laneBias: 'observe', sizeMultiplier: 0.0,
    harvestTightness: 'tight',
    label: 'DISSOLVER×CHOP: sit out (max entropy)',
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
