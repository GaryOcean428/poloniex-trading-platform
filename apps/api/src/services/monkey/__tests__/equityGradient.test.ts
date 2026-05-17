import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeEquityGradient,
  observeEquity,
  sizeDeflection,
  _resetEquityGradient,
  _peekEquityBuffer,
} from '../equity_gradient.js';

describe('computeEquityGradient — pure derivation', () => {
  it('returns warmup with n=0 / values=0 on empty input', () => {
    const r = computeEquityGradient([]);
    expect(r.warmup).toBe(true);
    expect(r.gradient).toBe(0);
    expect(r.acceleration).toBe(0);
    expect(r.n).toBe(0);
  });

  it('returns warmup on single sample (n < MIN_SAMPLES=2)', () => {
    const r = computeEquityGradient([100]);
    expect(r.warmup).toBe(true);
    expect(r.gradient).toBe(0);
  });

  it('positive gradient when equity rising linearly', () => {
    const r = computeEquityGradient([100, 102]);
    expect(r.warmup).toBe(false);
    expect(r.gradient).toBeGreaterThan(0);
    expect(r.n).toBe(2);
  });

  it('negative gradient when equity falling linearly', () => {
    const r = computeEquityGradient([100, 98]);
    expect(r.gradient).toBeLessThan(0);
  });

  it('flat equity yields gradient = 0', () => {
    const r = computeEquityGradient([100, 100, 100, 100]);
    expect(r.gradient).toBe(0);
  });

  it('acceleration is near-zero when slope is constant (linear bleed)', () => {
    // Linear decline at -1 per sample. The relative gradient gets
    // slightly more negative as equity drops (the denominator shrinks)
    // — that's an expected artefact of normalising by the per-half
    // first value. The acceleration is small but not exactly zero.
    const r = computeEquityGradient([100, 99, 98, 97, 96, 95, 94, 93]);
    expect(Math.abs(r.acceleration)).toBeLessThan(0.001);
    expect(r.gradient).toBeLessThan(0);
  });

  it('acceleration is negative when loss is accelerating', () => {
    // Second half declines faster than first half.
    const r = computeEquityGradient([100, 99.5, 99, 98.5, 98, 97, 96, 94]);
    expect(r.acceleration).toBeLessThan(0);  // second-half slope < first-half slope (more negative)
  });

  it('acceleration is positive when loss is decelerating (recovering)', () => {
    // First half steep loss, second half slower or recovering.
    const r = computeEquityGradient([100, 95, 90, 85, 84, 84, 84, 84]);
    expect(r.acceleration).toBeGreaterThan(0);
  });

  it('window cap respected — only the trailing N samples used', () => {
    const longSeries = Array.from({ length: 100 }, (_, i) => 100 - i * 0.1);
    const last30 = longSeries.slice(-30);
    const r = computeEquityGradient(longSeries, 30);
    const direct = computeEquityGradient(last30, 30);
    expect(r.gradient).toBeCloseTo(direct.gradient, 9);
    expect(r.acceleration).toBeCloseTo(direct.acceleration, 9);
    expect(r.n).toBe(30);
  });

  it('handles negative equity without sign-flipping the rate', () => {
    // Pathological: equity went from -10 to -20 (loss got bigger).
    // The rate of "getting worse" should still be negative even
    // though the denominator was negative.
    const r = computeEquityGradient([-10, -20]);
    expect(r.gradient).toBeLessThan(0);
  });
});

describe('observeEquity — per-key rolling buffer', () => {
  beforeEach(() => {
    _resetEquityGradient();
  });

  it('separate keys keep independent buffers', () => {
    observeEquity('user_A', 100);
    observeEquity('user_B', 200);
    observeEquity('user_A', 105);
    expect(_peekEquityBuffer('user_A')).toEqual([100, 105]);
    expect(_peekEquityBuffer('user_B')).toEqual([200]);
  });

  it('returns gradient after enough samples accumulate', () => {
    const r1 = observeEquity('test', 100);
    expect(r1.warmup).toBe(true);
    const r2 = observeEquity('test', 101);
    expect(r2.warmup).toBe(false);
    expect(r2.gradient).toBeGreaterThan(0);
  });

  it('buffer is capped at MAX_BUFFER (500)', () => {
    for (let i = 0; i < 600; i++) {
      observeEquity('cap', 100 + i);
    }
    expect(_peekEquityBuffer('cap').length).toBe(500);
    // Oldest entries dropped — first one should be 100 + (600-500) = 200
    expect(_peekEquityBuffer('cap')[0]).toBe(200);
  });

  it('_resetEquityGradient(key) clears a single buffer', () => {
    observeEquity('A', 100);
    observeEquity('B', 100);
    _resetEquityGradient('A');
    expect(_peekEquityBuffer('A')).toHaveLength(0);
    expect(_peekEquityBuffer('B')).toHaveLength(1);
  });

  it('_resetEquityGradient() with no arg clears all buffers', () => {
    observeEquity('A', 100);
    observeEquity('B', 100);
    _resetEquityGradient();
    expect(_peekEquityBuffer('A')).toHaveLength(0);
    expect(_peekEquityBuffer('B')).toHaveLength(0);
  });
});

