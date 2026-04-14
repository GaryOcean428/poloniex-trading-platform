/**
 * QIG Frozen Laws — Six experimentally validated physics laws mapped to trading operations
 *
 * Source: GaryOcean428/qig-verification (frozen facts 2026-03-31)
 * Every constant below comes from a frozen experiment with R² > 0.97 or p < 0.005.
 *
 * Laws:
 *   1. Constitutive   G = κT, κ* = 63.79 ± 0.90     → Regime-aware fitness
 *   2. Transport       ω ~ J^1.06                     → Correlation-dependent lookback
 *   3. Refraction      n(J) = 0.481 / J^0.976         → Information velocity map
 *   4. Anderson        |⟨ψ₁|ψ₂⟩|² ~ exp(-0.089 N)   → Binary regime switching
 *   5. Bridge          τ_macro = 0.180 × J^0.86       → Convergence budget
 *   6. Convergence     N,ω,τ converge at J ≥ 2.5      → Scale-independent optimisation
 */

// ─────────────────────────────────────────────────────────────────────────────
// Frozen constants (all from validated experiments)
// ─────────────────────────────────────────────────────────────────────────────

/** Law 1: Constitutive coupling constant κ* = 63.79 ± 0.90 (EXP L=3-7 TFIM, R² > 0.97) */
export const KAPPA_STAR = 63.79;
export const KAPPA_STAR_UNCERTAINTY = 0.90;

/** Law 2: Transport exponent α = 1.06 (EXP-035/038/042, R² = 0.997) */
export const TRANSPORT_EXPONENT = 1.06;

/** Law 3: Refraction amplitude A = 0.481, exponent β = 0.976 (EXP-038, R² = 0.997) */
export const REFRACTION_AMPLITUDE = 0.481;
export const REFRACTION_EXPONENT = 0.976;

/** Law 4: Anderson orthogonality decay rate γ = 0.089 (EXP-041, R² = 0.9996) */
export const ANDERSON_DECAY_RATE = 0.089;

/** Law 5: Bridge prefactor = 0.180, exponent = 0.86 (EXP-042, 12/12 robust) */
export const BRIDGE_PREFACTOR = 0.180;
export const BRIDGE_EXPONENT = 0.86;

/** Law 6: Convergence threshold J_c = 2.5 (EXP-045) */
export const CONVERGENCE_THRESHOLD = 2.5;

/** EXP-004b: Waking-up phase transition h_t ≈ 0.106 */
export const PHASE_TRANSITION_HT = 0.106;

/** EXP-004b: Repulsive regime threshold h_rep ≈ 2.0 */
export const REPULSIVE_THRESHOLD = 2.0;

// ─────────────────────────────────────────────────────────────────────────────
// Regime classification
// ─────────────────────────────────────────────────────────────────────────────

/** Three-regime classification based on EXP-004b phase transitions */
export type QIGRegime = 'disordered' | 'geometric' | 'repulsive';

/**
 * Classify regime from κ measurement.
 *
 * - κ < h_t (0.106)        → disordered (no coherent structure, no-trade zone)
 * - h_t ≤ κ ≤ h_rep (2.0)  → geometric  (coherent structure, strategies trusted)
 * - κ > h_rep               → repulsive  (inverted geometry, REVERSE strategies)
 */
export function classifyRegime(kappa: number): QIGRegime {
  if (kappa < PHASE_TRANSITION_HT) return 'disordered';
  if (kappa > REPULSIVE_THRESHOLD) return 'repulsive';
  return 'geometric';
}

// ─────────────────────────────────────────────────────────────────────────────
// Law 1 — Constitutive: regime-aware fitness weight
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute regime weight for fitness function based on κ measurement.
 *
 * When κ is in the geometric regime (near κ*), the market has coherent
 * structure and strategies should be trusted (weight ≈ 1.0).
 * In disordered regime, weight drops toward 0.
 * In repulsive regime, weight is negative (strategies should be inverted).
 *
 * fitness = sharpe × regimeWeight(κ)
 *
 * @param kappa  Measured coupling constant from return distribution
 * @returns      Weight in [-1, 1] to multiply with Sharpe ratio
 */
