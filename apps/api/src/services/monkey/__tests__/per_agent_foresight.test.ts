/**
 * per_agent_foresight.test.ts — Fisher-Rao geodesic extrapolation
 * tests for per-agent foresight veto.
 */
import { describe, expect, it } from 'vitest';
import { foresightVeto, predictBasin } from '../per_agent_foresight.js';
import { BASIN_DIM, type Basin } from '../basin.js';

function uniform(): Basin {
  const b = new Float64Array(BASIN_DIM);
  b.fill(1 / BASIN_DIM);
  return b as unknown as Basin;
}

function longBiased(strength = 0.7): Basin {
  const b = new Float64Array(BASIN_DIM);
  const bandMass = strength;
  const offMass = 1 - strength;
  for (let i = 0; i < BASIN_DIM; i++) {
    if (i >= 7 && i <= 14) b[i] = bandMass / 8;
    else b[i] = offMass / 56;
  }
  return b as unknown as Basin;
}

function shortBiased(strength = 0.7): Basin {
  const b = new Float64Array(BASIN_DIM);
  const bandMass = (1 - strength) * 0.5;
  const offMass = strength + 0.5 * (1 - strength);
  for (let i = 0; i < BASIN_DIM; i++) {
    if (i >= 7 && i <= 14) b[i] = bandMass / 8;
    else b[i] = offMass / 56;
  }
  return b as unknown as Basin;
}

describe('predictBasin', () => {
  it('returns null when history < 2', () => {
    expect(predictBasin([])).toBeNull();
    expect(predictBasin([uniform()])).toBeNull();
  });

  it('extrapolates from prev/curr along the geodesic', () => {
    // Trajectory: uniform → mid-bias-long → predict toward more long
    const prev = uniform();
    const curr = longBiased(0.55);
    const r = predictBasin([prev, curr], 4);
    expect(r).not.toBeNull();
    // Predicted direction should be more long than current.
    expect(r!.predictedDirection).toBeGreaterThanOrEqual(-1);
  });

  it('confidence drops as the step gets larger', () => {
    const prev = longBiased(0.9);
    const curr = shortBiased(0.9); // huge swing
    const r = predictBasin([prev, curr]);
    expect(r).not.toBeNull();
    expect(r!.confidence).toBeLessThan(0.3);
  });
});

describe('foresightVeto', () => {
  it('does not veto when history is short', () => {
    const r = foresightVeto([uniform()], 'long');
    expect(r.veto).toBe(false);
    expect(r.reason).toBe('foresight_unavailable');
  });

  it('does not veto on aligned trajectory (long signal + long-trending basin)', () => {
    // History trending toward long-bias.
    const hist = [uniform(), longBiased(0.55), longBiased(0.65)];
    const r = foresightVeto(hist, 'long');
    expect(r.veto).toBe(false);
  });

  it('does not veto when confidence is below threshold', () => {
    // High-volatility step → low confidence
    const hist = [longBiased(0.9), shortBiased(0.9)];
    const r = foresightVeto(hist, 'long', 4, 0.20, 0.5);
    expect(r.veto).toBe(false);
    expect(r.reason).toContain('low_confidence');
  });
});
