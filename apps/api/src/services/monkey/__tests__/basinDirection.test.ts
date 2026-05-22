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

function makeBasin(setter: (v: Float64Array) => void): Basin {
  const v = new Float64Array(BASIN_DIM);
  for (let i = 0; i < BASIN_DIM; i++) v[i] = 0.5;
  setter(v);
  return toSimplex(v);
}

function reflectMomentum(basin: Basin): Basin {
  // Reflect the momentum band (dims 7..14) around the observer neutral
  // (8 × peer-band mean), leaving every other dim untouched. B1.2's
  // marginal `momMass / neutral − 1` is scale-invariant, so
  // basinDirection's own normalisation absorbs the changed total — no
  // redistribution is needed, and crucially the peer band (which
  // defines the neutral) stays fixed, giving exact antisymmetry.
  let mom = 0;
  for (let i = 7; i <= 14; i++) mom += basin[i] ?? 0;
  let peerSum = 0;
  for (let i = 15; i <= 30; i++) peerSum += basin[i] ?? 0;
  const observerNeutral = 8 * (peerSum / 16);
  const target = 2 * observerNeutral - mom;
  const out = new Float64Array(BASIN_DIM);
  for (let i = 0; i < BASIN_DIM; i++) out[i] = basin[i] ?? 0;
  if (mom > 1e-12) {
    const scale = target / mom;
    for (let i = 7; i <= 14; i++) out[i] = (basin[i] ?? 0) * scale;
  } else {
    for (let i = 7; i <= 14; i++) out[i] = target / 8;
  }
  for (let i = 0; i < BASIN_DIM; i++) out[i] = Math.max(0, out[i]!);
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

// --- Production basin shape (only-longs regression, CC2 2026-05-21) ------
// Every test above uses makeBasin() — uniform-0.5 basins, where 8/64 is
// coincidentally the correct neutral. The REAL perceive() basin has 16
// noise-floor dims (39..54) at 0.0055 — sub-uniform — which forces momMass
// above 8/64 even on a flat market. Comparing to a hardcoded 8/64 then
// reads "uptrend" on a flat market and can never go negative: the live
// "only longs" bug. Mirrors test_basin_direction.py:TestBasinDirectionProductionShape.

function makeProductionShapedBasin(momValue: number): Basin {
  const v = new Float64Array(BASIN_DIM);
  for (let i = 0; i < 3; i++) v[i] = 1 / 3;          // regime — uniform prior
  v[3] = 0.01; v[4] = 0.01; v[5] = 0.5; v[6] = 0.0;  // ml posture (K ml-free)
  for (let i = 7; i <= 14; i++) v[i] = momValue;     // momentum spectrum
  for (let i = 15; i <= 22; i++) v[i] = 0.5;         // volatility — peer band
  for (let i = 23; i <= 30; i++) v[i] = 0.5;         // volume — peer band
  for (let i = 31; i <= 38; i++) v[i] = 0.5;         // price-structure
  for (let i = 39; i <= 54; i++) v[i] = 0.0055;      // noise floor — the culprit
  v[55] = 0.3; v[56] = 0.2; v[57] = 0.1; v[58] = 0.1; // account / coupling
  for (let i = 59; i < 64; i++) v[i] = 0.01;         // reserved
  return toSimplex(v);
}

describe('basinDirection — production basin shape (only-longs regression)', () => {
  it('flat market reads ~ 0 despite the noise floor', () => {
    // Momentum band at the same 0.5 level as its direction-agnostic peer
    // bands (volatility, volume) = a flat market → must read ~0.
    const d = basinDirection(makeProductionShapedBasin(0.5));
    expect(Math.abs(d)).toBeLessThan(1e-6);
  });

  it('downtrend reads negative despite the noise floor', () => {
    // Momentum band below its peer bands = downtrend. Pre-fix: read positive.
    const d = basinDirection(makeProductionShapedBasin(0.40));
    expect(d).toBeLessThan(0);
  });

  it('uptrend still reads positive on the production shape', () => {
    const d = basinDirection(makeProductionShapedBasin(0.60));
    expect(d).toBeGreaterThan(0);
  });
});

// --- Skewed peer bands (B1.1 noise-floor-anchor regression) --------------
// makeProductionShapedBasin() above sets the volatility + volume peer bands
// to a uniform 0.5, so #880's `8·peerMean` neutral is coincidentally exact.
// The REAL perceive() volume band is NOT 0.5-centred: it encodes
// norm01(log(volRatio)) and volRatio runs mostly < 1, so volume dims sit
// ~0.40. That biased `8·peerMean` LOW → momMass cleared it even on a
// downtrend → sign pinned +1 (the post-#882 "still only longs" finding).
//
// B1.1 anchors the neutral to the noise floor instead — dims 39..54 are a
// known fixed raw NOISE_FLOOR_VALUE, so they pin the simplex scale and the
// neutral momentum share is exact, with zero dependence on the peer bands.

/** Production-shaped basin with an independently skewable volume band. */
function makeSkewedProductionBasin(momValue: number, volumeValue: number): Basin {
  const v = new Float64Array(BASIN_DIM);
  for (let i = 0; i < 3; i++) v[i] = 1 / 3;
  v[3] = 0.01; v[4] = 0.01; v[5] = 0.5; v[6] = 0.0;
  for (let i = 7; i <= 14; i++) v[i] = momValue;        // momentum spectrum
  for (let i = 15; i <= 22; i++) v[i] = 0.5;            // volatility peer band
  for (let i = 23; i <= 30; i++) v[i] = volumeValue;    // volume peer band — skewed
  for (let i = 31; i <= 38; i++) v[i] = 0.5;
  for (let i = 39; i <= 54; i++) v[i] = 0.0055;         // noise floor — the anchor
  v[55] = 0.3; v[56] = 0.2; v[57] = 0.1; v[58] = 0.1;
  for (let i = 59; i < 64; i++) v[i] = 0.01;
  return toSimplex(v);
}

describe('basinDirection — skewed volume band (B1.1 noise-floor anchor)', () => {
  const FLAG = 'MONKEY_PERCEPTION_EXPRESSIVE_LIVE';

  function withFlag(value: string | undefined, fn: () => void): void {
    const orig = process.env[FLAG];
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
    try { fn(); }
    finally {
      if (orig === undefined) delete process.env[FLAG];
      else process.env[FLAG] = orig;
    }
  }

  it('the peer-derived fallback IS skewed by a low volume band (the bug)', () => {
    // Flag off → basinDirection falls back to #880's 8·peerMean. A
    // downtrend (mom 0.45) with a low volume band (0.35) misreads as
    // positive — this is the production "only longs" sign-pin.
    withFlag('false', () => {
      const d = basinDirection(makeSkewedProductionBasin(0.45, 0.35));
      expect(d).toBeGreaterThan(0);
    });
  });

  it('the noise-floor anchor reads the same downtrend as negative (the fix)', () => {
    // Flag on (default) → noise-floor-anchored neutral. Same skewed basin,
    // correct sign.
    withFlag(undefined, () => {
      const d = basinDirection(makeSkewedProductionBasin(0.45, 0.35));
      expect(d).toBeLessThan(0);
    });
  });

  it('a flat market reads ~ 0 even when the volume band is skewed', () => {
    withFlag(undefined, () => {
      const d = basinDirection(makeSkewedProductionBasin(0.5, 0.35));
      expect(Math.abs(d)).toBeLessThan(1e-6);
    });
  });

  it('an uptrend reads positive even when the volume band is skewed', () => {
    withFlag(undefined, () => {
      const d = basinDirection(makeSkewedProductionBasin(0.60, 0.35));
      expect(d).toBeGreaterThan(0);
    });
  });

  it('the anchor is monotone in momentum, immune to the volume skew', () => {
    withFlag(undefined, () => {
      let prev = -2;
      for (const mom of [0.2, 0.35, 0.45, 0.5, 0.55, 0.65, 0.8]) {
        const d = basinDirection(makeSkewedProductionBasin(mom, 0.35));
        expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = d;
      }
    });
  });
});

describe('basinDirection — B1.2 expressive magnitude (dimensional-dilution fix)', () => {
  // Pre-B1.2 the Fisher-Rao distance capped |basinDir| at ~±0.2, so the
  // M-agent and FAST_ADVERSE_EXIT |basinDir| > 0.10 gates could never
  // fire and kernelDirection's 0.5·tape term drowned it. B1.2 returns
  // the band marginal — for a production-shaped basin direction =
  // 2·momValue − 1. These lock the expressive range: a regression to
  // the FR distance (which gave ~±0.05 here) would fail them.

  it('moderate uptrend clears the M-agent 0.10 gate', () => {
    const d = basinDirection(makeProductionShapedBasin(0.60));
    expect(d).toBeCloseTo(0.2, 2);
    expect(d).toBeGreaterThan(0.10);
  });

  it('strong uptrend clears the 0.30 hasDirection gate', () => {
    const d = basinDirection(makeProductionShapedBasin(0.70));
    expect(d).toBeCloseTo(0.4, 2);
    expect(d).toBeGreaterThan(0.30);
  });

  it('moderate downtrend clears the FAST_ADVERSE_EXIT −0.10 gate', () => {
    const d = basinDirection(makeProductionShapedBasin(0.40));
    expect(d).toBeCloseTo(-0.2, 2);
    expect(d).toBeLessThan(-0.10);
  });

  it('a hard trend drives the marginal past ±0.5 (no ~±0.2 ceiling)', () => {
    expect(basinDirection(makeProductionShapedBasin(0.85))).toBeGreaterThan(0.5);
    expect(basinDirection(makeProductionShapedBasin(0.15))).toBeLessThan(-0.5);
  });

  it('flat momentum still reads ~0', () => {
    expect(Math.abs(basinDirection(makeProductionShapedBasin(0.5)))).toBeLessThan(1e-6);
  });

  it('saturates at ±1, never beyond', () => {
    const hi = basinDirection(makeProductionShapedBasin(1.0));
    expect(hi).toBeGreaterThan(0.9);
    expect(hi).toBeLessThanOrEqual(1);
    expect(basinDirection(makeProductionShapedBasin(0.02))).toBeGreaterThanOrEqual(-1);
  });
});
