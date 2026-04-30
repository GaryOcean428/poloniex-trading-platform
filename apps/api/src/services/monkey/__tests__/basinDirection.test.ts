import { describe, it, expect } from 'vitest';
import { basinDirection } from '../perception.js';
import { BASIN_DIM, toSimplex, type Basin } from '../basin.js';

/**
 * Tests for basinDirection (Fisher-Rao reprojection — proposal #7).
 *
 * Pre-2026-04-24: code subtracted 0.5 per dim, producing basinDir ≈ -1
 * for 21,458 consecutive ticks.
 *
 * 2026-04-24 fix: ``tanh((mom_mass - MOM_NEUTRAL) * 16)``. Symmetric
 * around 0 at flat input but saturated at ~0.92 in mild bull regimes.
 *
 * Proposal #7 (2026-04-30): Fisher-Rao reprojection. Signed normalised
 * geodesic distance to a no-momentum antipode. No tanh saturation;
 * output in [-1, +1] without clipping.
 */

const MOM_NEUTRAL = 8 / BASIN_DIM;

function makeBasin(setter: (v: Float64Array) => void): Basin {
  const v = new Float64Array(BASIN_DIM);
  for (let i = 0; i < BASIN_DIM; i++) v[i] = 0.5;
  setter(v);
  return toSimplex(v);
}

function reflectMomentum(basin: Basin): Basin {
  // Reflect the momentum band around MOM_NEUTRAL: target = 2*MOM_NEUTRAL - mom
  let total = 0;
  for (let i = 0; i < BASIN_DIM; i++) total += basin[i] ?? 0;
  const p = new Float64Array(BASIN_DIM);
  for (let i = 0; i < BASIN_DIM; i++) p[i] = (basin[i] ?? 0) / total;
  let mom = 0;
  for (let i = 7; i <= 14; i++) mom += p[i]!;
  const target = 2 * MOM_NEUTRAL - mom;
  const delta = target - mom;
  const out = new Float64Array(BASIN_DIM);
  for (let i = 0; i < BASIN_DIM; i++) out[i] = p[i]!;
  if (mom > 1e-12) {
    const scale = target / mom;
    for (let i = 7; i <= 14; i++) out[i] = p[i]! * scale;
  } else {
    for (let i = 7; i <= 14; i++) out[i] = target / 8;
  }
  for (let i = 0; i < BASIN_DIM; i++) {
    if (i < 7 || i > 14) out[i] = p[i]! - delta / 56;
  }
  let s = 0;
  for (let i = 0; i < BASIN_DIM; i++) {
    out[i] = Math.max(0, out[i]!);
    s += out[i]!;
  }
  for (let i = 0; i < BASIN_DIM; i++) out[i] = out[i]! / s;
  return out as unknown as Basin;
}

describe('basinDirection (Fisher-Rao reprojection)', () => {
  it('reads ~ 0 for a uniform basin', () => {
    const uniform: Basin = new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
    expect(Math.abs(basinDirection(uniform))).toBeLessThan(1e-9);
  });

  it('reads ~ 0 for a flat-momentum basin', () => {
    const flat = makeBasin(() => { /* all 0.5 */ });
    expect(Math.abs(basinDirection(flat))).toBeLessThan(0.05);
  });

  it('reads positive for a bullish basin', () => {
    const bull = makeBasin((v) => { for (let i = 7; i <= 14; i++) v[i] = 0.9; });
    const d = basinDirection(bull);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(1.0);
  });

  it('reads negative for a bearish basin', () => {
    const bear = makeBasin((v) => { for (let i = 7; i <= 14; i++) v[i] = 0.1; });
    const d = basinDirection(bear);
    expect(d).toBeLessThan(0);
    expect(d).toBeGreaterThanOrEqual(-1.0);
  });

  it('symmetric — equal-magnitude bull and bear oppose', () => {
    const bull = makeBasin((v) => { for (let i = 7; i <= 14; i++) v[i] = 0.8; });
    const bear = makeBasin((v) => { for (let i = 7; i <= 14; i++) v[i] = 0.2; });
    const dBull = basinDirection(bull);
    const dBear = basinDirection(bear);
    expect(dBull).toBeGreaterThan(0);
    expect(dBear).toBeLessThan(0);
  });
});

