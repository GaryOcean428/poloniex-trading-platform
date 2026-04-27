import { describe, it, expect } from 'vitest';
import { basinDirection } from '../perception.js';
import { BASIN_DIM, toSimplex, type Basin } from '../basin.js';

/**
 * Regression tests for the 2026-04-24 basinDirection saturation bug.
 * Pre-fix, the function subtracted 0.5 from each post-simplex dim, which
 * was correct for raw-sigmoid values but pushed every output to ≈ −1.0
 * after perceive() applied toSimplex() — basin scalar pegged for 21,458
 * consecutive ticks in production, killing DRIFT mode and biasing all
 * overrides to SHORT.
 *
 * The fixed function compares simplex mass in dims 7..14 to its uniform-
 * distribution baseline (8/BASIN_DIM). At nominal flat-momentum input
 * (raw 0.5 per dim) the function returns ≈ 0.0; bullish raw input pulls
 * it positive, bearish negative.
 */

function makeBasin(setter: (v: Float64Array) => void): Basin {
  const v = new Float64Array(BASIN_DIM);
  for (let i = 0; i < BASIN_DIM; i++) v[i] = 0.5;  // neutral baseline
  setter(v);
  return toSimplex(v);
}

describe('basinDirection — post-simplex correctness', () => {
  it('reads ≈ 0 for a uniform basin', () => {
    const uniform: Basin = new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
    expect(Math.abs(basinDirection(uniform))).toBeLessThan(1e-9);
  });

  it('reads ≈ 0 for a flat-momentum basin (raw 0.5 in dims 7..14)', () => {
    const flat = makeBasin(() => { /* all 0.5, no overrides */ });
    // Post-simplex, dims 7..14 each hold ≈ 1/BASIN_DIM. Sum ≈ 0.125.
    // (momMass − 0.125) * 16 ≈ 0 → tanh(0) = 0.
    expect(Math.abs(basinDirection(flat))).toBeLessThan(0.05);
  });

  it('reads strongly positive for a bullish basin', () => {
    // Raw momentum dims at 0.9 (sigmoid output for a meaningful uptrend).
    const bull = makeBasin((v) => {
      for (let i = 7; i <= 14; i++) v[i] = 0.9;
    });
    const d = basinDirection(bull);
    expect(d).toBeGreaterThan(0.3);
    expect(d).toBeLessThanOrEqual(1.0);
  });

  it('reads strongly negative for a bearish basin', () => {
    // Raw momentum dims at 0.1 (sigmoid output for a meaningful downtrend).
    const bear = makeBasin((v) => {
      for (let i = 7; i <= 14; i++) v[i] = 0.1;
    });
    const d = basinDirection(bear);
    expect(d).toBeLessThan(-0.3);
    expect(d).toBeGreaterThanOrEqual(-1.0);
  });

  it('symmetric — equal-magnitude bull and bear opposite signs', () => {
    const bull = makeBasin((v) => { for (let i = 7; i <= 14; i++) v[i] = 0.8; });
    const bear = makeBasin((v) => { for (let i = 7; i <= 14; i++) v[i] = 0.2; });
    const dBull = basinDirection(bull);
    const dBear = basinDirection(bear);
    expect(dBull).toBeGreaterThan(0);
    expect(dBear).toBeLessThan(0);
    // Symmetry around 0 (within tolerance — the simplex baseline is the
    // same for both, the raw input deviation is symmetric, so the post-
    // simplex deviations are symmetric in linear regime; tanh preserves
    // sign perfectly even past saturation).
    expect(Math.abs(dBull + dBear)).toBeLessThan(0.1);
  });

  it('REGRESSION: post-simplex uniform basin does NOT return −1.0', () => {
    // The original bug: basinDirection of a uniform simplex returned
    // tanh((1/64 − 0.5) * 8 * 2) = tanh(−7.75) ≈ −1.0. Lock that in.
    const uniform: Basin = new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
    const d = basinDirection(uniform);
    expect(d).not.toBeLessThan(-0.5);
  });

  it('REGRESSION: production basin shape (post-simplex) reads ≈ 0', () => {
    // Recreate the production-observed shape: dims 7..14 each ≈ 0.020,
    // total simplex mass ≈ 1.0, rest of dims share remainder.
    const v = new Float64Array(BASIN_DIM).fill(0.0156);
    for (let i = 7; i <= 14; i++) v[i] = 0.020;  // slight over-uniform
    // Renormalize manually (these are already simplex-shaped values)
    let s = 0;
    for (let i = 0; i < BASIN_DIM; i++) s += v[i];
    for (let i = 0; i < BASIN_DIM; i++) v[i] /= s;
    // Pre-fix this would have returned ≈ −1.0; post-fix ≈ +0.X.
    const d = basinDirection(v as unknown as Basin);
    expect(d).toBeGreaterThan(-0.5);
    expect(d).toBeGreaterThan(0);  // slight bull because 0.020 > 1/64
  });
});
