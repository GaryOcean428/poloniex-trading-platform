/**
 * Unit tests for QIG Frozen Laws module.
 *
 * Tests the six experimentally validated physics laws mapped to trading:
 *   1. Constitutive (regime weight)
 *   2. Transport (lookback adjustment)
 *   3. Refraction (signal delay)
 *   4. Anderson (overlap & binary reset)
 *   5. Bridge (convergence budget)
 *   6. Convergence (scale independence)
 *   + Fisher Information & κ estimation
 *   + Geometric fragility (EXP-013)
 */

import { describe, it, expect } from 'vitest';
import {
  // Constants
  KAPPA_STAR,
  KAPPA_STAR_UNCERTAINTY,
  TRANSPORT_EXPONENT,
  REFRACTION_AMPLITUDE,
  REFRACTION_EXPONENT,
  ANDERSON_DECAY_RATE,
  BRIDGE_PREFACTOR,
  BRIDGE_EXPONENT,
  CONVERGENCE_THRESHOLD,
  PHASE_TRANSITION_HT,
  REPULSIVE_THRESHOLD,
  // Functions
  classifyRegime,
  regimeWeight,
  transportSpeed,
  adjustedLookback,
  refractiveIndex,
  signalDelay,
  andersonOverlap,
  shouldResetStrategies,
  convergenceBudget,
  minBacktestCandles,
  isScaleIndependent,
  computeBudget,
  geometricFragility,
  estimateFisherInformation,
  estimateKappa,
  constitutiveR2,
  priceAutocorrelation,
  pairwiseCoupling,
} from '../qigFrozenLaws.js';

// ─── Frozen Constants ────────────────────────────────────────────────────────

describe('Frozen Constants', () => {
  it('should have κ* = 63.79 ± 0.90', () => {
    expect(KAPPA_STAR).toBe(63.79);
    expect(KAPPA_STAR_UNCERTAINTY).toBe(0.90);
  });

  it('should have transport exponent α = 1.06', () => {
    expect(TRANSPORT_EXPONENT).toBe(1.06);
  });

  it('should have refraction amplitude A = 0.481, β = 0.976', () => {
    expect(REFRACTION_AMPLITUDE).toBe(0.481);
    expect(REFRACTION_EXPONENT).toBe(0.976);
  });

  it('should have Anderson decay rate γ = 0.089', () => {
    expect(ANDERSON_DECAY_RATE).toBe(0.089);
  });

  it('should have bridge prefactor = 0.180, exponent = 0.86', () => {
    expect(BRIDGE_PREFACTOR).toBe(0.180);
    expect(BRIDGE_EXPONENT).toBe(0.86);
  });

  it('should have convergence threshold J_c = 2.5', () => {
    expect(CONVERGENCE_THRESHOLD).toBe(2.5);
  });

  it('should have phase transition h_t ≈ 0.106 and repulsive threshold ≈ 2.0', () => {
    expect(PHASE_TRANSITION_HT).toBe(0.106);
    expect(REPULSIVE_THRESHOLD).toBe(2.0);
  });
});

// ─── Law 1: Constitutive — Regime Classification ─────────────────────────────

describe('classifyRegime', () => {
  it('should classify κ < h_t as disordered', () => {
    expect(classifyRegime(0.05)).toBe('disordered');
    expect(classifyRegime(0)).toBe('disordered');
    expect(classifyRegime(0.1)).toBe('disordered');
  });

  it('should classify h_t ≤ κ ≤ 2.0 as geometric', () => {
    expect(classifyRegime(0.106)).toBe('geometric');
    expect(classifyRegime(1.0)).toBe('geometric');
    expect(classifyRegime(2.0)).toBe('geometric');
  });

  it('should classify κ > 2.0 as repulsive', () => {
    expect(classifyRegime(2.1)).toBe('repulsive');
    expect(classifyRegime(5.0)).toBe('repulsive');
  });
});

// ─── Law 1: Constitutive — Regime Weight ─────────────────────────────────────

describe('regimeWeight', () => {
  it('should return near-zero weight in disordered regime', () => {
    const w = regimeWeight(0.05);
    expect(w).toBeGreaterThanOrEqual(0);
    expect(w).toBeLessThan(0.15);
  });

  it('should return positive weight in geometric regime', () => {
    const w = regimeWeight(1.0);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThanOrEqual(1.0);
  });

  it('should return highest weight near midpoint of geometric regime', () => {
    const wMid = regimeWeight(1.0);
    const wEdge = regimeWeight(0.15);
    expect(wMid).toBeGreaterThan(wEdge);
  });

  it('should return negative weight in repulsive regime', () => {
    const w = regimeWeight(3.0);
    expect(w).toBeLessThan(0);
  });

  it('should return zero weight at κ = 0', () => {
    expect(regimeWeight(0)).toBe(0);
  });
});

// ─── Law 2: Transport — Signal Speed ─────────────────────────────────────────