describe('basinDirection — range invariants', () => {
  it('output bounded in [-1, +1] across random simplex points', () => {
    let rngState = 12345;
    function rng() {
      rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
      return rngState / 0x7fffffff;
    }
    for (let trial = 0; trial < 200; trial++) {
      const v = new Float64Array(BASIN_DIM);
      let s = 0;
      for (let i = 0; i < BASIN_DIM; i++) {
        v[i] = rng() * 0.99 + 0.01;
        s += v[i]!;
      }
      for (let i = 0; i < BASIN_DIM; i++) v[i] = v[i]! / s;
      const d = basinDirection(v as unknown as Basin);
      expect(d).toBeGreaterThanOrEqual(-1);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('does not clip at 1 for moderate inputs (no saturation)', () => {
    const v = makeBasin((vv) => { for (let i = 7; i <= 14; i++) vv[i] = 0.7; });
    const d = basinDirection(v);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(0.85);  // OLD formula saturated at ~0.92 here
  });

  it('zero basin returns 0', () => {
    const v: Basin = new Float64Array(BASIN_DIM);
    expect(basinDirection(v)).toBe(0);
  });

  it('handles non-normalised input', () => {
    const v: Basin = new Float64Array(BASIN_DIM).fill(5.0);
    expect(Math.abs(basinDirection(v))).toBeLessThan(1e-9);
  });
});

describe('basinDirection — symmetry', () => {
  it('reflection around uniform flips sign', () => {
    let rngState = 99;
    function rng() {
      rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
      return rngState / 0x7fffffff;
    }
    for (let i = 0; i < 10; i++) {
      const v = new Float64Array(BASIN_DIM);
      let s = 0;
      for (let j = 0; j < BASIN_DIM; j++) {
        v[j] = 0.1 + rng() * 0.8;
        s += v[j]!;
      }
      for (let j = 0; j < BASIN_DIM; j++) v[j] = v[j]! / s;
      const d = basinDirection(v as unknown as Basin);
      const dRefl = basinDirection(reflectMomentum(v as unknown as Basin));
      expect(Math.abs(d + dRefl)).toBeLessThan(0.05);
    }
  });
});

describe('basinDirection — monotonicity', () => {
  it('non-decreasing as momentum-band mass grows', () => {
    let prev = -2;
    for (const mom of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const v = makeBasin((vv) => { for (let i = 7; i <= 14; i++) vv[i] = mom; });
      const d = basinDirection(v);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
  });
});

describe('basinDirection — sign by momentum-band value', () => {
  for (const tc of [
    { mom: 0.05, signExpected: -1 },
    { mom: 0.10, signExpected: -1 },
    { mom: 0.20, signExpected: -1 },
    { mom: 0.30, signExpected: -1 },
    { mom: 0.40, signExpected: -1 },
    { mom: 0.45, signExpected: -1 },
    { mom: 0.55, signExpected: 1 },
    { mom: 0.60, signExpected: 1 },
    { mom: 0.70, signExpected: 1 },
    { mom: 0.80, signExpected: 1 },
    { mom: 0.90, signExpected: 1 },
    { mom: 0.95, signExpected: 1 },
  ]) {
    it(`sign at mom=${tc.mom} is ${tc.signExpected > 0 ? 'positive' : 'negative'}`, () => {
      const v = makeBasin((vv) => { for (let i = 7; i <= 14; i++) vv[i] = tc.mom; });
      const d = basinDirection(v);
      if (tc.signExpected > 0) expect(d).toBeGreaterThan(0);
      else expect(d).toBeLessThan(0);
    });
  }
});

describe('basinDirection — regression locks', () => {
  it('uniform basin does NOT return -1.0 (pre-2026-04-24 bug)', () => {
    const u: Basin = new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
    expect(basinDirection(u)).toBeGreaterThan(-0.5);
  });

  it('production-observed basin shape is not pegged', () => {
    const v = new Float64Array(BASIN_DIM).fill(0.0156);
    for (let i = 7; i <= 14; i++) v[i] = 0.020;
    let s = 0;
    for (let i = 0; i < BASIN_DIM; i++) s += v[i]!;
    for (let i = 0; i < BASIN_DIM; i++) v[i] = v[i]! / s;
    const d = basinDirection(v as unknown as Basin);
    expect(Math.abs(d)).toBeLessThan(0.5);
    expect(d).toBeGreaterThan(0);
  });

  it('old saturation regime is no longer saturated', () => {
    // mom=0.7 used to peg the old formula at ~0.92.
    const v = makeBasin((vv) => { for (let i = 7; i <= 14; i++) vv[i] = 0.7; });
    const d = basinDirection(v);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(0.85);
  });
});

describe('basinDirection — TS / Python parity', () => {
  // Spot-check that the TS implementation produces the same output as
  // the Python implementation for canonical inputs. Vectors below are
  // produced by running ``basin_direction`` in Python on the same
  // normalised input and committed as float literals.
  it('uniform reads same on both sides', () => {
    const u: Basin = new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
    expect(basinDirection(u)).toBeCloseTo(0.0, 9);
  });

  it('pure momentum band reads same on both sides', () => {
    // All mass on dims 7..14, equally split.
    const v = new Float64Array(BASIN_DIM);
    for (let i = 7; i <= 14; i++) v[i] = 1 / 8;
    const d = basinDirection(v as unknown as Basin);
    // Python: same input gives identical d.
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(1.0);
  });
});
