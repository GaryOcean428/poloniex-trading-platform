/**
 * QIG Fitness Function — curvature-aware strategy evaluation
 *
 * Replaces the raw Sharpe ratio fitness with physics-grounded evaluation:
 *
 *   fitness = sharpe × regimeWeight(κ)           (Law 1: Constitutive)
 *   fragility = fidelity × (1 - R²)              (EXP-013: Basin decoupling)
 *   earlyExit = stabilised within screening ξ     (Anderson early exit)
 *
 * Dual-framing evaluation (C3 Figure-8):
 *   Forward:  "Under what conditions would this genome be profitable?"
 *   Backward: "What market condition would make this genome catastrophically wrong?"
 */

import {
  regimeWeight,
  classifyRegime,
  geometricFragility,
  estimateKappa,
  constitutiveR2,
  priceAutocorrelation,
  andersonOverlap,
  type QIGRegime,
} from './qigFrozenLaws.js';

// ─────────────────────────────────────────────────────────────────────────────
// Dual-framing thresholds (C3 Figure-8 evaluation)
// ─────────────────────────────────────────────────────────────────────────────

/** Max drawdown beyond which the backward framing fails (catastrophic loss) */
const CATASTROPHIC_DRAWDOWN_THRESHOLD = 0.15;

/** Fragility above which the backward framing fails (imminent regime change) */
const HIGH_FRAGILITY_THRESHOLD = 0.7;

/** Win rate above which (combined with high Sharpe) signals likely overfitting */
const SUSPICIOUS_WIN_RATE = 0.85;

/** Sharpe above which (combined with high win rate) signals likely overfitting */
const SUSPICIOUS_SHARPE = 3.0;

/** Minimum Sharpe required in disordered regime (no coherent structure) */
const DISORDERED_MIN_SHARPE = 2.0;

/** Minimum win rate required in disordered regime */
const DISORDERED_MIN_WIN_RATE = 0.55;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BacktestMetrics {
  sharpe: number;
  winRate: number;
  maxDrawdown: number;
  /** Equity curve points for early-exit detection */
  equityCurve?: number[];
}

