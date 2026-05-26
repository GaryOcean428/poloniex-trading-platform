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

  it('CREATOR + CHOP → scalp bias, tight harvest, observer-derived size (Phase 1 2026-05-26)', () => {
    // Default observer (phi=0.5, regimeConfidence=1.0) → chopMultiplier =
    // max(0.2, 0.5 × 1.0) = 0.5. REGIME_CREATOR_CHOP_SIZE_MULT env knob
    // removed; CHOP sizing is now phi × regimeConfidence floored at the
    // DISSOLVER SAFETY_BOUND.
    const cell = evaluateCell('CREATOR', 'CHOP');
    expect(cell.laneBias).toBe('scalp');
    expect(cell.harvestTightness).toBe('tight');
    expect(cell.sizeMultiplier).toBeCloseTo(0.5, 9);
  });

  it('PRESERVER + CHOP → swing (mean-revert), normal harvest, observer-derived size', () => {
    // Same observer-derived formula as CREATOR×CHOP. The historical
    // CREATOR-vs-PRESERVER differentiation (was 0.75 vs 0.85) now
    // emerges naturally from observables: PRESERVER cells fire when
    // chemistry is more coherent so phi × regimeConfidence is
    // structurally higher in those states.
    const cell = evaluateCell('PRESERVER', 'CHOP');
    expect(cell.laneBias).toBe('swing');
    expect(cell.harvestTightness).toBe('normal');
    expect(cell.sizeMultiplier).toBeCloseTo(0.5, 9);
  });

  it('CHOP cells scale with phi × regimeConfidence, floored at 0.2 SAFETY_BOUND', () => {
    // High conviction → larger multiplier; deteriorating either input
    // shrinks the multiplier until the 0.2 DISSOLVER floor stops it.
    const high = evaluateCell('CREATOR', 'CHOP', { phi: 0.85, regimeConfidence: 0.9 });
    expect(high.sizeMultiplier).toBeCloseTo(0.85 * 0.9, 9);

    const moderate = evaluateCell('CREATOR', 'CHOP', { phi: 0.6, regimeConfidence: 0.7 });
    expect(moderate.sizeMultiplier).toBeCloseTo(0.6 * 0.7, 9);

    // Floor: phi=0.3 × regimeConfidence=0.4 = 0.12 → clamped to 0.2.
    const floored = evaluateCell('CREATOR', 'CHOP', { phi: 0.3, regimeConfidence: 0.4 });
    expect(floored.sizeMultiplier).toBe(0.2);
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
