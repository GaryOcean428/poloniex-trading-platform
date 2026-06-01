/**
 * predictionRewardEmitter.test.ts — pure-function tests for the
 * prediction-residual chemistry emitter (#941 Phase 3).
 */
import { describe, it, expect } from 'vitest';
import {
  summariseFromRows,
  medianAbsoluteDeviation,
  predictionChemistryDeltas,
} from '../predictionRewardEmitter.js';

describe('medianAbsoluteDeviation', () => {
  it('returns zero on empty input', () => {
    expect(medianAbsoluteDeviation([])).toBe(0);
  });

  it('returns zero on a constant sample', () => {
    expect(medianAbsoluteDeviation([3, 3, 3, 3])).toBe(0);
  });

  it('matches the textbook example MAD([1,2,3,4,5]) = 1', () => {
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1);
  });

  it('is unaffected by a single outlier (50% breakdown)', () => {
    // Without outlier: MAD([1,2,3,4,5]) = 1
    // With outlier 1000: median still 3 or near, MAD bounded.
    const without = medianAbsoluteDeviation([1, 2, 3, 4, 5]);
    const withOutlier = medianAbsoluteDeviation([1, 2, 3, 4, 5, 1000]);
    expect(withOutlier).toBeLessThan(without * 3);
  });
});

describe('summariseFromRows', () => {
  it('returns empty summary on empty input', () => {
    const s = summariseFromRows([]);
    expect(s.n).toBe(0);
    expect(s.directionMatchRate).toBe(0);
    expect(s.within1SigmaRate).toBe(0);
    expect(s.madResidualNormalized).toBe(0);
  });

  it('computes rates and MAD for mixed rows', () => {
    const s = summariseFromRows([
      { direction_match: true,  within_1_sigma: true,  residual_normalized: 0.5 },
      { direction_match: true,  within_1_sigma: false, residual_normalized: -0.5 },
      { direction_match: false, within_1_sigma: true,  residual_normalized: 1.0 },
      { direction_match: false, within_1_sigma: true,  residual_normalized: -1.0 },
    ]);
    expect(s.n).toBe(4);
    expect(s.directionMatchRate).toBeCloseTo(0.5);
    expect(s.within1SigmaRate).toBeCloseTo(0.75);
    expect(s.madResidualNormalized).toBeGreaterThan(0);
  });

  it('coerces string residual_normalized (Postgres numeric returns)', () => {
    const s = summariseFromRows([
      { direction_match: true, within_1_sigma: true, residual_normalized: '0.5' },
      { direction_match: true, within_1_sigma: true, residual_normalized: '-0.5' },
    ]);
    expect(s.madResidualNormalized).toBeCloseTo(0.5);
  });

  it('reports evaluated sample age span when timestamps are present', () => {
    const s = summariseFromRows([
      { direction_match: true, within_1_sigma: true, residual_normalized: 0.5, evaluated_at: '2026-06-01T00:05:00.000Z' },
      { direction_match: true, within_1_sigma: true, residual_normalized: -0.5, evaluated_at: '2026-06-01T00:00:00.000Z' },
    ]);
    expect(s.sampleAgeSpanMs).toBe(5 * 60 * 1000);
  });
});

