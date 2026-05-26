import { describe, it, expect } from 'vitest';
import {
  evaluateCell,
  regimeToDirection,
  canonicalToPhase,
  type RegimePhase,
  type TrajectoryDirection,
} from '../compositional_executive.js';

describe('evaluateCell — 3×3 compositional matrix coverage', () => {
  const phases: RegimePhase[] = ['CREATOR', 'PRESERVER', 'DISSOLVER'];
  const directions: TrajectoryDirection[] = ['TREND_UP', 'CHOP', 'TREND_DOWN'];

  it('returns a CellAction for every (phase, direction) pair (all 9 cells covered)', () => {
    for (const p of phases) {
      for (const d of directions) {
        const cell = evaluateCell(p, d);
        expect(cell.phase).toBe(p);
        expect(cell.direction).toBe(d);
        expect(cell.label).toContain(p);
        expect(['trend', 'swing', 'scalp', 'observe']).toContain(cell.laneBias);
        expect(['loose', 'normal', 'tight']).toContain(cell.harvestTightness);
        expect(cell.sizeMultiplier).toBeGreaterThanOrEqual(0);
        expect(cell.sizeMultiplier).toBeLessThanOrEqual(1.0);
      }
    }
  });

  it('DISSOLVER cells floor at 0.2 SAFETY_BOUND (reduced conviction, not sit-out)', () => {
    // 2026-05-26: hard 0.0 multiplier replaced with 0.2 floor — autonomy
    // doctrine forbids hardcoded "don't trade" gates; the kernel always
    // attempts a defensive-sized position. P15 (should_auto_flatten) owns
    // catastrophic safety. Mirrors the CHOP suppression filter floor.
    for (const d of directions) {
      const cell = evaluateCell('DISSOLVER', d);
      expect(cell.sizeMultiplier).toBe(0.2);
      expect(cell.laneBias).toBe('observe');
    }
  });

  it('PRESERVER + TREND cells favour loose-harvest trend lane', () => {
    for (const d of ['TREND_UP', 'TREND_DOWN'] as const) {
      const cell = evaluateCell('PRESERVER', d);
      expect(cell.laneBias).toBe('trend');
      expect(cell.harvestTightness).toBe('loose');
      expect(cell.sizeMultiplier).toBe(1.0);
    }
  });

  it('CREATOR + CHOP → scalp bias, tight harvest, 0.75x size (env-tunable)', () => {
    const cell = evaluateCell('CREATOR', 'CHOP');
    expect(cell.laneBias).toBe('scalp');
    expect(cell.harvestTightness).toBe('tight');
    // 0.75 default (bumped from 0.5 in 2026-05-19 sizing-knobs pass per
    // user report "small positions, low leverage, tiny wins").
    // Env override: REGIME_CREATOR_CHOP_SIZE_MULT.
    expect(cell.sizeMultiplier).toBe(0.75);
  });

  it('PRESERVER + CHOP → swing (mean-revert), normal harvest, 0.85x size (env-tunable)', () => {
    const cell = evaluateCell('PRESERVER', 'CHOP');
    expect(cell.laneBias).toBe('swing');
    expect(cell.harvestTightness).toBe('normal');
    // 0.85 default (bumped from 0.7). Env: REGIME_PRESERVER_CHOP_SIZE_MULT.
    expect(cell.sizeMultiplier).toBe(0.85);
  });

  it('CREATOR + TREND_UP and CREATOR + TREND_DOWN → trend lane, full size', () => {
    for (const d of ['TREND_UP', 'TREND_DOWN'] as const) {
      const cell = evaluateCell('CREATOR', d);
      expect(cell.laneBias).toBe('trend');
      expect(cell.sizeMultiplier).toBe(1.0);
    }
  });

  it('DISSOLVER cells label distinguishes CHOP from TREND sub-cases', () => {
    expect(evaluateCell('DISSOLVER', 'CHOP').label).toContain('max entropy');
    expect(evaluateCell('DISSOLVER', 'TREND_UP').label).toContain('momentum reverting');
    expect(evaluateCell('DISSOLVER', 'TREND_DOWN').label).toContain('momentum reverting');
  });

  it('is pure — same input always yields same output', () => {
    const a = evaluateCell('CREATOR', 'TREND_UP');
    const b = evaluateCell('CREATOR', 'TREND_UP');
    expect(a).toEqual(b);
  });
});

describe('regimeToDirection — trajectory regime string mapping', () => {
  it('maps recognised TREND_UP / CHOP / TREND_DOWN', () => {
    expect(regimeToDirection('TREND_UP')).toBe('TREND_UP');
    expect(regimeToDirection('CHOP')).toBe('CHOP');
    expect(regimeToDirection('TREND_DOWN')).toBe('TREND_DOWN');
  });

  it('returns null for unrecognised inputs', () => {
    expect(regimeToDirection('unknown')).toBe(null);
    expect(regimeToDirection('')).toBe(null);
    expect(regimeToDirection('creator')).toBe(null);  // phase regime, not direction
  });
});

describe('canonicalToPhase — qig_warp regime string mapping', () => {
  it('maps recognised creator / preserver / dissolver', () => {
    expect(canonicalToPhase('creator')).toBe('CREATOR');
    expect(canonicalToPhase('preserver')).toBe('PRESERVER');
    expect(canonicalToPhase('dissolver')).toBe('DISSOLVER');
  });

  it('returns null for unrecognised inputs', () => {
    expect(canonicalToPhase('TREND_UP')).toBe(null);  // direction regime, not phase
    expect(canonicalToPhase(null)).toBe(null);
    expect(canonicalToPhase('disordered')).toBe(null);  // qig_warp uses 'dissolver' not 'disordered'
  });
});
