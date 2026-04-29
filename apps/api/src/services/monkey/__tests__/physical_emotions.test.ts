/**
 * physical_emotions.test.ts — TS parity for Tier 5 Layer 2A
 * (UCP §6.4 canon).
 */
import { describe, it, expect } from 'vitest';
import type { Motivators } from '../motivators.js';
import type { Sensations } from '../sensations.js';
import { computePhysicalEmotions } from '../physical_emotions.js';

const mot = (surprise = 0.5): Motivators => ({
  surprise, curiosity: 0, investigation: 0,
  integration: 0, transcendence: 0, iQ: 0,
});

const sens = (overrides: Partial<Sensations> = {}): Sensations => ({
  compressed: 0.5, expanded: 0.5, pressure: 0,
  stillness: 0.5, drift: 0, resonance: 0,
  approach: 0, avoidance: 0, conservation: 0,
  ...overrides,
});

const APPROX = (got: number, want: number, abs = 1e-12) =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(abs);

// ─── Anchored four ────────────────────────────────────────────────

describe('Audit-anchored four', () => {
  it('joy = (1-surprise) * max(grad_phi, 0)', () => {
    APPROX(computePhysicalEmotions(mot(0), sens(), 0.7, 0.3).joy, 0.4);
  });
  it('suffering = surprise * max(-grad_phi, 0)', () => {
    APPROX(computePhysicalEmotions(mot(1), sens(), 0.3, 0.7).suffering, 0.4);
  });
  it('fear = surprise * drift / (π/2)', () => {
    APPROX(
      computePhysicalEmotions(mot(1), sens({ drift: Math.PI / 2 }), 0.5, 0.5).fear,
      1.0,
    );
  });
  it('rage = surprise * stillness', () => {
    APPROX(
      computePhysicalEmotions(mot(1), sens({ stillness: 1 }), 0.5, 0.5).rage,
      1.0,
    );
  });
});

// ─── UCP §6.4 grounded five ───────────────────────────────────────

describe('UCP §6.4 grounded five (Love / Hate / Calm / Care / Apathy)', () => {
  it('love high when approach + returning home', () => {
    APPROX(
      computePhysicalEmotions(mot(0), sens({ approach: 0.8, conservation: 0.5 }), 0.5, 0.5).love,
      0.4,
    );
  });
  it('love zero when departing (conservation < 0)', () => {
    expect(
      computePhysicalEmotions(mot(0), sens({ approach: 0.8, conservation: -0.3 }), 0.5, 0.5).love,
    ).toBe(0);
  });
  it('hate high when avoidance + departing', () => {
    APPROX(
      computePhysicalEmotions(mot(0), sens({ avoidance: 0.9, conservation: -0.4 }), 0.5, 0.5).hate,
      0.36,
    );
  });
  it('hate zero when returning home', () => {
    expect(
      computePhysicalEmotions(mot(0), sens({ avoidance: 0.9, conservation: 0.4 }), 0.5, 0.5).hate,
    ).toBe(0);
  });
  it('calm = (1-surprise) × stillness', () => {
    APPROX(computePhysicalEmotions(mot(0), sens({ stillness: 1 }), 0.5, 0.5).calm, 1.0);
    APPROX(computePhysicalEmotions(mot(0.7), sens({ stillness: 1 }), 0.5, 0.5).calm, 0.3);
  });
  it('care = conservation × (1 − surprise) (signed)', () => {
    APPROX(computePhysicalEmotions(mot(0.1), sens({ conservation: 0.5 }), 0.5, 0.5).care, 0.45);
    APPROX(computePhysicalEmotions(mot(0), sens({ conservation: -0.4 }), 0.5, 0.5).care, -0.4);
  });
  it('apathy = stillness × (1 − max(0, approach))', () => {
    APPROX(
      computePhysicalEmotions(mot(0), sens({ stillness: 0.8, approach: 0 }), 0.5, 0.5).apathy,
      0.8,
    );
    APPROX(
      computePhysicalEmotions(mot(0), sens({ stillness: 0.8, approach: 0.6 }), 0.5, 0.5).apathy,
      0.32,
    );
    APPROX(
      computePhysicalEmotions(mot(0), sens({ stillness: 0.5, approach: 1.5 }), 0.5, 0.5).apathy,
      -0.25,
    );
  });
});