export interface QIGFitnessResult {
  /** Raw Sharpe ratio from backtest */
  rawSharpe: number;
  /** Curvature-aware fitness = sharpe × regimeWeight(κ) */
  adjustedFitness: number;
  /** Estimated κ from return series */
  kappa: number;
  /** Regime classification */
  regime: QIGRegime;
  /** Regime weight applied to fitness */
  weight: number;
  /** Geometric fragility: high = imminent regime change */
  fragility: number;
  /** R² of constitutive relation */
  geometricCoherence: number;
  /** Whether the backtest converged early (Anderson exit) */
  earlyExit: boolean;
  /** Forward framing: fitness assessment */
  forwardPass: boolean;
  /** Backward framing: catastrophe risk assessment */
  backwardPass: boolean;
  /** Combined pass: both framings agree the strategy is viable */
  dualFramingPass: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core fitness computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute curvature-aware fitness for a strategy.
 *
 * Law 1 integration: fitness = sharpe × regimeWeight(κ_measured)
 *
 * @param metrics      Backtest metrics (sharpe, winRate, maxDrawdown)
 * @param returns      Return series from the backtest period
 * @param windowSize   Rolling window for κ estimation (default: 20)
 * @returns            Complete fitness assessment
 */
export function computeQIGFitness(
  metrics: BacktestMetrics,
  returns: number[],
  windowSize = 20
): QIGFitnessResult {
  // Measure κ from the return distribution
  const kappa = estimateKappa(returns, windowSize);
  const regime = classifyRegime(kappa);
  const weight = regimeWeight(kappa);

  // Curvature-aware fitness
  const adjustedFitness = metrics.sharpe * weight;

  // Geometric coherence (R² of constitutive relation)
  const geometricCoherence = constitutiveR2(returns, windowSize);

  // Fidelity (price autocorrelation)
  const fidelity = priceAutocorrelation(returns);

  // Geometric fragility — leading indicator
  const fragility = geometricFragility(fidelity, geometricCoherence);

  // Anderson early exit: check if equity curve has converged
  const earlyExit = checkEarlyExit(metrics.equityCurve ?? []);

  // Dual framing evaluation (C3 Figure-8)
  const forwardPass = evaluateForwardFraming(metrics, regime, weight);
  const backwardPass = evaluateBackwardFraming(metrics, fragility);
  const dualFramingPass = forwardPass && backwardPass;

  return {
    rawSharpe: metrics.sharpe,
    adjustedFitness,
    kappa,
    regime,
    weight,
    fragility,
    geometricCoherence,
    earlyExit,
    forwardPass,
    backwardPass,
    dualFramingPass,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Forward framing: "Would this genome be profitable?"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Forward framing assessment: standard backtest evaluation with regime awareness.
 *
 * In geometric regime: trust the backtest results.
 * In disordered regime: discount the results heavily.
 * In repulsive regime: invert the assessment.
 */
function evaluateForwardFraming(
  metrics: BacktestMetrics,
  regime: QIGRegime,
  weight: number
): boolean {
  switch (regime) {
    case 'geometric':
      // Trust the backtest — positive adjusted Sharpe is sufficient
      return metrics.sharpe * weight > 0;

    case 'disordered':
      // No coherent structure — require very strong signal to pass
      return metrics.sharpe > DISORDERED_MIN_SHARPE && metrics.winRate > DISORDERED_MIN_WIN_RATE;

    case 'repulsive':
      // Inverted geometry — a NEGATIVE Sharpe might actually be good
      // (strategies should be inverted). Pass if the inversion makes sense.
      return metrics.sharpe * weight > 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backward framing: "What would make this catastrophically wrong?"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Backward framing assessment: check for catastrophe risk.
 *
 * Start from worst case and check if conditions are realistic.
 * Fails if:
 *   - Max drawdown exceeds 15% (catastrophic)
 *   - Geometric fragility is high (regime about to change)
 *   - Win rate is suspiciously high (likely overfitting)
 */
function evaluateBackwardFraming(
  metrics: BacktestMetrics,
  fragility: number
): boolean {
  // Catastrophic drawdown check
  if (metrics.maxDrawdown > CATASTROPHIC_DRAWDOWN_THRESHOLD) return false;

  // Geometric fragility check — market about to break
  if (fragility > HIGH_FRAGILITY_THRESHOLD) return false;

  // Overfitting check — suspiciously perfect results
  if (metrics.winRate > SUSPICIOUS_WIN_RATE && metrics.sharpe > SUSPICIOUS_SHARPE) return false;

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anderson early exit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether the equity curve has stabilised within the screening radius ξ.
 *
 * If the running Sharpe has stabilised (slope near zero over recent window),
 * further iterations won't change the verdict → stop early.
 *
 * C3 ablation: same accuracy, 40% fewer backtest evaluations.
 *
 * @param equityCurve  Array of equity values during backtest
 * @param window       Window for slope check (default: 10 points)
 * @param threshold    Slope magnitude below which we declare convergence
 * @returns            true if early exit is warranted
 */
function checkEarlyExit(
  equityCurve: number[],
  window = 10,
  threshold = 0.001
): boolean {
  if (equityCurve.length < window + 5) return false;

  // Compute slope of last `window` points using least squares
  const recent = equityCurve.slice(-window);
  const n = recent.length;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += recent[i];
    sumXY += i * recent[i];
    sumX2 += i * i;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return true;

  const slope = (n * sumXY - sumX * sumY) / denom;

  // Normalise slope by mean equity to get relative change rate
  const meanEquity = sumY / n;
  if (meanEquity === 0) return true;

  const relativeSlope = Math.abs(slope / meanEquity);
  return relativeSlope < threshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime transition detector (for Anderson binary switching)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect whether a regime transition has occurred, warranting binary strategy reset.
 *
 * Law 4 (Anderson Orthogonality): Different coupling regimes become exponentially
 * orthogonal with system size. When the regime transitions, old strategies become
 * exponentially irrelevant.
 *
 * @param previousKappa  κ measurement from previous cycle
 * @param currentKappa   κ measurement from current cycle
 * @param systemSize     Number of assets in portfolio
 * @returns              Object with transition detected flag and overlap probability
 */
export function detectRegimeTransition(
  previousKappa: number,
  currentKappa: number,
  systemSize: number
): { transitioned: boolean; overlap: number; fromRegime: QIGRegime; toRegime: QIGRegime } {
  const fromRegime = classifyRegime(previousKappa);
  const toRegime = classifyRegime(currentKappa);

  // No transition if regime hasn't changed
  if (fromRegime === toRegime) {
    return { transitioned: false, overlap: 1.0, fromRegime, toRegime };
  }

  // Anderson overlap: exponentially small for large systems
  const overlap = andersonOverlap(systemSize);

  return {
    transitioned: true,
    overlap,
    fromRegime,
    toRegime,
  };
}
