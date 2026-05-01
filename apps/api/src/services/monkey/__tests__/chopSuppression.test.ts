/**
 * chopSuppression.test.ts — CHOP regime entry suppression (issue #623).
 *
 * Decision table (TS/Python parity):
 *   - trend + CHOP + confidence 0.75  → suppressed
 *   - trend + CHOP + confidence 0.65  → proceeds
 *   - trend + TREND_UP                → proceeds
 *   - swing + CHOP + confidence 0.80  → proceeds (below swing threshold 0.85)
 *   - swing + CHOP + confidence 0.90  → suppressed
 *   - scalp + CHOP + confidence 0.99  → proceeds (scalp never suspended)
 */
import { describe, it, expect } from 'vitest';
import {
  chopSuppressEntry,
  CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT,
  CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT,
  type RegimeReading,
} from '../regime.js';

function chopReading(confidence: number): RegimeReading {
  return { regime: 'CHOP', confidence, trendStrength: 0, chopScore: 0.9 };
}

function trendUpReading(confidence = 0.8): RegimeReading {
  return { regime: 'TREND_UP', confidence, trendStrength: 0.5, chopScore: 0.1 };
}

function trendDownReading(confidence = 0.8): RegimeReading {
  return { regime: 'TREND_DOWN', confidence, trendStrength: -0.5, chopScore: 0.1 };
}

describe('chopSuppressEntry — decision table', () => {
  it('trend + CHOP + confidence 0.75 → suppressed', () => {
    const r = chopSuppressEntry(chopReading(0.75), 'trend');
    expect(r.suppressed).toBe(true);
    expect(r.suppressReason).toContain('trend');
    expect(r.suppressReason).toContain('chop');
  });

  it('trend + CHOP + confidence 0.65 → proceeds', () => {
    const r = chopSuppressEntry(chopReading(0.65), 'trend');
    expect(r.suppressed).toBe(false);
    expect(r.suppressReason).toBeNull();
  });

  it('trend + CHOP + confidence 0.70 → suppressed (boundary inclusive)', () => {
    const r = chopSuppressEntry(chopReading(0.70), 'trend');
    expect(r.suppressed).toBe(true);
  });

  it('trend + TREND_UP → proceeds regardless of confidence', () => {
    const r = chopSuppressEntry(trendUpReading(0.99), 'trend');
    expect(r.suppressed).toBe(false);
    expect(r.suppressReason).toBeNull();
  });

  it('trend + TREND_DOWN → proceeds regardless of confidence', () => {
    const r = chopSuppressEntry(trendDownReading(0.99), 'trend');
    expect(r.suppressed).toBe(false);
  });

  it('swing + CHOP + confidence 0.80 → proceeds (below swing threshold 0.85)', () => {
    const r = chopSuppressEntry(chopReading(0.80), 'swing');
    expect(r.suppressed).toBe(false);
    expect(r.suppressReason).toBeNull();
  });

  it('swing + CHOP + confidence 0.90 → suppressed', () => {
    const r = chopSuppressEntry(chopReading(0.90), 'swing');
    expect(r.suppressed).toBe(true);
    expect(r.suppressReason).toContain('swing');
  });

  it('swing + CHOP + confidence 0.85 → suppressed (boundary inclusive)', () => {
    const r = chopSuppressEntry(chopReading(0.85), 'swing');
    expect(r.suppressed).toBe(true);
  });

  it('scalp + CHOP + confidence 0.99 → proceeds (scalp never suspended)', () => {
    const r = chopSuppressEntry(chopReading(0.99), 'scalp');
    expect(r.suppressed).toBe(false);
    expect(r.suppressReason).toBeNull();
  });

  it('scalp is never suspended at any confidence', () => {
    for (const conf of [0.5, 0.70, 0.85, 0.99, 1.0]) {
      const r = chopSuppressEntry(chopReading(conf), 'scalp');
      expect(r.suppressed).toBe(false);
    }
  });
});