describe('predictionChemistryDeltas', () => {
  it('returns zero deltas below MIN_SAMPLES (n=4 < 5)', () => {
    const d = predictionChemistryDeltas({
      n: 4,
      directionMatchRate: 1.0,
      within1SigmaRate: 1.0,
      madResidualNormalized: 0.6745,
      sampleAgeSpanMs: 0,
    });
    expect(d.dopamineDelta).toBe(0);
    expect(d.serotoninDelta).toBe(0);
    expect(d.source).toContain('insufficient');
  });

  it('zero dop at chance-rate direction-match (0.5)', () => {
    const d = predictionChemistryDeltas({
      n: 20,
      directionMatchRate: 0.5,
      within1SigmaRate: 0.68,
      madResidualNormalized: 0.6745,
      sampleAgeSpanMs: 0,
    });
    expect(d.dopamineDelta).toBeCloseTo(0, 6);
  });

  it('positive dop when direction-match beats chance', () => {
    const d = predictionChemistryDeltas({
      n: 20,
      directionMatchRate: 0.9,
      within1SigmaRate: 0.7,
      madResidualNormalized: 0.6745,
      sampleAgeSpanMs: 0,
    });
    expect(d.dopamineDelta).toBeGreaterThan(0);
    // tanh(0.4) * 0.5 ≈ 0.190
    expect(d.dopamineDelta).toBeCloseTo(0.190, 2);
  });

  it('zero dop when direction-match is worse than chance (anti-windup, predictionRewardEmitter.ts:208)', () => {
    // Surgical anti-windup: persistent anti-correlation
    // (directionMatchRate < CHANCE_RATE) returns dopamineDelta=0
    // instead of bleeding negative chemistry forever. Restores the
    // channel as soon as the predictor recovers to at least chance.
    const d = predictionChemistryDeltas({
      n: 20,
      directionMatchRate: 0.1,
      within1SigmaRate: 0.7,
      madResidualNormalized: 0.6745,
      sampleAgeSpanMs: 0,
    });
    expect(d.dopamineDelta).toBe(0);
    expect(d.serotoninDelta).toBe(0);
    expect(d.source).toMatch(/anti_correlated/);
  });

  it('dop bounded by DOPAMINE_CAP=0.5 even at perfect prediction', () => {
    const d = predictionChemistryDeltas({
      n: 20,
      directionMatchRate: 1.0,
      within1SigmaRate: 1.0,
      madResidualNormalized: 0.6745,
      sampleAgeSpanMs: 0,
    });
    expect(d.dopamineDelta).toBeLessThanOrEqual(0.5);
    expect(d.dopamineDelta).toBeGreaterThan(0.2);
  });

  it('zero ser at perfect calibration (MAD = std-normal MAD 0.6745)', () => {
    const d = predictionChemistryDeltas({
      n: 20,
      directionMatchRate: 0.5,
      within1SigmaRate: 0.68,
      madResidualNormalized: 0.6745,
      sampleAgeSpanMs: 0,
    });
    expect(d.serotoninDelta).toBeCloseTo(0, 6);
  });

  it('negative ser on under-confident (MAD too small) forecasts', () => {
    // Tight residuals (MAD << 0.6745) = forecasts too wide = under-confident
    const d = predictionChemistryDeltas({
      n: 20,
      directionMatchRate: 0.5,
      within1SigmaRate: 0.9,
      madResidualNormalized: 0.1,
      sampleAgeSpanMs: 0,
    });
    expect(d.serotoninDelta).toBeLessThan(0);
  });

  it('negative ser on over-confident (MAD too large) forecasts', () => {
    // Wide residuals (MAD >> 0.6745) = forecasts too narrow = over-confident
    const d = predictionChemistryDeltas({
      n: 20,
      directionMatchRate: 0.5,
      within1SigmaRate: 0.3,
      madResidualNormalized: 3.0,
      sampleAgeSpanMs: 0,
    });
    expect(d.serotoninDelta).toBeLessThan(0);
  });

  it('ser bounded by SEROTONIN_CAP=0.2', () => {
    const d = predictionChemistryDeltas({
      n: 20,
      directionMatchRate: 0.5,
      within1SigmaRate: 0.0,
      madResidualNormalized: 100,
      sampleAgeSpanMs: 0,
    });
    expect(d.serotoninDelta).toBeGreaterThanOrEqual(-0.2);
    expect(d.serotoninDelta).toBeLessThan(-0.15);
  });

  it('source string carries the sample size', () => {
    const d = predictionChemistryDeltas({
      n: 17,
      directionMatchRate: 0.5,
      within1SigmaRate: 0.68,
      madResidualNormalized: 0.6745,
      sampleAgeSpanMs: 12_345,
    });
    expect(d.source).toContain('n=17');
    expect(d.source).toContain('age_span_ms=12345');
  });
});
