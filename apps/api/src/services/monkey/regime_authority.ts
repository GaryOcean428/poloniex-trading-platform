/**
 * regime_authority.ts — Two-layer regime authority (REGIME-1 #766)
 *
 * Layer 1 (physics): qig_warp.classify_regime h/J → CREATOR/PRESERVER/DISSOLVER
 *   Input: regimeWeights {quantum, efficient, equilibrium} from BasinState
 * Layer 2 (trajectory): basin direction → TREND_UP/CHOP/TREND_DOWN
 *   Input: RegimeReading from classifyRegime()
 *
 * These are ORTHOGONAL axes per ADR docs/regime-classification-hierarchy.md.
 * See that file for the 3x3 cell action matrix.
 *
 * Safety bounds (P25):
 *   - phaseConfidence > 0.5 for DISSOLVER suppression — bound, not tune.
 *     Rationale: below 0.5 the phase signal is weaker than a coin flip;
 *     suppressing on noise is unsafe. This is the minimum credibility gate.
 *   - trendThr / swingThr defaults (0.70 / 0.85) are trajectory-only legacy
 *     values, kept as fall-through when phase does not suppress.
 */

export type PhaseLabel = 'CREATOR' | 'PRESERVER' | 'DISSOLVER';
export type DirectionLabel = 'TREND_UP' | 'CHOP' | 'TREND_DOWN';

export interface RegimeAuthority {
  phase: PhaseLabel;
  /** Strength of phase signal = max(regimeWeights). */
  phaseConfidence: number;
  direction: DirectionLabel;
  directionConfidence: number;
  isWarmup: boolean;
}

export function getRegimeAuthority(
  regimeWeights: { quantum: number; efficient: number; equilibrium: number },
  regimeReading: { regime: DirectionLabel; confidence: number; isWarmup?: boolean },
): RegimeAuthority {
  const { quantum, efficient, equilibrium } = regimeWeights;

  // Map quantum/efficient/equilibrium → CREATOR/PRESERVER/DISSOLVER
  // (canonical mapping per ADR: quantum=CREATOR, efficient=PRESERVER, equilibrium=DISSOLVER)
  let phase: PhaseLabel;
  let phaseConfidence: number;
  const maxW = Math.max(quantum, efficient, equilibrium);

  if (quantum === maxW) {
    phase = 'CREATOR';
    phaseConfidence = quantum;
  } else if (efficient === maxW) {
    phase = 'PRESERVER';
    phaseConfidence = efficient;
  } else {
    phase = 'DISSOLVER';
    phaseConfidence = equilibrium;
  }

  return {
    phase,
    phaseConfidence,
    direction: regimeReading.regime,
    directionConfidence: regimeReading.confidence,
    isWarmup: regimeReading.isWarmup ?? false,
  };
}

/**
 * Extended phase+direction suppression per ADR 3×3 matrix.
 * Replaces legacy chopSuppressEntry in regime.ts when REGIME_COMPOSITIONAL_LIVE=true.
 *
 * Returns a ChopSuppressionResult-compatible shape so it can substitute
 * directly for chopSuppressEntry at every call site without adapter code.
 *
 * Safety bounds (P25):
 *   - phaseConfidence > 0.5: minimum credibility gate for DISSOLVER suppression.
 *   - trendThr / swingThr: legacy trajectory-only safety defaults, unchanged from
 *     the pre-compositional path so roll-back is safe.
 */
export function phaseSuppressEntry(
  authority: RegimeAuthority,
  lane: 'trend' | 'swing' | 'scalp',
  trendThr = 0.70,
  swingThr = 0.85,
): { suppressed: boolean; suppressReason: string | null; regime: string; confidence: number; lane: string } {
  if (lane === 'scalp') {
    return {
      suppressed: false, suppressReason: null,
      regime: authority.direction, confidence: authority.directionConfidence, lane,
    };
  }

  const { phase, phaseConfidence, direction, directionConfidence } = authority;

  // DISSOLVER phase with confidence > 0.5 suppresses trend and swing.
  // P25 safety bound: 0.5 is the minimum credibility gate (coin-flip baseline).
  if (phase === 'DISSOLVER' && phaseConfidence > 0.5) {
    return {
      suppressed: true,
      suppressReason: `DISSOLVER phase (phaseConf=${phaseConfidence.toFixed(2)}) suppresses ${lane}`,
      regime: authority.direction, confidence: phaseConfidence, lane,
    };
  }

  // CREATOR phase + CHOP direction suppresses trend (pre-breakout coiling).
  if (phase === 'CREATOR' && direction === 'CHOP' && lane === 'trend') {
    return {
      suppressed: true,
      suppressReason: `CREATOR×CHOP pre-breakout coiling suppresses trend`,
      regime: authority.direction, confidence: directionConfidence, lane,
    };
  }

  // PRESERVER phase + CHOP direction → do NOT suppress trend (consolidation in trend is normal).
  if (phase === 'PRESERVER' && direction === 'CHOP' && lane === 'trend') {
    return {
      suppressed: false,
      suppressReason: null,
      regime: authority.direction, confidence: directionConfidence, lane,
    };
  }

  // Legacy trajectory-only CHOP suppression (unchanged safety thresholds from regime.ts).
  if (direction === 'CHOP') {
    const thr = lane === 'trend' ? trendThr : swingThr;
    if (directionConfidence >= thr) {
      return {
        suppressed: true,
        suppressReason: `CHOP directionConf=${directionConfidence.toFixed(2)} ≥ ${thr}`,
        regime: authority.direction, confidence: directionConfidence, lane,
      };
    }
  }

  return {
    suppressed: false, suppressReason: null,
    regime: authority.direction, confidence: directionConfidence, lane,
  };
}

/**
 * Cell-action labels per ADR. Used in shadow-log for comparing
 * legacy (trajectory-only) vs compositional (phase+direction).
 */
export function getCellActionLabel(authority: RegimeAuthority): string {
  const { phase, direction } = authority;
  const cell: Record<string, string> = {
    'CREATOR_TREND_UP': 'breakout_long',
    'CREATOR_TREND_DOWN': 'breakout_short',
    'CREATOR_CHOP': 'standback',
    'PRESERVER_TREND_UP': 'trend_long',
    'PRESERVER_TREND_DOWN': 'trend_short',
    'PRESERVER_CHOP': 'wait_continuation',
    'DISSOLVER_TREND_UP': 'scalp_small_or_cash',
    'DISSOLVER_TREND_DOWN': 'scalp_small_or_cash',
    'DISSOLVER_CHOP': 'scalp_small_or_cash',
  };
  return cell[`${phase}_${direction}`] ?? 'unknown';
}
