/**
 * forge.test.ts — TS parity for Tier 8 Forge.
 */
import { describe, it, expect } from 'vitest';
import { BASIN_DIM, type Basin } from '../basin.js';
import {
  decompress,
  dissipate,
  forge,
  fracture,
  nucleate,
  type ShadowEvent,
} from '../forge.js';

const peakBasin = (idx = 5, mass = 0.6): Basin => {
  const rest = (1 - mass) / (BASIN_DIM - 1);
  const arr = new Array(BASIN_DIM).fill(rest);
  arr[idx] = mass;
  return Float64Array.from(arr);
};

const shadow = (pnl = -0.5, idx = 5, mass = 0.6): ShadowEvent => ({
  basin: peakBasin(idx, mass),
  phi: 0.45,
  kappa: 68,
  realizedPnl: pnl,
  regimeWeights: { quantum: 0.4, efficient: 0.3, equilibrium: 0.3 },
});

const APPROX = (got: number, want: number, abs = 1e-12) =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(abs);

const sumOf = (b: Basin): number => b.reduce((a, x) => a + x, 0);

// ─── DECOMPRESS ────────────────────────────────────────────────────

describe('decompress', () => {
  it('returns copied basin', () => {
    const original = shadow();
    const out = decompress(original);
    out.basin[0] = 0.99;
    expect(original.basin[0]).not.toBe(0.99);
  });

  it('preserves scalar fields', () => {
    const original = shadow(-1.2);
    const out = decompress(original);
    expect(out.phi).toBe(original.phi);
    expect(out.kappa).toBe(original.kappa);
    expect(out.realizedPnl).toBe(original.realizedPnl);
  });
});

// ─── FRACTURE ──────────────────────────────────────────────────────

describe('fracture', () => {
  it('captures all invariants', () => {
    const f = fracture(shadow());
    expect(f.invariants).toHaveProperty('shape_concentration');
    expect(f.invariants).toHaveProperty('shape_dispersion');
    expect(f.invariants).toHaveProperty('phi_band');
    expect(f.invariants).toHaveProperty('kappa_offset');
    expect(f.invariants).toHaveProperty('regime_quantum');
    expect(f.invariants).toHaveProperty('regime_equilibrium');
    expect(f.invariants).toHaveProperty('loss_magnitude');
  });

  it('shape_concentration is max mass', () => {
    APPROX(fracture(shadow(-0.5, 10, 0.7)).invariants.shape_concentration, 0.7);
  });

  it('kappa_offset is relative to anchor 64', () => {
    const ev = { ...shadow(), kappa: 70 };
    APPROX(fracture(ev).invariants.kappa_offset, 6);
  });

  it('loss_magnitude is absolute', () => {
    APPROX(fracture(shadow(-0.85)).invariants.loss_magnitude, 0.85);
  });
});

// ─── NUCLEATE ──────────────────────────────────────────────────────

describe('nucleate', () => {
  it('canonicalises peak to index 0', () => {
    const f = fracture(shadow(-0.5, 37, 0.75));
    const n = nucleate(f);
    APPROX(n.basin[0], 0.75);
    expect(n.basin[37]).not.toBeCloseTo(0.75);
  });

  it('nucleus is simplex-valid', () => {
    const n = nucleate(fracture(shadow()));
    APPROX(sumOf(n.basin), 1.0, 1e-9);
    expect(n.basin.every((x) => x >= 0)).toBe(true);
  });

  it('preserves shape_concentration invariant', () => {
    const n = nucleate(fracture(shadow(-0.5, 5, 0.55)));
    let max = 0;
    for (let i = 0; i < n.basin.length; i++) if (n.basin[i] > max) max = n.basin[i];
    APPROX(max, 0.55);
  });
});

// ─── DISSIPATE ─────────────────────────────────────────────────────

describe('dissipate', () => {
  it('returns uniform basin', () => {
    const original = shadow();
    const f = fracture(original);
    const n = nucleate(f);
    const d = dissipate(original, n);
    const expected = 1 / BASIN_DIM;
    expect(d.basin.every((x) => Math.abs(x - expected) < 1e-12)).toBe(true);
  });

  it('invariants persist through dissipate', () => {
    const original = shadow();
    const f = fracture(original);
    const n = nucleate(f);
    const d = dissipate(original, n);
    expect(d.invariants).toEqual(n.invariants);
  });
});

// ─── Full cycle ───────────────────────────────────────────────────

describe('forge full cycle', () => {
  it('returns full result for losing trade', () => {
    const r = forge(shadow(-0.5));
    expect(r.lessonSummary).not.toHaveProperty('skipped');
    APPROX(r.lessonSummary.loss_magnitude as number, 0.5);
  });

  it('skips positive pnl', () => {
    const r = forge(shadow(+0.3));
    expect(r.lessonSummary.skipped).toBe(true);
  });

  it('lesson summary carries all invariants', () => {
    const r = forge(shadow(-0.7, 12, 0.65));
    APPROX(r.lessonSummary.loss_magnitude as number, 0.7);
    APPROX(r.lessonSummary.shape_concentration as number, 0.65);
    expect(r.lessonSummary.nucleated_peak_index).toBe(0);
  });
});
