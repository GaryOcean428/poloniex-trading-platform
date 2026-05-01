/**
 * chopSuppression.test.ts — direct CC directive (2026-04-30 trade tape).
 *
 * The kernel reads the regime classifier's own confidence and suspends
 * NEW entries when it reads sustained chop above the threshold. Held
 * positions (re-justification + harvest) are unaffected. The threshold
 * lives on the classifier's [0, 1] confidence scale, not a synthesized
 * magic number.
 */
import { describe, it, expect } from 'vitest';
import {
  CHOP_SUPPRESSION_CONFIDENCE,
  isChopSuppressed,
  type RegimeReading,
} from '../regime.js';

const reading = (
  overrides: Partial<RegimeReading> = {},
): RegimeReading => ({
  regime: 'CHOP',
  confidence: 0.5,
  trendStrength: 0,
  chopScore: 0.6,
  ...overrides,
});

describe('CHOP suppression threshold', () => {
  it('threshold is 0.70 (anchored on classifier confidence)', () => {
    expect(CHOP_SUPPRESSION_CONFIDENCE).toBeCloseTo(0.70, 12);
  });
});

describe('isChopSuppressed predicate', () => {
  it('CHOP at confidence 0.85 suppresses', () => {
    expect(isChopSuppressed(reading({ regime: 'CHOP', confidence: 0.85 }))).toBe(true);
  });
  it('CHOP just above threshold suppresses', () => {
    expect(isChopSuppressed(reading({ regime: 'CHOP', confidence: 0.71 }))).toBe(true);
  });
  it('CHOP at exactly threshold does NOT suppress (strict > by design)', () => {
    expect(isChopSuppressed(reading({ regime: 'CHOP', confidence: 0.70 }))).toBe(false);
  });
  it('CHOP at confidence 0.50 does NOT suppress', () => {
    expect(isChopSuppressed(reading({ regime: 'CHOP', confidence: 0.50 }))).toBe(false);
  });
  it('TREND_UP at confidence 0.95 does NOT suppress', () => {
    expect(
      isChopSuppressed(reading({ regime: 'TREND_UP', confidence: 0.95, trendStrength: 0.5, chopScore: 0.1 })),
    ).toBe(false);
  });
  it('TREND_DOWN at confidence 0.95 does NOT suppress', () => {
    expect(
      isChopSuppressed(reading({ regime: 'TREND_DOWN', confidence: 0.95, trendStrength: -0.5, chopScore: 0.1 })),
    ).toBe(false);
  });
});