describe('transportSpeed', () => {
  it('should return 1 for J = 1', () => {
    expect(transportSpeed(1)).toBeCloseTo(1.0, 5);
  });

  it('should return > 1 for J > 1 (faster dynamics)', () => {
    expect(transportSpeed(2)).toBeGreaterThan(1);
  });

  it('should return < 1 for J < 1 (slower dynamics)', () => {
    expect(transportSpeed(0.5)).toBeLessThan(1);
  });

  it('should return 0 for J = 0', () => {
    expect(transportSpeed(0)).toBe(0);
  });

  it('should scale as J^1.06', () => {
    const speed2 = transportSpeed(2);
    const expected = Math.pow(2, TRANSPORT_EXPONENT);
    expect(speed2).toBeCloseTo(expected, 5);
  });
});

describe('adjustedLookback', () => {
  it('should return baseLookback for J = 1', () => {
    expect(adjustedLookback(1, 50)).toBe(50);
  });

  it('should return shorter lookback for high coupling', () => {
    expect(adjustedLookback(3, 50)).toBeLessThan(50);
  });

  it('should return longer lookback for low coupling', () => {
    expect(adjustedLookback(0.3, 50)).toBeGreaterThan(50);
  });

  it('should clamp to [10, 200]', () => {
    expect(adjustedLookback(100, 50)).toBeGreaterThanOrEqual(10);
    expect(adjustedLookback(0.01, 50)).toBeLessThanOrEqual(200);
  });
});

// ─── Law 3: Refraction — Information Velocity ────────────────────────────────

describe('refractiveIndex', () => {
  it('should match n(J) = 0.481 / J^0.976', () => {
    const j = 2;
    const expected = REFRACTION_AMPLITUDE / Math.pow(j, REFRACTION_EXPONENT);
    expect(refractiveIndex(j)).toBeCloseTo(expected, 5);
  });

  it('should be lower for higher coupling (faster propagation)', () => {
    expect(refractiveIndex(3)).toBeLessThan(refractiveIndex(1));
  });

  it('should return Infinity for J = 0', () => {
    expect(refractiveIndex(0)).toBe(Infinity);
  });
});

describe('signalDelay', () => {
  it('should return shorter delay for higher coupling', () => {
    expect(signalDelay(3)).toBeLessThan(signalDelay(0.5));
  });

  it('should return at least 0', () => {
    expect(signalDelay(10)).toBeGreaterThanOrEqual(0);
  });
});

// ─── Law 4: Anderson Orthogonality ───────────────────────────────────────────

describe('andersonOverlap', () => {
  it('should return 1 for N = 0', () => {
    expect(andersonOverlap(0)).toBe(1.0);
  });

  it('should decay exponentially with system size', () => {
    const o10 = andersonOverlap(10);
    const o20 = andersonOverlap(20);
    expect(o20).toBeLessThan(o10);
    // Should be approximately squared (exp(-0.089*20) ≈ exp(-0.089*10)^2)
    expect(o20).toBeCloseTo(o10 * o10, 2);
  });

  it('should match exp(-0.089 * N)', () => {
    expect(andersonOverlap(10)).toBeCloseTo(Math.exp(-0.089 * 10), 5);
    expect(andersonOverlap(50)).toBeCloseTo(Math.exp(-0.089 * 50), 5);
  });
});

describe('shouldResetStrategies', () => {
  it('should NOT reset for small portfolios (high overlap)', () => {
    // N=5: overlap ≈ 0.64 > 0.1
    expect(shouldResetStrategies(5)).toBe(false);
  });

  it('should reset for large portfolios (low overlap)', () => {
    // N=30: overlap ≈ 0.069 < 0.1
    expect(shouldResetStrategies(30)).toBe(true);
  });

  it('should respect custom threshold', () => {
    // N=10: overlap ≈ 0.41
    expect(shouldResetStrategies(10, 0.5)).toBe(true);
    expect(shouldResetStrategies(10, 0.3)).toBe(false);
  });
});

// ─── Law 5: Bridge — Convergence Budget ──────────────────────────────────────

describe('convergenceBudget', () => {
  it('should match τ = 0.180 × J^0.86', () => {
    const j = 2;
    const expected = BRIDGE_PREFACTOR * Math.pow(j, BRIDGE_EXPONENT);
    expect(convergenceBudget(j)).toBeCloseTo(expected, 5);
  });

  it('should return Infinity for J = 0', () => {
    expect(convergenceBudget(0)).toBe(Infinity);
  });

  it('should increase with coupling', () => {
    expect(convergenceBudget(3)).toBeGreaterThan(convergenceBudget(1));
  });
});

describe('minBacktestCandles', () => {
  it('should scale with convergence budget', () => {
    const candles1 = minBacktestCandles(1);
    const candles3 = minBacktestCandles(3);
    expect(candles3).toBeGreaterThan(candles1);
  });

  it('should return at least 50', () => {
    expect(minBacktestCandles(0.1)).toBeGreaterThanOrEqual(50);
  });
});

// ─── Law 6: Convergence — Scale Independence ────────────────────────────────

describe('isScaleIndependent', () => {
  it('should return true above threshold J_c = 2.5', () => {
    expect(isScaleIndependent(3.0)).toBe(true);
    expect(isScaleIndependent(2.5)).toBe(true);
  });

  it('should return false below threshold', () => {
    expect(isScaleIndependent(2.0)).toBe(false);
    expect(isScaleIndependent(1.0)).toBe(false);
  });
});

