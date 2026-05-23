import { describe, it, expect } from 'vitest';
import { geometricDirection, kernelDirection } from '../executive.js';
import type { EmotionState } from '../emotions.js';

/**
 * Regression tests for geometricDirection — the pure-geometry direction
 * function used in the TS execution path (loop.ts).
 *
 * Root cause of the "direction=flat" production outage (2026-05-23):
 *   kernelDirection has an emotion conviction gate:
 *     if (confidence < anxiety) return 'flat'
 *   With κ=66.25, transcendence = |κ − κ*| = |66.25 − 64| = 2.25.
 *   confidence = (1 − transcendence) × Φ = (1 − 2.25) × 0.59 = −0.74.
 *   anxiety = transcendence × bv = 2.25 × 0.007 = 0.016.
 *   −0.74 < 0.016 → gate fires → direction='flat' for EVERY tick when
 *   κ deviates from 64 by more than 1 unit — effectively always, given
 *   κ ∈ [20, 120].
 *
 * geometricDirection removes the gate and returns the pure geometric
 * signal: basinDir + 0.5 × tapeTrend.  Same two-line logic as
 * kernelDirection but without the confidence < anxiety guard.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

/** Minimal neutral EmotionState (confidence > anxiety so gate passes). */
function neutralEmotions(): EmotionState {
  return {
    wonder:     0.0,
    frustration: 0.0,
    satisfaction: 0.0,
    confusion:  0.0,
    clarity: 0.0,
    anxiety:    0.0,
    confidence: 1.0,
    boredom: 0.0,
    flow: 0.0,
  };
}

// ── core geometric tests ──────────────────────────────────────────────────────

describe('geometricDirection — pure geometry', () => {
  it('positive signal → long', () => {
    expect(geometricDirection({ basinDir: 0.3, tapeTrend: 0.2 })).toBe('long');
  });

  it('negative signal → short', () => {
    expect(geometricDirection({ basinDir: -0.3, tapeTrend: -0.2 })).toBe('short');
  });

  it('exactly-zero signal → flat', () => {
    expect(geometricDirection({ basinDir: 0, tapeTrend: 0 })).toBe('flat');
  });

  it('tape tilts an ambiguous basin long', () => {
    // basinDir=0, tapeTrend=0.1 → 0 + 0.5*0.1 = 0.05 > 0 → long
    expect(geometricDirection({ basinDir: 0, tapeTrend: 0.1 })).toBe('long');
  });

  it('basin dominates when tape opposes weakly', () => {
    // basinDir=-0.5, tapeTrend=0.4 → -0.5 + 0.2 = -0.3 → short
    expect(geometricDirection({ basinDir: -0.5, tapeTrend: 0.4 })).toBe('short');
  });
});

// ── production-shaped regression ────────────────────────────────────────────

describe('geometricDirection — 2026-05-23 production regression', () => {
  // Values taken directly from the production log that showed no entries:
  //   kappa=66.25, phi=0.590, basinDir=-0.043, tape=-0.249, bv=0.007
  const kappa    = 66.25;
  const phi      = 0.590;
  const basinDir = -0.043;
  const tape     = -0.249;
  const bv       = 0.007;

  it('geometric signal is negative (should be short)', () => {
    const signal = basinDir + 0.5 * tape;
    expect(signal).toBeCloseTo(-0.1675, 4);
    expect(signal).toBeLessThan(0);
  });

  it('geometricDirection returns short (no emotion gate)', () => {
    expect(geometricDirection({ basinDir, tapeTrend: tape })).toBe('short');
  });

  it('kernelDirection returns flat with real emotions (demonstrates the bug)', () => {
    // Reproduce the emotion computation that caused the outage.
    // transcendence = |kappa - 64| = 2.25; confidence = (1 - 2.25) * phi < 0
    const transcendence = Math.abs(kappa - 64);
    const confidence = (1 - transcendence) * phi;
    const anxiety = transcendence * bv;

    expect(transcendence).toBeCloseTo(2.25, 4);
    expect(confidence).toBeCloseTo(-0.7375, 4);
    expect(confidence).toBeLessThan(0);
    expect(confidence).toBeLessThan(anxiety); // gate fires

    const emotions: EmotionState = {
      wonder: 0,
      frustration: 0,
      satisfaction: 0,
      confusion: 0,
      clarity: 0,
      confidence,
      anxiety,
      boredom: 0,
      flow: 0,
    };
    // Confirm the bug: emotion gate collapses the directional signal to flat.
    expect(kernelDirection({ basinDir, tapeTrend: tape, emotions })).toBe('flat');
  });

  it('kernelDirection returns short with neutral emotions (gate bypassed)', () => {
    expect(kernelDirection({
      basinDir,
      tapeTrend: tape,
      emotions: neutralEmotions(),
    })).toBe('short');
  });
});

// ── systematic: high-kappa range should not affect geometricDirection ─────────

describe('geometricDirection — insensitive to kappa extremes', () => {
  const cases: Array<{ kappa: number; basinDir: number; tape: number; expected: 'long' | 'short' | 'flat' }> = [
    { kappa:  20, basinDir:  0.1, tape:  0.1, expected: 'long'  },
    { kappa:  64, basinDir: -0.1, tape: -0.1, expected: 'short' },
    { kappa: 100, basinDir:  0.2, tape: -0.1, expected: 'long'  },  // 0.2 - 0.05 = 0.15
    { kappa: 120, basinDir: -0.5, tape:  0.2, expected: 'short' },  // -0.5 + 0.1 = -0.4
  ];

  for (const { kappa, basinDir, tape, expected } of cases) {
    it(`kappa=${kappa} basinDir=${basinDir} tape=${tape} → ${expected}`, () => {
      // geometricDirection must not care about kappa at all
      expect(geometricDirection({ basinDir, tapeTrend: tape })).toBe(expected);
    });
  }
});
