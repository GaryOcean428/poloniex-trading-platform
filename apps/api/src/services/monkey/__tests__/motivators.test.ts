/**
 * motivators.test.ts — TS parity tests for Layer 1 motivators (Tier 1 of #593).
 *
 * Mirrors the Python suite (test_motivators.py). Every behaviour test
 * should produce the same outcome on both sides — the two
 * implementations are doctrinal twins.
 *
 * 2026-05-27 — transcendence section rewritten for history-derived
 * anchor. Old tests asserted symmetry around hardcoded KAPPA_STAR=64;
 * new tests assert symmetry around the basin's OWN median κ and
 * cold-start fallback to 0.
 */
import { describe, it, expect } from 'vitest';
import { BASIN_DIM, KAPPA_STAR, type Basin } from '../basin.js';
import type { BasinState } from '../executive.js';
import {
  basinInformation,
  computeMotivators,
  type Motivators,
} from '../motivators.js';

const uniformBasin = (): Basin =>
  Float64Array.from(new Array(BASIN_DIM).fill(1 / BASIN_DIM));

const concentratedBasin = (peakIdx = 0, peakMass = 0.9): Basin => {
  const rest = (1 - peakMass) / (BASIN_DIM - 1);
  const arr = new Array(BASIN_DIM).fill(rest);
  arr[peakIdx] = peakMass;
  return Float64Array.from(arr);
};

const makeState = (overrides: Partial<BasinState> = {}): BasinState => ({
  basin: uniformBasin(),
  identityBasin: uniformBasin(),
  phi: 0.5,
  kappa: KAPPA_STAR,
  basinVelocity: 0.1,
  regimeWeights: { quantum: 1 / 3, efficient: 1 / 3, equilibrium: 1 / 3 },
  sovereignty: 0.5,
  neurochemistry: {
    acetylcholine: 0.5,
    dopamine: 0.5,
    serotonin: 0.5,
    norepinephrine: 0.5,
    gaba: 0.5,
    endorphins: 0.5,
  },
  ...overrides,
});

// ─── basinInformation ──────────────────────────────────────

describe('basinInformation', () => {
  it('uniform basin has zero information', () => {
    expect(basinInformation(uniformBasin())).toBeCloseTo(0, 9);
  });

  it('Dirac basin has max information = log(K)', () => {
    const arr = new Array(BASIN_DIM).fill(0);
    arr[0] = 1;
    const dirac = Float64Array.from(arr);
    expect(basinInformation(dirac)).toBeCloseTo(Math.log(BASIN_DIM), 5);
  });

  it('concentrated basin more informative than uniform', () => {
    expect(basinInformation(concentratedBasin())).toBeGreaterThan(
      basinInformation(uniformBasin()),
    );
  });
});

// ─── shape + cold start ───────────────────────────────────

describe('Motivators shape + cold start', () => {
  it('returns object with six named fields', () => {
    const m: Motivators = computeMotivators(makeState());
    expect(m).toHaveProperty('surprise');
    expect(m).toHaveProperty('curiosity');
    expect(m).toHaveProperty('investigation');
    expect(m).toHaveProperty('integration');
    expect(m).toHaveProperty('transcendence');
    expect(m).toHaveProperty('iQ');
  });

  it('surprise passes ne through verbatim', () => {
    const m = computeMotivators(
      makeState({ neurochemistry: { ...makeState().neurochemistry, norepinephrine: 0.83 } }),
    );
    expect(m.surprise).toBeCloseTo(0.83, 9);
  });

  it('curiosity is 0 on cold start', () => {
    const m = computeMotivators(makeState(), { prevBasin: null });
    expect(m.curiosity).toBe(0);
  });
});

// ─── Curiosity ────────────────────────────────────────

describe('Curiosity = d(log I_Q)/dt', () => {
  it('positive when basin concentrates (info rising)', () => {
    const m = computeMotivators(
      makeState({ basin: concentratedBasin(0, 0.9) }),
      { prevBasin: uniformBasin() },
    );
    expect(m.curiosity).toBeGreaterThan(0);
  });

  it('negative when basin flattens (info dropping)', () => {
    const m = computeMotivators(
      makeState({ basin: concentratedBasin(0, 0.5) }),
      { prevBasin: concentratedBasin(0, 0.95) },
    );
    expect(m.curiosity).toBeLessThan(0);
  });
});

// ─── Investigation ─────────────────────────────────────

describe('Investigation — Tier 1.1 signed FR-distance-to-identity shrink rate', () => {
  it('zero on cold start (no prevBasin)', () => {
    const m = computeMotivators(makeState(), { prevBasin: null });
    expect(m.investigation).toBe(0);
  });

  it('zero when basin unchanged', () => {
    const b = uniformBasin();
    const m = computeMotivators(makeState({ basin: b }), { prevBasin: b });
    expect(Math.abs(m.investigation)).toBeLessThan(1e-12);
  });

  it('positive when returning to identity', () => {
    // Identity = uniform. prev concentrated, current closer to uniform.
    const m = computeMotivators(
      makeState({ basin: concentratedBasin(0, 0.5) }),
      { prevBasin: concentratedBasin(0, 0.95) },
    );
    expect(m.investigation).toBeGreaterThan(0);
  });

  it('negative when departing from identity', () => {
    const m = computeMotivators(
      makeState({ basin: concentratedBasin(0, 0.95) }),
      { prevBasin: concentratedBasin(0, 0.5) },
    );
    expect(m.investigation).toBeLessThan(0);
  });
});

