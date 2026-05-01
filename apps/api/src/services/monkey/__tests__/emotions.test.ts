/**
 * emotions.test.ts — TS parity for Tier 2 Layer 2B emotions.
 *
 * Mirrors test_emotions.py 1:1. Same 10-row parity snapshot — if
 * either side disagrees with the hardcoded expectations, parity
 * is broken. Also covers computeFundingDrag and computeEmotions
 * with fundingDrag (identical rows to the Python funding parity table).
 */
import { describe, it, expect } from 'vitest';
import { computeEmotions, computeFundingDrag } from '../emotions.js';
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

// ─── Funding drag (cost-on-margin) ─────────────────────────────────

describe('Funding drag pulls confidence down geometrically', () => {
  it('drag=0 leaves confidence/anxiety unchanged', () => {
    const base = computeEmotions(m({ transcendence: 0.3 }), 0, 0.7, 0.1);
    const eq = computeEmotions(m({ transcendence: 0.3 }), 0, 0.7, 0.1, { fundingDrag: 0 });
    APPROX(eq.confidence, base.confidence);
    APPROX(eq.anxiety, base.anxiety);
  });
  it('drag=0.5 reduces confidence by ~33% and adds ~0.333 to anxiety', () => {
    const base = computeEmotions(m({ transcendence: 0.3 }), 0, 0.7, 0.1);
    const dragged = computeEmotions(m({ transcendence: 0.3 }), 0, 0.7, 0.1, { fundingDrag: 0.5 });
    // drag_factor = 0.5 / 1.5 = 1/3
    APPROX(dragged.confidence, base.confidence * (1 - 1 / 3), 1e-9);
    APPROX(dragged.anxiety, base.anxiety + 1 / 3, 1e-9);
    expect(dragged.confidence).toBeLessThan(base.confidence);
    expect(dragged.anxiety).toBeGreaterThan(base.anxiety);
  });
  it('drag→∞ collapses confidence to ~0 and lifts anxiety toward +1', () => {
    const dragged = computeEmotions(m({ transcendence: 0.3 }), 0, 0.7, 0.1, { fundingDrag: 1e6 });
    expect(dragged.confidence).toBeLessThan(1e-3);
    expect(dragged.anxiety).toBeGreaterThan(0.99);
  });
});

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

// ─── computeFundingDrag — mirrors Python test_emotions.py ─────────

describe('computeFundingDrag', () => {
  it('returns 0 when no position (null)', () => {
    APPROX(computeFundingDrag(null, 0.0001, 8), 0);
  });
  it('returns 0 when hours_held is 0', () => {
    APPROX(computeFundingDrag('long', 0.0001, 0), 0);
  });
  it('returns 0 when hours_held is negative', () => {
    APPROX(computeFundingDrag('long', 0.0001, -1), 0);
  });
  it('long bleeds when rate positive', () => {
    APPROX(computeFundingDrag('long', 0.0001, 8), 0.0001);
  });
  it('long has no drag when rate negative (funding favours long)', () => {
    APPROX(computeFundingDrag('long', -0.0001, 8), 0);
  });
  it('short bleeds when rate negative', () => {
    APPROX(computeFundingDrag('short', -0.0001, 8), 0.0001);
  });
  it('short has no drag when rate positive (funding favours short)', () => {
    APPROX(computeFundingDrag('short', 0.0001, 8), 0);
  });
  it('drag grows linearly with hoursHeld', () => {
    const drag8 = computeFundingDrag('long', 0.0001, 8);
    const drag24 = computeFundingDrag('long', 0.0001, 24);
    APPROX(drag24, 3 * drag8);
  });
});

// ─── Funding drag parity table — IDENTICAL rows to Python suite ───

interface FundingParityRow {
  positionSide: 'long' | 'short' | null;
  rate8h: number;
  hoursHeld: number;
  expectedDrag: number;
}

const FUNDING_PARITY_ROWS: FundingParityRow[] = [
  { positionSide: null,    rate8h:  0.0001, hoursHeld:  8, expectedDrag: 0.0 },
  { positionSide: 'long',  rate8h:  0.0,    hoursHeld:  8, expectedDrag: 0.0 },
  { positionSide: 'long',  rate8h:  0.0001, hoursHeld:  8, expectedDrag: 0.0001 },
  { positionSide: 'long',  rate8h:  0.0001, hoursHeld: 24, expectedDrag: 0.0003 },
  { positionSide: 'short', rate8h:  0.0001, hoursHeld:  8, expectedDrag: 0.0 },
  { positionSide: 'short', rate8h: -0.0002, hoursHeld: 16, expectedDrag: 0.0004 },
];

describe('Funding drag parity snapshot — matches Python suite identically', () => {
  FUNDING_PARITY_ROWS.forEach((row, idx) => {
    it(`funding parity row ${idx}`, () => {
      const drag = computeFundingDrag(row.positionSide, row.rate8h, row.hoursHeld);
      APPROX(drag, row.expectedDrag);
    });
  });
});

// ─── computeEmotions with fundingDrag ────────────────────────────

describe('computeEmotions with fundingDrag', () => {
  it('default (omitted) preserves bit-identical behavior vs explicit 0', () => {
    const base = computeEmotions(m({ transcendence: 0.5 }), 0.3, 0.5, 0.2);
    const explicitZero = computeEmotions(m({ transcendence: 0.5 }), 0.3, 0.5, 0.2, { fundingDrag: 0 });
    APPROX(base.anxiety, explicitZero.anxiety);
  });
  it('non-zero fundingDrag increases anxiety by drag_factor (Möbius)', () => {
    const base = computeEmotions(m({ transcendence: 0.5 }), 0.3, 0.5, 0.2, { fundingDrag: 0 });
    const dragged = computeEmotions(m({ transcendence: 0.5 }), 0.3, 0.5, 0.2, { fundingDrag: 0.003 });
    // drag_factor = 0.003 / (1 + 0.003) — Möbius saturation, not raw drag
    const dragFactor = 0.003 / (1 + 0.003);
    APPROX(dragged.anxiety, base.anxiety + dragFactor, 1e-12);
  });
  it('fundingDrag does not affect non-anxiety/confidence emotions', () => {
    const base = computeEmotions(m({ surprise: 0.4, curiosity: 0.6, transcendence: 0.5 }), 0.3, 0.5, 0.2, { fundingDrag: 0 });
    const dragged = computeEmotions(m({ surprise: 0.4, curiosity: 0.6, transcendence: 0.5 }), 0.3, 0.5, 0.2, { fundingDrag: 0.005 });
    for (const attr of ['wonder', 'frustration', 'satisfaction', 'confusion', 'clarity', 'boredom'] as const) {
      APPROX(base[attr], dragged[attr]);
    }
    // confidence IS reduced by drag_factor; anxiety IS increased by drag_factor
    expect(dragged.confidence).toBeLessThan(base.confidence);
    expect(dragged.anxiety).toBeGreaterThan(base.anxiety);
  });
});
