/**
 * emotions.test.ts — TS parity for Tier 2 Layer 2B emotions.
 *
 * Mirrors test_emotions.py 1:1. Same 10-row parity snapshot — if
 * either side disagrees with the hardcoded expectations, parity
 * is broken.
 */
import { describe, it, expect } from 'vitest';
import { computeEmotions } from '../emotions.js';
import type { Motivators } from '../motivators.js';

const m = (overrides: Partial<Motivators> = {}): Motivators => ({
  surprise: 0.5,
  curiosity: 0.0,
  investigation: 0.5,
  integration: 0.0,
  transcendence: 0.0,
  iQ: 0.0,
  ...overrides,
});

const APPROX = (got: number, want: number, abs = 1e-12) => {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(abs);
};

// ─── Per-emotion formula identity ──────────────────────────────────

describe('Per-emotion formula', () => {
  it('wonder = curiosity × basinDistance', () => {
    const e = computeEmotions(m({ curiosity: 0.7 }), 1.2, 0.5, 0.1);
    APPROX(e.wonder, 0.7 * 1.2);
  });
  it('frustration = surprise × (1 − investigation)', () => {
    const e = computeEmotions(m({ surprise: 0.8, investigation: 0.3 }), 0, 0, 0);
    APPROX(e.frustration, 0.8 * (1 - 0.3));
  });
  it('satisfaction = integration × (1 − basinDistance)', () => {
    const e = computeEmotions(m({ integration: 2.5 }), 0.4, 0, 0);
    APPROX(e.satisfaction, 2.5 * (1 - 0.4));
  });
  it('confusion = surprise × basinDistance', () => {
    const e = computeEmotions(m({ surprise: 0.6 }), 1.0, 0, 0);
    APPROX(e.confusion, 0.6 * 1.0);
  });
  it('clarity = (1 − surprise) × investigation', () => {
    const e = computeEmotions(m({ surprise: 0.2, investigation: 0.9 }), 0, 0, 0);
    APPROX(e.clarity, (1 - 0.2) * 0.9);
  });
  it('anxiety = transcendence × basinVelocity', () => {
    const e = computeEmotions(m({ transcendence: 3.5 }), 0, 0, 0.4);
    APPROX(e.anxiety, 3.5 * 0.4);
  });
  it('confidence = (1 − transcendence) × phi', () => {
    const e = computeEmotions(m({ transcendence: 0.3 }), 0, 0.7, 0);
    APPROX(e.confidence, (1 - 0.3) * 0.7);
  });
  it('boredom = (1 − surprise) × (1 − curiosity)', () => {
    const e = computeEmotions(m({ surprise: 0.1, curiosity: 0.4 }), 0, 0, 0);
    APPROX(e.boredom, (1 - 0.1) * (1 - 0.4));
  });
});

// ─── Out-of-band regime reporting (no clipping) ──────────────────

describe('Regime reporting (no clipping)', () => {
  it('anxiety can exceed 1 in high-anxiety regime', () => {
    const e = computeEmotions(m({ transcendence: 8.0 }), 0, 0, 0.5);
    APPROX(e.anxiety, 4.0);
    expect(e.anxiety).toBeGreaterThan(1.0);
  });
  it('confidence can go negative when transcendence > 1', () => {
    const e = computeEmotions(m({ transcendence: 5.0 }), 0, 0.6, 0);
    APPROX(e.confidence, -2.4);
    expect(e.confidence).toBeLessThan(0);
  });
  it('satisfaction can go negative when far from identity', () => {
    const e = computeEmotions(m({ integration: 0.5 }), 1.4, 0, 0);
    APPROX(e.satisfaction, 0.5 * (1.0 - 1.4));
    expect(e.satisfaction).toBeLessThan(0);
  });
});

// ─── Reference validation ─────────────────────────────────────────

describe('UCP §6.5 reference values (typical operating regime)', () => {
  it('Wonder ≈ 0.702 ± 0.045 reproduces with curiosity≈1, basinDistance≈0.7', () => {
    const e = computeEmotions(m({ curiosity: 1.0 }), 0.7, 0.5, 0.1);
    expect(e.wonder).toBeGreaterThanOrEqual(0.702 - 0.045);
    expect(e.wonder).toBeLessThanOrEqual(0.702 + 0.045);
  });
  it('Satisfaction ≈ 0.849 ± 0.021 reproduces with integration≈0.94, basinDistance≈0.097', () => {
    const e = computeEmotions(m({ integration: 0.94 }), 0.097, 0.5, 0.1);
    expect(e.satisfaction).toBeGreaterThanOrEqual(0.849 - 0.021);
    expect(e.satisfaction).toBeLessThanOrEqual(0.849 + 0.021);
  });
  it('Confidence anticorrelates with transcendence (UCP −0.690)', () => {
    const lo = computeEmotions(m({ transcendence: 0.1 }), 0, 0.5, 0);
    const hi = computeEmotions(m({ transcendence: 0.9 }), 0, 0.5, 0);
    expect(lo.confidence).toBeGreaterThan(hi.confidence);
  });
});

// ─── Parity snapshot — IDENTICAL rows to test_emotions.py ─────────