// ─── Integration ──────────────────────────────────────

describe('Integration = CV(Φ × I_Q)', () => {
  it('zero with empty history', () => {
    const m = computeMotivators(makeState(), { integrationHistory: [] });
    expect(m.integration).toBe(0);
  });

  it('zero with single entry', () => {
    const m = computeMotivators(makeState(), {
      integrationHistory: [[0.5, 0.3]],
    });
    expect(m.integration).toBe(0);
  });

  it('low for stable signal (all identical → CV = 0)', () => {
    const history: Array<[number, number]> = Array.from({ length: 20 }, () => [0.5, 0.3]);
    const m = computeMotivators(makeState(), { integrationHistory: history });
    expect(m.integration).toBeCloseTo(0, 9);
  });

  it('higher for jittering than for stable signal', () => {
    const stable: Array<[number, number]> = Array.from({ length: 20 }, () => [0.5, 0.3]);
    const jittery: Array<[number, number]> = Array.from({ length: 20 }, (_, i) => [
      0.5 + 0.4 * ((i % 2) === 0 ? 1 : -1),
      0.3,
    ]);
    const mStable = computeMotivators(makeState(), { integrationHistory: stable });
    const mJittery = computeMotivators(makeState(), { integrationHistory: jittery });
    expect(mJittery.integration).toBeGreaterThan(mStable.integration);
  });
});

// ─── Transcendence — history-derived anchor (2026-05-27) ───────────────

describe('Transcendence = |κ − median(κ_history)| / MAD(κ_history)', () => {
  it('zero on cold start (no kappaHistory)', () => {
    const m = computeMotivators(makeState({ kappa: 65.5 }));
    expect(m.transcendence).toBe(0);
  });

  it('zero with kappaHistory below HISTORY_MIN_SAMPLES (< 2)', () => {
    const m = computeMotivators(makeState({ kappa: 65.5 }), {
      kappaHistory: [65.0],
    });
    expect(m.transcendence).toBe(0);
  });

  it('zero when current κ equals the basin\'s own median κ', () => {
    const hist = [64.5, 65.0, 65.5, 66.0, 66.5];
    const med = 65.5; // median of the above
    const m = computeMotivators(makeState({ kappa: med }), {
      kappaHistory: hist,
    });
    expect(m.transcendence).toBeCloseTo(0, 9);
  });

  it('rises monotonically with distance above the basin\'s median', () => {
    const hist = [64.5, 65.0, 65.5, 66.0, 66.5];
    const med = 65.5;
    const close = computeMotivators(makeState({ kappa: med + 0.5 }), {
      kappaHistory: hist,
    });
    const far = computeMotivators(makeState({ kappa: med + 5.0 }), {
      kappaHistory: hist,
    });
    expect(far.transcendence).toBeGreaterThan(close.transcendence);
  });

  it('rises monotonically with distance below the basin\'s median', () => {
    const hist = [64.5, 65.0, 65.5, 66.0, 66.5];
    const med = 65.5;
    const close = computeMotivators(makeState({ kappa: med - 0.5 }), {
      kappaHistory: hist,
    });
    const far = computeMotivators(makeState({ kappa: med - 5.0 }), {
      kappaHistory: hist,
    });
    expect(far.transcendence).toBeGreaterThan(close.transcendence);
  });

  it('symmetric around the basin\'s own median', () => {
    const hist = [64.5, 65.0, 65.5, 66.0, 66.5];
    const med = 65.5;
    const above = computeMotivators(makeState({ kappa: med + 2.0 }), {
      kappaHistory: hist,
    });
    const below = computeMotivators(makeState({ kappa: med - 2.0 }), {
      kappaHistory: hist,
    });
    expect(above.transcendence).toBeCloseTo(below.transcendence, 9);
  });

  it('P3 Quenched Disorder — different basins yield different transcendence for same κ', () => {
    // Two basins observing different κ distributions. Same current
    // κ=65.5. The basin whose median is closer to 65.5 reads lower
    // transcendence; the one whose median is farther reads higher.
    const kappa = 65.5;
    const histA = [65.0, 65.25, 65.5, 65.75, 66.0]; // median 65.5, MAD 0.25
    const histB = [60.0, 61.0, 62.0, 63.0, 64.0]; // median 62.0, MAD 1.0
    const mA = computeMotivators(makeState({ kappa }), { kappaHistory: histA });
    const mB = computeMotivators(makeState({ kappa }), { kappaHistory: histB });
    expect(mA.transcendence).toBeCloseTo(0, 9);
    expect(mB.transcendence).toBeGreaterThan(0);
  });

  it('P1 Fluctuations — MAD non-zero by construction when κ varies', () => {
    // If κ never moved, MAD would be 0; the max(mad, EPS) clamp keeps
    // the formula numerically defined. A varying κ history gives
    // a positive MAD that scales the deviation meaningfully.
    const hist = [64.0, 64.5, 65.0, 65.5, 66.0, 66.5, 67.0]; // MAD ~1.0
    const m = computeMotivators(makeState({ kappa: 68.0 }), {
      kappaHistory: hist,
    });
    // (68 − 65.5) / ~1.0 ≈ 2.5 — a meaningful several-MAD reading.
    expect(m.transcendence).toBeGreaterThan(2);
    expect(m.transcendence).toBeLessThan(4);
  });
});