describe('chopSuppressEntry — telemetry fields', () => {
  it('result fields populated when suppressed', () => {
    const r = chopSuppressEntry(chopReading(0.90), 'trend');
    expect(r.regime).toBe('CHOP');
    expect(r.confidence).toBeCloseTo(0.90);
    expect(r.lane).toBe('trend');
    expect(r.suppressed).toBe(true);
    expect(typeof r.suppressReason).toBe('string');
  });

  it('result fields populated when not suppressed', () => {
    const r = chopSuppressEntry(trendUpReading(0.8), 'trend');
    expect(r.regime).toBe('TREND_UP');
    expect(r.confidence).toBeCloseTo(0.8);
    expect(r.lane).toBe('trend');
    expect(r.suppressed).toBe(false);
    expect(r.suppressReason).toBeNull();
  });
});

describe('chopSuppressEntry — threshold override', () => {
  it('lower trend threshold triggers suppression earlier', () => {
    const conf = 0.55;
    // Default threshold (0.70) would NOT suppress.
    expect(chopSuppressEntry(chopReading(conf), 'trend').suppressed).toBe(false);
    // Lowered threshold (0.50) SHOULD suppress.
    expect(
      chopSuppressEntry(chopReading(conf), 'trend', { trendConfidenceThreshold: 0.50 }).suppressed,
    ).toBe(true);
  });

  it('raised trend threshold requires more confidence', () => {
    const conf = 0.75;
    // Default threshold (0.70) suppresses.
    expect(chopSuppressEntry(chopReading(conf), 'trend').suppressed).toBe(true);
    // Raised threshold (0.80) should NOT suppress.
    expect(
      chopSuppressEntry(chopReading(conf), 'trend', { trendConfidenceThreshold: 0.80 }).suppressed,
    ).toBe(false);
  });

  it('swing threshold override changes behavior', () => {
    const conf = 0.82;
    // Default (0.85) does NOT suppress.
    expect(chopSuppressEntry(chopReading(conf), 'swing').suppressed).toBe(false);
    // Lowered (0.80) SHOULD suppress.
    expect(
      chopSuppressEntry(chopReading(conf), 'swing', { swingConfidenceThreshold: 0.80 }).suppressed,
    ).toBe(true);
  });
});

describe('chopSuppressEntry — module constants', () => {
  it('trend confidence default is 0.70', () => {
    expect(CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT).toBeCloseTo(0.70);
  });

  it('swing confidence default is 0.85', () => {
    expect(CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT).toBeCloseTo(0.85);
  });
});

describe('TS/Python parity table', () => {
  // Canonical shared decision table — must match test_chop_suppression.py
  const cases: Array<[string, string, number, boolean]> = [
    ['trend', 'CHOP',       0.75, true],
    ['trend', 'CHOP',       0.65, false],
    ['trend', 'CHOP',       0.70, true],
    ['trend', 'TREND_UP',   0.99, false],
    ['trend', 'TREND_DOWN', 0.99, false],
    ['swing', 'CHOP',       0.80, false],
    ['swing', 'CHOP',       0.90, true],
    ['swing', 'CHOP',       0.85, true],
    ['scalp', 'CHOP',       0.99, false],
    ['scalp', 'CHOP',       1.00, false],
  ];

  it.each(cases)(
    'lane=%s regime=%s confidence=%s → suppressed=%s',
    (lane, regimeLabel, confidence, expectedSuppressed) => {
      const reading: RegimeReading = {
        regime: regimeLabel as RegimeReading['regime'],
        confidence,
        trendStrength: regimeLabel.includes('TREND') ? 0.5 : 0,
        chopScore: regimeLabel.includes('TREND') ? 0.1 : 0.9,
      };
      const result = chopSuppressEntry(reading, lane);
      expect(result.suppressed).toBe(expectedSuppressed);
    },
  );
});
