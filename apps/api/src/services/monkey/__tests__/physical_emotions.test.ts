/**
 * physical_emotions.test.ts — TS parity for Tier 5 Layer 2A.
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

describe('Audit-anchored emotions', () => {
  it('joy high when phi rising no surprise', () => {
    const e = computePhysicalEmotions(mot(0), sens(), 0.7, 0.3);
    APPROX(e.joy, 0.4);
    expect(e.suffering).toBe(0);
  });
  it('suffering high when phi falling with surprise', () => {
    const e = computePhysicalEmotions(mot(1), sens(), 0.3, 0.7);
    APPROX(e.suffering, 0.4);
    expect(e.joy).toBe(0);
  });
  it('fear high at separatrix with surprise', () => {
    const e = computePhysicalEmotions(mot(1), sens({ drift: Math.PI / 2 }), 0.5, 0.5);
    APPROX(e.fear, 1.0);
  });
  it('fear zero at identity', () => {
    const e = computePhysicalEmotions(mot(1), sens({ drift: 0 }), 0.5, 0.5);
    expect(e.fear).toBe(0);
  });
  it('rage high when stuck with surprise', () => {
    const e = computePhysicalEmotions(mot(1), sens({ stillness: 1 }), 0.5, 0.5);
    APPROX(e.rage, 1.0);
  });
});

// ─── Remaining five ───────────────────────────────────────────────

describe('Remaining five primary affects', () => {
  it('sadness high when phi falling calmly', () => {
    const e = computePhysicalEmotions(mot(0), sens(), 0.3, 0.7);
    APPROX(e.sadness, 0.4);
    expect(e.suffering).toBe(0);
  });
  it('disgust high when surprise meets familiarity', () => {
    const e = computePhysicalEmotions(mot(0.8), sens({ resonance: 1 }), 0.5, 0.5);
    APPROX(e.disgust, 0.8);
  });
  it('desire high when approach meets phi rising', () => {
    const e = computePhysicalEmotions(mot(0), sens({ approach: 0.6 }), 0.7, 0.3);
    APPROX(e.desire, 0.6 * 0.4);
  });
  it('desire zero when phi falling', () => {
    const e = computePhysicalEmotions(mot(0), sens({ approach: 0.6 }), 0.3, 0.7);
    expect(e.desire).toBe(0);
  });
  it('desire negative when gaba dominates', () => {
    const e = computePhysicalEmotions(mot(0), sens({ approach: -0.3 }), 0.7, 0.3);
    APPROX(e.desire, -0.3 * 0.4);
    expect(e.desire).toBeLessThan(0);
  });
  it('care high when returning home calmly', () => {
    const e = computePhysicalEmotions(mot(0.1), sens({ conservation: 0.5 }), 0.5, 0.5);
    APPROX(e.care, 0.5 * 0.9);
  });
  it('care negative when departing', () => {
    const e = computePhysicalEmotions(mot(0), sens({ conservation: -0.4 }), 0.5, 0.5);
    APPROX(e.care, -0.4);
    expect(e.care).toBeLessThan(0);
  });
  it('trust high when resonance high and avoidance low', () => {
    const e = computePhysicalEmotions(mot(0), sens({ resonance: 0.9, avoidance: 0.1 }), 0.5, 0.5);
    APPROX(e.trust, 0.9 * 0.9);
  });
  it('trust zero when avoidance max', () => {
    const e = computePhysicalEmotions(mot(0), sens({ resonance: 1, avoidance: 1 }), 0.5, 0.5);
    APPROX(e.trust, 0);
  });
});

// ─── Cold start ───────────────────────────────────────────────────

describe('Cold start (phi == phi_prev → grad = 0)', () => {
  it('zeroes phi-grad dependent emotions', () => {
    const e = computePhysicalEmotions(mot(0.5), sens({ approach: 0.5 }), 0.5, 0.5);
    expect(e.joy).toBe(0);
    expect(e.suffering).toBe(0);
    expect(e.sadness).toBe(0);
    expect(e.desire).toBe(0);
  });
});