describe('computeBudget', () => {
  it('should return baseBudget above threshold (scale independent)', () => {
    expect(computeBudget(3.0, 100, 100)).toBe(100);
    expect(computeBudget(3.0, 10, 100)).toBe(100);
  });

  it('should scale with asset count below threshold', () => {
    const budget10 = computeBudget(1.0, 10, 100);
    const budget100 = computeBudget(1.0, 100, 100);
    expect(budget100).toBeGreaterThan(budget10);
  });
});

// ─── EXP-013: Geometric Fragility ───────────────────────────────────────────

describe('geometricFragility', () => {
  it('should be high when fidelity is high and R² is low', () => {
    const fragility = geometricFragility(0.95, 0.1);
    expect(fragility).toBeGreaterThan(0.8);
  });

  it('should be low when both fidelity and R² are high', () => {
    const fragility = geometricFragility(0.9, 0.9);
    expect(fragility).toBeLessThan(0.15);
  });

  it('should be zero when fidelity is zero', () => {
    expect(geometricFragility(0, 0.5)).toBe(0);
  });

  it('should be zero when R² is 1 (perfect coherence)', () => {
    expect(geometricFragility(0.9, 1.0)).toBeCloseTo(0, 5);
  });

  it('should clamp inputs to [0, 1]', () => {
    expect(geometricFragility(1.5, -0.5)).toBe(1.0 * (1 - 0));
  });
});

// ─── Fisher Information Estimation ──────────────────────────────────────────

describe('estimateFisherInformation', () => {
  it('should return 0 for insufficient data', () => {
    expect(estimateFisherInformation([1, 2, 3])).toBe(0);
  });

  it('should return high FI for low-variance returns', () => {
    const lowVar = Array.from({ length: 50 }, (_, i) => 0.001 * Math.sin(i * 0.1));
    const fi = estimateFisherInformation(lowVar);
    expect(fi).toBeGreaterThan(0);
  });

  it('should return higher FI for lower variance', () => {
    const lowVar = Array.from({ length: 50 }, () => 0.001 * (Math.random() - 0.5));
    const highVar = Array.from({ length: 50 }, () => 0.1 * (Math.random() - 0.5));
    const fiLow = estimateFisherInformation(lowVar);
    const fiHigh = estimateFisherInformation(highVar);
    expect(fiLow).toBeGreaterThan(fiHigh);
  });

  it('should return 0 for zero-variance returns', () => {
    const constant = Array.from({ length: 50 }, () => 0.01);
    expect(estimateFisherInformation(constant)).toBe(0);
  });
});

describe('estimateKappa', () => {
  it('should return 0 for insufficient data', () => {
    expect(estimateKappa([1, 2, 3])).toBe(0);
  });

  it('should return a non-negative value for valid return series', () => {
    const returns = Array.from({ length: 200 }, () => 0.01 * (Math.random() - 0.5));
    const kappa = estimateKappa(returns);
    expect(kappa).toBeGreaterThanOrEqual(0);
  });
});

describe('constitutiveR2', () => {
  it('should return 0 for insufficient data', () => {
    expect(constitutiveR2([1, 2, 3])).toBe(0);
  });

  it('should return a value in [0, 1] for valid data', () => {
    const returns = Array.from({ length: 200 }, () => 0.01 * (Math.random() - 0.5));
    const r2 = constitutiveR2(returns);
    expect(r2).toBeGreaterThanOrEqual(0);
    expect(r2).toBeLessThanOrEqual(1);
  });
});

describe('priceAutocorrelation', () => {
  it('should return ~0.5 for insufficient data', () => {
    expect(priceAutocorrelation([1, 2])).toBe(0.5);
  });

  it('should return a value in [0, 1]', () => {
    const returns = Array.from({ length: 100 }, () => 0.01 * (Math.random() - 0.5));
    const ac = priceAutocorrelation(returns);
    expect(ac).toBeGreaterThanOrEqual(0);
    expect(ac).toBeLessThanOrEqual(1);
  });
});

describe('pairwiseCoupling', () => {
  it('should return 0 for insufficient data', () => {
    expect(pairwiseCoupling([1, 2], [1, 2])).toBe(0);
  });

  it('should return high coupling for correlated series', () => {
    const a = Array.from({ length: 100 }, () => Math.random());
    const b = a.map(x => x + 0.01 * Math.random()); // strongly correlated
    const coupling = pairwiseCoupling(a, b);
    expect(coupling).toBeGreaterThan(2.0);
  });

  it('should return lower coupling for uncorrelated series', () => {
    const a = Array.from({ length: 100 }, () => Math.random());
    const b = Array.from({ length: 100 }, () => Math.random()); // independent
    const coupled = a.map(x => x + 0.01 * Math.random());
    const couplingHigh = pairwiseCoupling(a, coupled);
    const couplingLow = pairwiseCoupling(a, b);
    expect(couplingHigh).toBeGreaterThan(couplingLow);
  });
});