describe('sizeDeflection — SENSE-3 Phase 2 size modulator', () => {
  it('returns 1.0 (neutral) during warmup', () => {
    const r = computeEquityGradient([100]);  // n < MIN_SAMPLES
    expect(sizeDeflection(r)).toBe(1.0);
  });

  it('returns 1.0 when equity is rising (gradient > 0)', () => {
    const r = computeEquityGradient([100, 101, 102, 103, 104, 105]);
    expect(sizeDeflection(r)).toBe(1.0);
  });

  it('returns 1.0 when loss is decelerating (acceleration > 0)', () => {
    const r = computeEquityGradient([100, 95, 90, 85, 84, 84, 84, 84]);
    expect(r.gradient).toBeLessThan(0);
    expect(r.acceleration).toBeGreaterThan(0);
    expect(sizeDeflection(r)).toBe(1.0);
  });

  it('returns < 1.0 when loss is accelerating (both gradient and acceleration negative)', () => {
    const r = computeEquityGradient([100, 99.5, 99, 98.5, 98, 97, 96, 94]);
    expect(r.gradient).toBeLessThan(0);
    expect(r.acceleration).toBeLessThan(0);
    expect(sizeDeflection(r)).toBeLessThan(1.0);
  });

  it('is floored at SIZE_FLOOR=0.5 even under extreme acceleration', () => {
    // Make |acceleration| >> |gradient| → tanh(very large) → 1
    // → multiplier = 1 - 0.5*1 = 0.5
    const r = computeEquityGradient([100, 99.99, 99.98, 99.97, 80, 60, 40, 0]);
    expect(sizeDeflection(r)).toBeGreaterThanOrEqual(0.5);
    expect(sizeDeflection(r)).toBeCloseTo(0.5, 1);
  });

  it('output is monotonic in acceleration severity (more-negative accel → smaller multiplier)', () => {
    const mild = computeEquityGradient([100, 99.5, 99, 98.5, 98, 97.5, 97, 96.5]);
    const harsh = computeEquityGradient([100, 99.5, 99, 98.5, 98, 96, 94, 90]);
    expect(mild.acceleration).toBeLessThan(0);
    expect(harsh.acceleration).toBeLessThan(0);
    expect(Math.abs(harsh.acceleration)).toBeGreaterThan(Math.abs(mild.acceleration));
    expect(sizeDeflection(harsh)).toBeLessThanOrEqual(sizeDeflection(mild));
  });
});

describe('SENSE-3 reference scenario — chop-zone bleed pattern', () => {
  beforeEach(() => _resetEquityGradient());

  it('detects an accelerating drawdown over a 1.5h window of mini-losses', () => {
    // Reproduces the 2026-05-17 CSV pattern at coarse scale: 30
    // realized PnL events over 1.5h, accelerating second half.
    // Each sample is the equity AFTER that event.
    const equity: number[] = [100];
    // First 15 mini-trades: small chop, slight loss (avg -0.005 each)
    for (let i = 0; i < 15; i++) equity.push(equity[equity.length - 1]! - 0.005);
    // Next 15 mini-trades: same direction, slightly worse on average
    for (let i = 0; i < 15; i++) equity.push(equity[equity.length - 1]! - 0.012);
    const r = computeEquityGradient(equity, 30);
    expect(r.warmup).toBe(false);
    expect(r.gradient).toBeLessThan(0);              // bleeding
    expect(r.acceleration).toBeLessThan(0);          // accelerating
  });
});
