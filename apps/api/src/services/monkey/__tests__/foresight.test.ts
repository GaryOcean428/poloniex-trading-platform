/**
 * foresight.test.ts — TS parity for Tier 3 P8 trajectory predictor.
 *
 * Mirrors test_foresight.py 1:1 — same trajectories, same expected
 * regime weights, same simplex-validity guarantees.
 */
import { describe, it, expect } from 'vitest';
import { BASIN_DIM, fisherRao, type Basin } from '../basin.js';
import { ForesightPredictor } from '../foresight.js';

const uniform = (): Basin => Float64Array.from(new Array(BASIN_DIM).fill(1 / BASIN_DIM));

const peak = (idx = 0, mass = 0.9): Basin => {
  const rest = (1 - mass) / (BASIN_DIM - 1);
  const arr = new Array(BASIN_DIM).fill(rest);
  arr[idx] = mass;
  return Float64Array.from(arr);
};

const interp = (p: Basin, q: Basin, t: number): Basin => {
  const out = new Float64Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = (1 - t) * p[i] + t * q[i];
  // Renormalise (already simplex but be defensive)
  const sum = out.reduce((a, b) => a + b, 0);
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
};

const sumOf = (b: Basin): number => b.reduce((a, x) => a + x, 0);
const allNonNeg = (b: Basin, eps = 1e-9): boolean => b.every((x) => x >= -eps);

// ─── Cold start ───────────────────────────────────────────────────

describe('Cold start', () => {
  it('empty trajectory returns weight 0', () => {
    const p = new ForesightPredictor();
    const r = p.predict({ equilibrium: 0 });
    expect(r.weight).toBe(0);
    expect(r.confidence).toBe(0);
    expect(r.predictedBasin.every((x) => x === 0)).toBe(true);
  });

  it('two ticks still too cold', () => {
    const p = new ForesightPredictor();
    p.append(uniform(), 0.5, 0);
    p.append(uniform(), 0.5, 1000);
    const r = p.predict({ equilibrium: 0 });
    expect(r.weight).toBe(0);
  });
});

// ─── Confidence from smoothness ──────────────────────────────────

describe('Confidence', () => {
  it('steady-state trajectory gives confidence ≈ 1', () => {
    const p = new ForesightPredictor();
    const b = uniform();
    for (let i = 0; i < 5; i++) p.append(b, 0.5, i * 1000);
    const r = p.predict({ equilibrium: 0 });
    expect(r.confidence).toBeCloseTo(1.0, 9);
  });

  it('jittery trajectory yields lower confidence than smooth', () => {
    const a = uniform();
    const c = peak(0, 0.6);
    const pSmooth = new ForesightPredictor();
    const pJittery = new ForesightPredictor();
    // Smooth: equal-step interpolation → constant pairwise distances
    for (let i = 0; i < 6; i++) pSmooth.append(interp(a, c, i / 5), 0.5, i * 1000);
    // Jittery: irregular step sizes → varying pairwise distances
    [0.0, 0.05, 0.5, 0.55, 0.95, 1.0].forEach((t, i) =>
      pJittery.append(interp(a, c, t), 0.5, i * 1000),
    );
    const rs = pSmooth.predict({ equilibrium: 0 });
    const rj = pJittery.predict({ equilibrium: 0 });
    expect(rs.confidence).toBeGreaterThan(rj.confidence);
  });
});

// ─── Geodesic prediction ─────────────────────────────────────────

describe('Prediction', () => {
  it('steady basin predicts ≈ last basin', () => {
    const p = new ForesightPredictor();
    const b = uniform();
    for (let i = 0; i < 4; i++) p.append(b, 0.5, i * 1000);
    const r = p.predict({ equilibrium: 0 });
    expect(fisherRao(r.predictedBasin, b)).toBeLessThan(1e-6);
  });

  it('smooth drift extends along the direction', () => {
    const a = uniform();
    const c = peak(0, 0.6);
    const p = new ForesightPredictor();
    for (let i = 0; i < 5; i++) p.append(interp(a, c, i / 4), 0.5, i * 1000);
    const r = p.predict({ equilibrium: 0 });
    const lastMass = interp(a, c, 1.0)[0];
    expect(r.predictedBasin[0]).toBeGreaterThanOrEqual(lastMass - 1e-9);
    expect(sumOf(r.predictedBasin)).toBeCloseTo(1.0, 9);
    expect(allNonNeg(r.predictedBasin)).toBe(true);
  });
});

// ─── Simplex validity ────────────────────────────────────────────

describe('Simplex validity', () => {
  // Deterministic basins from a small set of mass placements
  const fixtures: Basin[] = [
    peak(0, 0.5),
    peak(7, 0.4),
    peak(20, 0.7),
    peak(15, 0.3),
    peak(40, 0.6),
  ];
  it('predicted basin is simplex-valid for a deterministic trajectory', () => {
    const p = new ForesightPredictor();
    fixtures.forEach((b, i) => p.append(b, 0.5, i * 1000));
    const r = p.predict({ equilibrium: 0 });
    expect(sumOf(r.predictedBasin)).toBeCloseTo(1.0, 6);
    expect(allNonNeg(r.predictedBasin)).toBe(true);
  });
});

// ─── Regime weight per P8 ────────────────────────────────────────

const predictWith = (phi: number, eq = 0) => {
  const p = new ForesightPredictor();
  for (let i = 0; i < 4; i++) p.append(uniform(), phi, i * 1000);
  return p.predict({ equilibrium: eq, quantum: 1 - eq, efficient: 0 });
};

describe('Regime-adaptive weight (P8)', () => {
  it('linear regime (phi<0.3) yields 0.1', () => {
    expect(predictWith(0.1).weight).toBeCloseTo(0.1, 9);
  });
  it('geometric regime (phi≥0.3) yields 0.7 × confidence', () => {
    expect(predictWith(0.7).weight).toBeCloseTo(0.7, 9);
  });
  it('breakdown signature (eq>0.7 AND phi<0.3) yields 0.2', () => {
    expect(predictWith(0.1, 0.85).weight).toBeCloseTo(0.2, 9);
  });
  it('breakdown takes precedence over linear', () => {
    expect(predictWith(0.1, 0.5).weight).toBeCloseTo(0.1, 9);
    expect(predictWith(0.1, 0.85).weight).toBeCloseTo(0.2, 9);
  });
  it('high phi unaffected by equilibrium', () => {
    expect(predictWith(0.5, 0.85).weight).toBeCloseTo(0.7, 9);
  });
});

// ─── Trajectory bounds + reset ───────────────────────────────────

describe('Trajectory management', () => {
  it('maxTrajectory caps the deque', () => {
    const p = new ForesightPredictor(5);
    for (let i = 0; i < 20; i++) p.append(uniform(), 0.5, i);
    expect(p.trajectoryLength).toBe(5);
  });

  it('reset clears the trajectory', () => {
    const p = new ForesightPredictor();
    for (let i = 0; i < 5; i++) p.append(uniform(), 0.5, i);
    p.reset();
    expect(p.trajectoryLength).toBe(0);
    expect(p.predict({ equilibrium: 0 }).weight).toBe(0);
  });
});

// ─── Horizon ─────────────────────────────────────────────────────

describe('Horizon', () => {
  it('uniform intervals yield that horizon', () => {
    const p = new ForesightPredictor();
    for (let i = 0; i < 5; i++) p.append(uniform(), 0.5, i * 1000);
    expect(p.predict({ equilibrium: 0 }).horizonMs).toBeCloseTo(1000, 9);
  });
});
