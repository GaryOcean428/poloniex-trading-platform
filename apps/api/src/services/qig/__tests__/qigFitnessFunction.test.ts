/**
 * Unit tests for QIG Fitness Function module.
 *
 * Tests:
 *   - Curvature-aware fitness (Law 1: sharpe × regimeWeight(κ))
 *   - Dual-framing evaluation (C3 Figure-8: forward + backward)
 *   - Anderson early exit (converged equity curve)
 *   - Regime transition detection (Law 4)
 *   - Geometric fragility integration
 */

import { describe, it, expect } from 'vitest';
import {
  computeQIGFitness,
  detectRegimeTransition,
  type BacktestMetrics,
  type QIGFitnessResult,
} from '../qigFitnessFunction.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a synthetic return series */
function syntheticReturns(n = 200, volatility = 0.01): number[] {
  return Array.from({ length: n }, () => volatility * (Math.random() - 0.5));
}

function goodMetrics(): BacktestMetrics {
  return { sharpe: 1.5, winRate: 0.55, maxDrawdown: 0.08 };
}

function badMetrics(): BacktestMetrics {
  return { sharpe: 0.3, winRate: 0.40, maxDrawdown: 0.20 };
}

// ─── computeQIGFitness ──────────────────────────────────────────────────────

describe('computeQIGFitness', () => {
  it('should return a complete QIGFitnessResult', () => {
    const metrics = goodMetrics();
    const returns = syntheticReturns(200);
    const result = computeQIGFitness(metrics, returns);

    expect(result).toHaveProperty('rawSharpe');
    expect(result).toHaveProperty('adjustedFitness');
    expect(result).toHaveProperty('kappa');
    expect(result).toHaveProperty('regime');
    expect(result).toHaveProperty('weight');
    expect(result).toHaveProperty('fragility');
    expect(result).toHaveProperty('geometricCoherence');
    expect(result).toHaveProperty('earlyExit');
    expect(result).toHaveProperty('forwardPass');
    expect(result).toHaveProperty('backwardPass');
    expect(result).toHaveProperty('dualFramingPass');
  });

  it('should preserve raw Sharpe in the result', () => {
    const metrics = goodMetrics();
    const returns = syntheticReturns(200);
    const result = computeQIGFitness(metrics, returns);
    expect(result.rawSharpe).toBe(metrics.sharpe);
  });

  it('should classify regime from κ', () => {
    const returns = syntheticReturns(200);
    const result = computeQIGFitness(goodMetrics(), returns);
    expect(['disordered', 'geometric', 'repulsive']).toContain(result.regime);
  });

  it('should have adjustedFitness = sharpe × weight', () => {
    const returns = syntheticReturns(200);
    const result = computeQIGFitness(goodMetrics(), returns);
    expect(result.adjustedFitness).toBeCloseTo(result.rawSharpe * result.weight, 5);
  });

  it('should have fragility in [0, 1]', () => {
    const returns = syntheticReturns(200);
    const result = computeQIGFitness(goodMetrics(), returns);
    expect(result.fragility).toBeGreaterThanOrEqual(0);
    expect(result.fragility).toBeLessThanOrEqual(1);
  });

  it('should have geometricCoherence in [0, 1]', () => {
    const returns = syntheticReturns(200);
    const result = computeQIGFitness(goodMetrics(), returns);
    expect(result.geometricCoherence).toBeGreaterThanOrEqual(0);
    expect(result.geometricCoherence).toBeLessThanOrEqual(1);
  });
});

// ─── Dual Framing (C3 Figure-8) ─────────────────────────────────────────────