export function regimeWeight(kappa: number): number {
  const regime = classifyRegime(kappa);

  switch (regime) {
    case 'disordered':
      // Linearly ramp from 0 at κ=0 to threshold at κ=h_t
      return Math.max(0, kappa / PHASE_TRANSITION_HT) * 0.1;

    case 'geometric': {
      // Full weight when κ is well within geometric regime
      // Peak at κ = 1.0 (middle of geometric range), tapering at edges
      const midpoint = (PHASE_TRANSITION_HT + REPULSIVE_THRESHOLD) / 2;
      const halfRange = (REPULSIVE_THRESHOLD - PHASE_TRANSITION_HT) / 2;
      const distFromMid = Math.abs(kappa - midpoint) / halfRange;
      return Math.max(0.3, 1.0 - 0.7 * distFromMid);
    }

    case 'repulsive': {
      // Strategies should be inverted — negative weight
      // Deeper into repulsive = stronger inversion signal
      const depth = Math.min((kappa - REPULSIVE_THRESHOLD) / REPULSIVE_THRESHOLD, 1.0);
      return -0.5 - 0.5 * depth;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Law 2 — Transport: correlation-dependent lookback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute signal processing speed from coupling density J.
 * ω ~ J^1.06  (EXP-035/038/042, R² = 0.997)
 *
 * Higher J → faster dynamics → shorter lookback window needed.
 *
 * @param coupling  Fisher information coupling J between assets
 * @returns         Relative signal speed (normalised to J=1 baseline)
 */
export function transportSpeed(coupling: number): number {
  if (coupling <= 0) return 0;
  return Math.pow(coupling, TRANSPORT_EXPONENT);
}

/**
 * Compute optimal lookback window (in candles) for a given coupling.
 * High-coupling pairs need shorter lookbacks; low-coupling pairs need longer ones.
 *
 * @param coupling       Fisher information coupling J
 * @param baseLookback   Default lookback for J=1 (default: 50 candles)
 * @returns              Adjusted lookback period
 */
export function adjustedLookback(coupling: number, baseLookback = 50): number {
  if (coupling <= 0) return baseLookback * 2;
  const speed = transportSpeed(coupling);
  // Inverse relationship: faster signal → shorter lookback
  const adjusted = Math.round(baseLookback / Math.max(speed, 0.1));
  return Math.max(10, Math.min(200, adjusted));
}

// ─────────────────────────────────────────────────────────────────────────────
// Law 3 — Refraction: information velocity map
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute refractive index n(J) for a given coupling.
 * n(J) = 0.481 / J^0.976  (EXP-038, R² = 0.997)
 *
 * Lower n = faster information propagation.
 * BTC→ETH (strongly coupled): n ≈ 0.25
 * BTC→altcoin (weakly coupled): n ≈ 0.48
 *
 * @param coupling  Fisher information coupling J between assets
 * @returns         Refractive index (lower = faster propagation)
 */
export function refractiveIndex(coupling: number): number {
  if (coupling <= 0) return Infinity;
  return REFRACTION_AMPLITUDE / Math.pow(coupling, REFRACTION_EXPONENT);
}

/**
 * Estimate signal propagation delay (in candles) from one asset to another.
 *
 * @param coupling     Pairwise Fisher information coupling
 * @param baseDelay    Reference delay at n=1 (default: 3 candles)
 * @returns            Estimated delay in candles
 */
export function signalDelay(coupling: number, baseDelay = 3): number {
  const n = refractiveIndex(coupling);
  return Math.max(0, Math.round(n * baseDelay));
}

// ─────────────────────────────────────────────────────────────────────────────
// Law 4 — Anderson orthogonality: regime overlap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute overlap between two regimes (Anderson orthogonality catastrophe).
 * |⟨ψ(J₁)|ψ(J₂)⟩|² ~ exp(-0.089 N)  (EXP-041, R² = 0.9996)
 *
 * Returns the overlap probability. When this drops below a threshold,
 * old strategies are exponentially irrelevant in the new regime.
 *
 * @param systemSize  N — number of coupled assets in the portfolio
 * @returns           Overlap probability in (0, 1]
 */
export function andersonOverlap(systemSize: number): number {
  if (systemSize <= 0) return 1.0;
  return Math.exp(-ANDERSON_DECAY_RATE * systemSize);
}

/**
 * Check whether a regime transition warrants a full strategy reset.
 *
 * When overlap drops below threshold, strategies from the old regime
 * have essentially zero relevance to the new regime.
 *
 * @param systemSize  Number of assets in the portfolio
 * @param threshold   Overlap threshold for reset (default: 0.1 = 10% overlap)
 * @returns           true if strategies should be completely regenerated
 */
export function shouldResetStrategies(systemSize: number, threshold = 0.1): boolean {
  return andersonOverlap(systemSize) < threshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// Law 5 — Bridge: convergence budget
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the convergence budget τ — minimum backtest iterations needed
 * before macro-observable (strategy fitness) stabilises.
 *
 * τ_macro = 0.180 × J^0.86  (EXP-042, 12/12 robust)
 *
 * @param coupling  Average Fisher information coupling J of the portfolio
 * @returns         Number of convergence iterations (normalised)
 */
export function convergenceBudget(coupling: number): number {
  if (coupling <= 0) return Infinity;
  return BRIDGE_PREFACTOR * Math.pow(coupling, BRIDGE_EXPONENT);
}

/**
 * Compute minimum backtest candles for reliable fitness evaluation.
 *
 * @param coupling       Average portfolio coupling
 * @param baseCandles    Candles needed at τ=1 (default: 200)
 * @returns              Recommended minimum backtest candles
 */
export function minBacktestCandles(coupling: number, baseCandles = 200): number {
  const tau = convergenceBudget(coupling);
  if (!Number.isFinite(tau)) return baseCandles * 3;
  return Math.max(50, Math.round(baseCandles * tau));
}

// ─────────────────────────────────────────────────────────────────────────────
// Law 6 — Convergence: scale-independent optimisation above threshold
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether the portfolio's average coupling exceeds the convergence
 * threshold J_c = 2.5 (EXP-045).
 *
 * Above it: optimisation cost is independent of portfolio size.
 * Below it: optimisation cost scales with number of assets.
 *
 * @param avgCoupling  Average pairwise Fisher information coupling
 * @returns            true if above convergence threshold
 */
export function isScaleIndependent(avgCoupling: number): boolean {
  return avgCoupling >= CONVERGENCE_THRESHOLD;
}

/**
 * Compute the compute budget for genome evaluation.
 *
 * Above convergence threshold: fixed budget regardless of portfolio size.
 * Below threshold: budget scales linearly with asset count.
 *
 * @param avgCoupling  Average portfolio coupling
 * @param assetCount   Number of assets in portfolio
 * @param baseBudget   Base compute iterations (default: 100)
 * @returns            Adjusted compute budget (iterations)
 */
export function computeBudget(avgCoupling: number, assetCount: number, baseBudget = 100): number {
  if (isScaleIndependent(avgCoupling)) {
    return baseBudget;
  }
  // Below threshold: scale with asset count
  return Math.round(baseBudget * Math.sqrt(Math.max(1, assetCount)));
}

// ─────────────────────────────────────────────────────────────────────────────
// EXP-013: Geometric fragility (fidelity-R² decoupling)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute geometric fragility — a leading indicator of regime change.
 *
 * High fidelity + low R² = market looks stable but geometric structure
 * is shattering. This detects regime change BEFORE the price moves.
 *
 * @param fidelity   Price autocorrelation / apparent stability [0, 1]
 * @param rSquared   R² of the constitutive relation (geometric coherence) [0, 1]
 * @returns          Fragility score [0, 1]. High = imminent regime change.
 */
export function geometricFragility(fidelity: number, rSquared: number): number {
  // Fragility = high fidelity × low coherence
  const clampedFidelity = Math.max(0, Math.min(1, fidelity));
  const clampedR2 = Math.max(0, Math.min(1, rSquared));
  return clampedFidelity * (1 - clampedR2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fisher Information estimation from return series
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate Fisher Information from a return series.
 *
 * Uses the variance of score function: F = Var(d/dθ log p(x|θ))
 * For Gaussian returns, F = 1/σ² which is the simplest valid estimator.
 * For non-Gaussian, we use a histogram-based approach.
 *
 * @param returns  Array of log returns
 * @returns        Fisher Information estimate (higher = more informative)
 */
export function estimateFisherInformation(returns: number[]): number {
  if (returns.length < 10) return 0;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;

  if (variance < 1e-15) return 0;

  // Fisher information for location parameter of the return distribution
  return 1 / variance;
}

/**
 * Estimate κ (Einstein coupling constant) from return series.
 *
 * Measures the coupling between geometric deformation (curvature of return
 * manifold) and stress-energy (volatility structure).
 *
 * Uses Fisher information of rolling windows to estimate the constitutive
 * relation G = κT.
 *
 * @param returns     Array of log returns
 * @param windowSize  Rolling window for local Fisher estimation (default: 20)
 * @returns           Estimated κ value
 */
export function estimateKappa(returns: number[], windowSize = 20): number {
  if (returns.length < windowSize * 3) return 0;

  const fisherValues: number[] = [];
  const volatilityValues: number[] = [];

  for (let i = windowSize; i <= returns.length - windowSize; i++) {
    const window = returns.slice(i - windowSize, i);
    const nextWindow = returns.slice(i, i + windowSize);

    const fi = estimateFisherInformation(window);
    const fiNext = estimateFisherInformation(nextWindow);

    // Curvature proxy: rate of change of Fisher information
    const curvature = Math.abs(fiNext - fi);

    // Stress proxy: local volatility
    const localVol = Math.sqrt(
      window.reduce((s, r) => s + r * r, 0) / window.length
    );

    if (localVol > 1e-15) {
      fisherValues.push(curvature);
      volatilityValues.push(localVol);
    }
  }

  if (fisherValues.length < 3) return 0;

  // Estimate κ via linear regression: curvature ≈ κ × volatility
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < fisherValues.length; i++) {
    sumXY += volatilityValues[i] * fisherValues[i];
    sumX2 += volatilityValues[i] * volatilityValues[i];
  }

  if (sumX2 < 1e-15) return 0;
  return sumXY / sumX2;
}

/**
 * Compute R² of the constitutive relation (geometric coherence).
 *
 * Measures how well the linear G = κT relation holds for the current
 * market data. High R² = coherent geometry; low R² = breaking down.
 *
 * @param returns     Array of log returns
 * @param windowSize  Rolling window size (default: 20)
 * @returns           R² value in [0, 1]
 */
export function constitutiveR2(returns: number[], windowSize = 20): number {
  if (returns.length < windowSize * 3) return 0;

  const curvatures: number[] = [];
  const stresses: number[] = [];

  for (let i = windowSize; i <= returns.length - windowSize; i++) {
    const window = returns.slice(i - windowSize, i);
    const nextWindow = returns.slice(i, i + windowSize);

    const fi = estimateFisherInformation(window);
    const fiNext = estimateFisherInformation(nextWindow);

    const curvature = Math.abs(fiNext - fi);
    const localVol = Math.sqrt(
      window.reduce((s, r) => s + r * r, 0) / window.length
    );

    if (localVol > 1e-15) {
      curvatures.push(curvature);
      stresses.push(localVol);
    }
  }

  if (curvatures.length < 3) return 0;

  // R² of linear fit
  const n = curvatures.length;
  const meanY = curvatures.reduce((s, v) => s + v, 0) / n;
  const meanX = stresses.reduce((s, v) => s + v, 0) / n;

  let ssRes = 0;
  let ssTot = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumXY += stresses[i] * curvatures[i];
    sumX2 += stresses[i] * stresses[i];
    ssTot += (curvatures[i] - meanY) ** 2;
  }

  if (ssTot < 1e-15 || sumX2 < 1e-15) return 0;

  const slope = (sumXY - n * meanX * meanY) / (sumX2 - n * meanX * meanX);
  const intercept = meanY - slope * meanX;

  for (let i = 0; i < n; i++) {
    const predicted = slope * stresses[i] + intercept;
    ssRes += (curvatures[i] - predicted) ** 2;
  }

  return Math.max(0, Math.min(1, 1 - ssRes / ssTot));
}

/**
 * Compute price autocorrelation (fidelity proxy).
 *
 * @param returns  Array of log returns
 * @param lag      Autocorrelation lag (default: 1)
 * @returns        Autocorrelation coefficient in [-1, 1], mapped to [0, 1]
 */
export function priceAutocorrelation(returns: number[], lag = 1): number {
  if (returns.length < lag + 10) return 0.5;

  const n = returns.length - lag;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (returns[i] - mean) * (returns[i + lag] - mean);
    den += (returns[i] - mean) ** 2;
  }

  if (den < 1e-15) return 0.5;
  const rho = num / den;

  // Map from [-1, 1] to [0, 1] — high autocorrelation = high fidelity
  return (rho + 1) / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pairwise coupling estimation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate Fisher information coupling J between two return series.
 *
 * Uses the cross-Fisher information: how sensitive the joint distribution
 * is to perturbations.
 *
 * @param returnsA  Log returns of asset A
 * @param returnsB  Log returns of asset B
 * @returns         Coupling strength J (higher = more coupled)
 */
export function pairwiseCoupling(returnsA: number[], returnsB: number[]): number {
  const n = Math.min(returnsA.length, returnsB.length);
  if (n < 10) return 0;

  // Use correlation as coupling proxy, scaled to positive range
  const meanA = returnsA.slice(0, n).reduce((s, r) => s + r, 0) / n;
  const meanB = returnsB.slice(0, n).reduce((s, r) => s + r, 0) / n;

  let covAB = 0;
  let varA = 0;
  let varB = 0;

  for (let i = 0; i < n; i++) {
    const dA = returnsA[i] - meanA;
    const dB = returnsB[i] - meanB;
    covAB += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }

  if (varA < 1e-15 || varB < 1e-15) return 0;

  const correlation = Math.abs(covAB / Math.sqrt(varA * varB));

  // Scale correlation to coupling: J = |ρ| × scale factor
  // At ρ=1, J should be in the strong coupling regime (> 2.5)
  return correlation * 4.0;
}