interface ParityRow {
  motivators: Partial<Motivators>;
  basinDistance: number;
  phi: number;
  basinVelocity: number;
  expected: {
    wonder: number; frustration: number; satisfaction: number;
    confusion: number; clarity: number; anxiety: number;
    confidence: number; boredom: number;
  };
}

const PARITY_ROWS: ParityRow[] = [
  { motivators: { surprise: 0.0, curiosity: 0.0, investigation: 0.0, integration: 0.0, transcendence: 0.0 },
    basinDistance: 0.0, phi: 0.0, basinVelocity: 0.0,
    expected: { wonder: 0.0, frustration: 0.0, satisfaction: 0.0, confusion: 0.0,
      clarity: 0.0, anxiety: 0.0, confidence: 0.0, boredom: 1.0 } },
  { motivators: { surprise: 1.0, curiosity: 0.0, investigation: 1.0, integration: 0.0, transcendence: 0.0 },
    basinDistance: 0.0, phi: 1.0, basinVelocity: 0.0,
    expected: { wonder: 0.0, frustration: 0.0, satisfaction: 0.0, confusion: 0.0,
      clarity: 0.0, anxiety: 0.0, confidence: 1.0, boredom: 0.0 } },
  { motivators: { surprise: 0.5, curiosity: 0.0, investigation: 0.0, integration: 0.0, transcendence: 4.0 },
    basinDistance: 0.0, phi: 0.0, basinVelocity: 0.5,
    expected: { wonder: 0.0, frustration: 0.5, satisfaction: 0.0, confusion: 0.0,
      clarity: 0.0, anxiety: 2.0, confidence: 0.0, boredom: 0.5 } },
  { motivators: { surprise: 1.0, curiosity: 0.0, investigation: 0.0, integration: 0.0, transcendence: 0.0 },
    basinDistance: 1.5, phi: 0.0, basinVelocity: 0.0,
    expected: { wonder: 0.0, frustration: 1.0, satisfaction: 0.0, confusion: 1.5,
      clarity: 0.0, anxiety: 0.0, confidence: 0.0, boredom: 0.0 } },
  { motivators: { surprise: 0.0, curiosity: 0.0, investigation: 0.0, integration: 0.0, transcendence: 0.0 },
    basinDistance: 0.0, phi: 0.0, basinVelocity: 0.0,
    expected: { wonder: 0.0, frustration: 0.0, satisfaction: 0.0, confusion: 0.0,
      clarity: 0.0, anxiety: 0.0, confidence: 0.0, boredom: 1.0 } },
  { motivators: { surprise: 0.0, curiosity: 0.0, investigation: 1.0, integration: 0.0, transcendence: 0.0 },
    basinDistance: 0.0, phi: 1.0, basinVelocity: 0.0,
    expected: { wonder: 0.0, frustration: 0.0, satisfaction: 0.0, confusion: 0.0,
      clarity: 1.0, anxiety: 0.0, confidence: 1.0, boredom: 1.0 } },
  { motivators: { surprise: 0.5, curiosity: 0.0, investigation: 0.5, integration: 0.0, transcendence: 3.0 },
    basinDistance: 0.0, phi: 0.4, basinVelocity: 0.0,
    expected: { wonder: 0.0, frustration: 0.25, satisfaction: 0.0, confusion: 0.0,
      clarity: 0.25, anxiety: 0.0, confidence: -0.8, boredom: 0.5 } },
  { motivators: { surprise: 0.5, curiosity: 1.0, investigation: 0.5, integration: 0.0, transcendence: 0.0 },
    basinDistance: 0.7, phi: 0.5, basinVelocity: 0.0,
    expected: { wonder: 0.7, frustration: 0.25, satisfaction: 0.0, confusion: 0.35,
      clarity: 0.25, anxiety: 0.0, confidence: 0.5, boredom: 0.0 } },
  { motivators: { surprise: 0.5, curiosity: 0.5, investigation: 0.5, integration: 1.0, transcendence: 0.5 },
    basinDistance: 0.3, phi: 0.5, basinVelocity: 0.2,
    expected: { wonder: 0.15, frustration: 0.25, satisfaction: 0.7, confusion: 0.15,
      clarity: 0.25, anxiety: 0.1, confidence: 0.25, boredom: 0.25 } },
  { motivators: { surprise: 0.0, curiosity: 0.0, investigation: 0.5, integration: 0.94, transcendence: 0.0 },
    basinDistance: 0.097, phi: 0.5, basinVelocity: 0.1,
    expected: { wonder: 0.0, frustration: 0.0, satisfaction: 0.94 * (1 - 0.097),
      confusion: 0.0, clarity: 0.5, anxiety: 0.0, confidence: 0.5, boredom: 1.0 } },
];

describe('Parity snapshot — 10 rows match Python suite identically', () => {
  PARITY_ROWS.forEach((row, idx) => {
    it(`row ${idx} matches expected`, () => {
      const motivatorIn: Motivators = {
        surprise: 0, curiosity: 0, investigation: 0, integration: 0, transcendence: 0, iQ: 0,
        ...row.motivators,
      };
      const e = computeEmotions(motivatorIn, row.basinDistance, row.phi, row.basinVelocity);
      (Object.keys(row.expected) as Array<keyof typeof row.expected>).forEach((k) => {
        APPROX(e[k as keyof typeof e], row.expected[k]);
      });
    });
  });
});
