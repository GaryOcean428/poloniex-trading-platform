/**
 * sensations.test.ts — TS parity for Tier 4 Layer 0/0.5.
 */
import { describe, it, expect } from 'vitest';
import { BASIN_DIM, type Basin } from '../basin.js';
import type { BasinState } from '../executive.js';
import { computeSensations } from '../sensations.js';

const uniform = (): Basin => Float64Array.from(new Array(BASIN_DIM).fill(1 / BASIN_DIM));

const peak = (idx = 0, mass = 0.9): Basin => {
  const rest = (1 - mass) / (BASIN_DIM - 1);
  const arr = new Array(BASIN_DIM).fill(rest);
  arr[idx] = mass;
  return Float64Array.from(arr);
};

const makeState = (overrides: Partial<BasinState> = {}): BasinState => ({
  basin: uniform(),
  identityBasin: uniform(),
  phi: 0.5,
  kappa: 64,
  basinVelocity: 0.1,
  regimeWeights: { quantum: 1 / 3, efficient: 1 / 3, equilibrium: 1 / 3 },
  sovereignty: 0.5,
  neurochemistry: {
    acetylcholine: 0.5, dopamine: 0.5, serotonin: 0.5,
    norepinephrine: 0.5, gaba: 0.5, endorphins: 0.5,
  },
  ...overrides,
});

const APPROX = (got: number, want: number, abs = 1e-9) =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(abs);

// ─── Layer 0 ──────────────────────────────────────────────────────

describe('Layer 0 sensations', () => {
  it('compressed + expanded = 1', () => {
    const s = computeSensations(makeState({ basin: peak(0, 0.7) }));
    APPROX(s.compressed + s.expanded, 1.0);
  });
  it('compressed high for concentrated basin', () => {
    const s = computeSensations(makeState({ basin: peak(0, 0.95) }));
    expect(s.compressed).toBeGreaterThan(0.9);
  });
  it('expanded high for uniform basin', () => {
    const s = computeSensations(makeState({ basin: uniform() }));
    expect(s.expanded).toBeGreaterThan(0.95);
  });
  it('pressure ≈ 0 for uniform basin', () => {
    APPROX(computeSensations(makeState({ basin: uniform() })).pressure, 0.0);
  });
  it('pressure ≈ log(K) for Dirac basin', () => {
    const arr = new Array(BASIN_DIM).fill(0);
    arr[0] = 1;
    const dirac = Float64Array.from(arr);
    APPROX(
      computeSensations(makeState({ basin: dirac })).pressure,
      Math.log(BASIN_DIM),
      1e-5,
    );
  });
  it('stillness max at zero velocity', () => {
    APPROX(computeSensations(makeState({ basinVelocity: 0 })).stillness, 1.0);
  });
  it('stillness decreases with velocity', () => {
    const lo = computeSensations(makeState({ basinVelocity: 0 }));
    const hi = computeSensations(makeState({ basinVelocity: 2 }));
    expect(lo.stillness).toBeGreaterThan(hi.stillness);
  });
  it('drift = 0 when basin = identity', () => {
    const b = uniform();
    APPROX(computeSensations(makeState({ basin: b, identityBasin: b })).drift, 0);
  });
  it('drift > 0 when basin diverges from identity', () => {
    const s = computeSensations(makeState({ basin: peak(0, 0.9), identityBasin: uniform() }));
    expect(s.drift).toBeGreaterThan(0);
  });
  it('resonance = 1 when basin unchanged', () => {
    const b = uniform();
    APPROX(computeSensations(makeState({ basin: b }), { prevBasin: b }).resonance, 1.0);
  });
  it('resonance = 0 on cold start', () => {
    expect(computeSensations(makeState(), { prevBasin: null }).resonance).toBe(0);
  });
});

// ─── Layer 0.5 ────────────────────────────────────────────────────

describe('Layer 0.5 drives', () => {
  it('approach positive when dopamine dominates', () => {
    const s = computeSensations(
      makeState({ neurochemistry: {
        ...makeState().neurochemistry, dopamine: 0.9, gaba: 0.1,
      } }),
    );
    APPROX(s.approach, 0.8);
  });
  it('approach negative when gaba dominates', () => {
    const s = computeSensations(
      makeState({ neurochemistry: {
        ...makeState().neurochemistry, dopamine: 0.1, gaba: 0.9,
      } }),
    );
    APPROX(s.approach, -0.8);
  });
  it('avoidance passes ne through', () => {
    const s = computeSensations(
      makeState({ neurochemistry: {
        ...makeState().neurochemistry, norepinephrine: 0.73,
      } }),
    );
    APPROX(s.avoidance, 0.73);
  });
  it('conservation = 0 on cold start', () => {
    expect(computeSensations(makeState()).conservation).toBe(0);
  });
  it('conservation positive when returning to identity', () => {
    const s = computeSensations(
      makeState({ basin: peak(0, 0.5), identityBasin: uniform() }),
      { prevBasin: peak(0, 0.95) },
    );
    expect(s.conservation).toBeGreaterThan(0);
  });
  it('conservation negative when departing', () => {
    const s = computeSensations(
      makeState({ basin: peak(0, 0.95), identityBasin: uniform() }),
      { prevBasin: peak(0, 0.5) },
    );
    expect(s.conservation).toBeLessThan(0);
  });
});
