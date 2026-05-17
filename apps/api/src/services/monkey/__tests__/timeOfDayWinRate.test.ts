import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordLaneOutcome,
  weightedWinRate,
  _resetLaneOutcomes,
  _peekLaneOutcomes,
} from '../time_of_day_winrate.js';

describe('weightedWinRate — phase-weighted lane prior', () => {
  beforeEach(() => _resetLaneOutcomes());

  it('returns neutral (rate=0.5, warmup=true) when no trades recorded', () => {
    const r = weightedWinRate('scalp');
    expect(r.rate).toBe(0.5);
    expect(r.warmup).toBe(true);
    expect(r.rawN).toBe(0);
  });

  it('returns warmup until MIN_SAMPLES (5) recorded', () => {
    for (let i = 0; i < 4; i++) recordLaneOutcome('scalp', true);
    expect(weightedWinRate('scalp').warmup).toBe(true);
    recordLaneOutcome('scalp', true);
    expect(weightedWinRate('scalp').warmup).toBe(false);
  });

  it('all-win at the same time-of-day → rate close to 1', () => {
    const t = new Date('2026-05-17T12:00:00Z');
    for (let i = 0; i < 10; i++) recordLaneOutcome('scalp', true, t);
    const r = weightedWinRate('scalp', t);
    expect(r.rate).toBeGreaterThan(0.99);
    expect(r.warmup).toBe(false);
  });

  it('all-loss at the same time-of-day → rate close to 0', () => {
    const t = new Date('2026-05-17T12:00:00Z');
    for (let i = 0; i < 10; i++) recordLaneOutcome('scalp', false, t);
    expect(weightedWinRate('scalp', t).rate).toBeLessThan(0.01);
  });

  it('50/50 outcomes at the same time → rate ~0.5', () => {
    const t = new Date('2026-05-17T12:00:00Z');
    for (let i = 0; i < 10; i++) recordLaneOutcome('scalp', i % 2 === 0, t);
    expect(weightedWinRate('scalp', t).rate).toBeCloseTo(0.5, 1);
  });

  it('wins at noon weighted higher when queried at noon than queried at midnight', () => {
    const noon = new Date('2026-05-17T12:00:00Z');
    const midnight = new Date('2026-05-17T00:00:00Z');
    // 5 wins at noon, 5 losses at midnight
    for (let i = 0; i < 5; i++) recordLaneOutcome('swing', true, noon);
    for (let i = 0; i < 5; i++) recordLaneOutcome('swing', false, midnight);
    const atNoon = weightedWinRate('swing', noon);
    const atMidnight = weightedWinRate('swing', midnight);
    // At noon: noon wins weighted ~1.0, midnight losses weighted ~exp(-4)
    expect(atNoon.rate).toBeGreaterThan(0.9);
    // At midnight: midnight losses weighted ~1.0, noon wins weighted ~exp(-4)
    expect(atMidnight.rate).toBeLessThan(0.1);
  });

  it('per-lane isolation — recording on scalp does not affect swing', () => {
    for (let i = 0; i < 10; i++) recordLaneOutcome('scalp', true);
    const scalp = weightedWinRate('scalp');
    const swing = weightedWinRate('swing');
    expect(scalp.rate).toBeGreaterThan(0.99);
    expect(swing.warmup).toBe(true);
    expect(swing.rate).toBe(0.5);
  });

  it('history capped at MAX_HISTORY (200) — oldest entries fall off', () => {
    const t = new Date('2026-05-17T12:00:00Z');
    for (let i = 0; i < 250; i++) recordLaneOutcome('trend', true, t);
    expect(_peekLaneOutcomes('trend')).toHaveLength(200);
  });

  it('mixed-quality session: more recent (same-phase) outcomes dominate', () => {
    const noon = new Date('2026-05-17T12:00:00Z');
    // 6 losses recorded at 6am (12h away from noon)
    const earlyMorn = new Date('2026-05-17T06:00:00Z');
    for (let i = 0; i < 6; i++) recordLaneOutcome('swing', false, earlyMorn);
    // 5 wins recorded at noon
    for (let i = 0; i < 5; i++) recordLaneOutcome('swing', true, noon);
    // Query at noon — noon wins should dominate
    const r = weightedWinRate('swing', noon);
    expect(r.rate).toBeGreaterThan(0.5);
    expect(r.rawN).toBe(11);
  });

  it('effectiveN is sum of decay weights — bounded above by rawN', () => {
    const t = new Date('2026-05-17T12:00:00Z');
    for (let i = 0; i < 10; i++) recordLaneOutcome('scalp', true, t);
    const r = weightedWinRate('scalp', t);
    expect(r.effectiveN).toBeGreaterThan(0);
    expect(r.effectiveN).toBeLessThanOrEqual(10);
    // All at same time → all weights = 1 → effectiveN = 10
    expect(r.effectiveN).toBeCloseTo(10, 6);
  });
});

describe('_resetLaneOutcomes — diagnostic helper', () => {
  it('with arg clears single lane', () => {
    recordLaneOutcome('scalp', true);
    recordLaneOutcome('swing', true);
    _resetLaneOutcomes('scalp');
    expect(_peekLaneOutcomes('scalp')).toHaveLength(0);
    expect(_peekLaneOutcomes('swing')).toHaveLength(1);
  });

  it('without arg clears all lanes', () => {
    for (const lane of ['scalp', 'swing', 'trend', 'observe'] as const) {
      recordLaneOutcome(lane, true);
    }
    _resetLaneOutcomes();
    for (const lane of ['scalp', 'swing', 'trend', 'observe'] as const) {
      expect(_peekLaneOutcomes(lane)).toHaveLength(0);
    }
  });
});
