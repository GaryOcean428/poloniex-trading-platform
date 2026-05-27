/**
 * motivators.test.ts — TS parity tests for Layer 1 motivators (Tier 1 of #593).
 *
 * Mirrors the Python suite (test_motivators.py). Every behaviour test
 * should produce the same outcome on both sides — the two
 * implementations are doctrinal twins.
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

// ─── basinInformation ───────────────────────────────────────────────

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

// ─── shape + cold start ─────────────────────────────────────────────

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

// ─── Curiosity ─────────────────────────────────────────────────────

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

// ─── Investigation ─────────────────────────────────────────────────

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

// ─── Integration ───────────────────────────────────────────────────

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

// ─── Transcendence (observer-earned anchor: median/MAD of kappaHistory) ───

describe('Transcendence (Pillar 3 earned anchor)', () => {
  it('zero on cold start (no kappaHistory / insufficient samples)', () => {
    const m = computeMotivators(makeState({ kappa: KAPPA_STAR }));
    expect(m.transcendence).toBe(0);
    const m2 = computeMotivators(makeState({ kappa: 70 }), { kappaHistory: [KAPPA_STAR] });
    expect(m2.transcendence).toBe(0);
  });

  it('zero when κ exactly at history median (observer-derived per two-channel doctrine)', () => {
    // Historical 64 literals retired (pre two-channel 2026-04-13 + v6.7B audit); use governed KAPPA_STAR (63.8)
    const hist = [63.7, KAPPA_STAR, 63.9];
    const m = computeMotivators(makeState({ kappa: KAPPA_STAR }), { kappaHistory: hist });
    expect(m.transcendence).toBeCloseTo(0, 12);
  });

  it('rises smoothly when κ departs from own observed median (MAD scale)', () => {
    const hist = [63.7, KAPPA_STAR, 63.9];
    const atMedian = computeMotivators(makeState({ kappa: KAPPA_STAR }), { kappaHistory: hist });
    const off = computeMotivators(makeState({ kappa: 66.0 }), { kappaHistory: hist });
    expect(off.transcendence).toBeGreaterThan(atMedian.transcendence);
  });

  it('shared fixture parity value (exact numbers for py cross-test #940) — v6.7B two-channel', () => {
    // This fixture must produce identical numeric transcendence on both
    // TS and Python sides. Uses governed reference anchor KAPPA_STAR (Python registry default 63.8).
    // (Retired bare median=64 language per doctrine.)
    // hist median 63.8, kappa=65.8 → |dev|=2.0, mad=0.2, raw=10 exactly.
    const hist = [63.6, 63.8, 64.0];
    const m = computeMotivators(makeState({ kappa: 65.8 }), { kappaHistory: hist });
    expect(m.transcendence).toBeCloseTo(Math.tanh(10), 12);
  });
});