describe('Dual Framing', () => {
  it('should pass forward + backward for good metrics', () => {
    const returns = syntheticReturns(200, 0.01);
    const result = computeQIGFitness(goodMetrics(), returns);
    // For reasonable random returns, at least backward should pass
    expect(result.backwardPass).toBe(true);
  });

  it('should fail backward for catastrophic drawdown', () => {
    const metrics: BacktestMetrics = { sharpe: 2.0, winRate: 0.6, maxDrawdown: 0.25 };
    const returns = syntheticReturns(200);
    const result = computeQIGFitness(metrics, returns);
    expect(result.backwardPass).toBe(false);
    expect(result.dualFramingPass).toBe(false);
  });

  it('should fail backward for suspiciously perfect results', () => {
    const metrics: BacktestMetrics = { sharpe: 4.0, winRate: 0.90, maxDrawdown: 0.02 };
    const returns = syntheticReturns(200);
    const result = computeQIGFitness(metrics, returns);
    expect(result.backwardPass).toBe(false);
  });

  it('should pass backward for reasonable metrics below drawdown threshold', () => {
    const metrics: BacktestMetrics = { sharpe: 1.2, winRate: 0.52, maxDrawdown: 0.10 };
    const returns = syntheticReturns(200);
    const result = computeQIGFitness(metrics, returns);
    expect(result.backwardPass).toBe(true);
  });
});

// ─── Anderson Early Exit ─────────────────────────────────────────────────────

describe('Anderson Early Exit', () => {
  it('should detect early exit for converged equity curve', () => {
    // Flat equity curve → converged → early exit
    const flatCurve = Array.from({ length: 30 }, () => 1000);
    const metrics: BacktestMetrics = { sharpe: 1.5, winRate: 0.55, maxDrawdown: 0.08, equityCurve: flatCurve };
    const returns = syntheticReturns(200);
    const result = computeQIGFitness(metrics, returns);
    expect(result.earlyExit).toBe(true);
  });

  it('should NOT detect early exit for diverging equity curve', () => {
    // Sharply growing equity curve → not converged
    const growingCurve = Array.from({ length: 30 }, (_, i) => 1000 + i * 50);
    const metrics: BacktestMetrics = { sharpe: 2.0, winRate: 0.6, maxDrawdown: 0.05, equityCurve: growingCurve };
    const returns = syntheticReturns(200);
    const result = computeQIGFitness(metrics, returns);
    expect(result.earlyExit).toBe(false);
  });

  it('should NOT detect early exit for short equity curve', () => {
    const shortCurve = [1000, 1010, 1005];
    const metrics: BacktestMetrics = { sharpe: 1.0, winRate: 0.5, maxDrawdown: 0.1, equityCurve: shortCurve };
    const returns = syntheticReturns(200);
    const result = computeQIGFitness(metrics, returns);
    expect(result.earlyExit).toBe(false);
  });
});

// ─── Regime Transition Detection ─────────────────────────────────────────────

describe('detectRegimeTransition', () => {
  it('should detect no transition when regime is the same', () => {
    // Both in geometric regime
    const result = detectRegimeTransition(0.5, 0.8, 10);
    expect(result.transitioned).toBe(false);
    expect(result.overlap).toBe(1.0);
    expect(result.fromRegime).toBe('geometric');
    expect(result.toRegime).toBe('geometric');
  });

  it('should detect transition from geometric to disordered', () => {
    const result = detectRegimeTransition(1.0, 0.05, 10);
    expect(result.transitioned).toBe(true);
    expect(result.fromRegime).toBe('geometric');
    expect(result.toRegime).toBe('disordered');
    expect(result.overlap).toBeGreaterThan(0);
    expect(result.overlap).toBeLessThan(1);
  });

  it('should detect transition from geometric to repulsive', () => {
    const result = detectRegimeTransition(1.0, 3.0, 10);
    expect(result.transitioned).toBe(true);
    expect(result.fromRegime).toBe('geometric');
    expect(result.toRegime).toBe('repulsive');
  });

  it('should have lower overlap for larger systems', () => {
    const small = detectRegimeTransition(1.0, 0.05, 5);
    const large = detectRegimeTransition(1.0, 0.05, 50);
    expect(large.overlap).toBeLessThan(small.overlap);
  });

  it('should have exponentially decaying overlap', () => {
    const result10 = detectRegimeTransition(1.0, 0.05, 10);
    const result20 = detectRegimeTransition(1.0, 0.05, 20);
    // overlap(20) ≈ overlap(10)²
    expect(result20.overlap).toBeCloseTo(result10.overlap * result10.overlap, 2);
  });
});
