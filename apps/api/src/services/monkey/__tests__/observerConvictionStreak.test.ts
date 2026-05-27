/**
 * observerConvictionStreak.test.ts — Commit 4 (Cascade brief 2026-05-27).
 *
 * Pins the observer-derived conviction streak requirement: the floor
 * (2) for monotonic collapse, the cap (12) for highly oscillatory
 * emotion telemetry, and the scaling between them.
 *
 * Py-side _observer_conviction_streak_required mirrors this exactly.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 8765,
    DATABASE_URL: 'postgresql://test:5432/test',
    JWT_SECRET: 'test-jwt-secret-32-characters-xxxxxxxxxx',
  },
}));
vi.mock('../../../db/connection.js', () => ({
  pool: { query: vi.fn() },
}));

import {
  observerConvictionStreakRequired,
  CONVICTION_STREAK_FLOOR,
  CONVICTION_HESITATION_WINDOW,
  CONVICTION_STREAK_CAP,
} from '../loop.js';

describe('observerConvictionStreakRequired — floor / cap / window constants', () => {
  it('floor is 2 (HISTORY_MIN_SAMPLES sentinel)', () => {
    expect(CONVICTION_STREAK_FLOOR).toBe(2);
  });
  it('window is 20 ticks', () => {
    expect(CONVICTION_HESITATION_WINDOW).toBe(20);
  });
  it('cap is 12 (safety ceiling)', () => {
    expect(CONVICTION_STREAK_CAP).toBe(12);
  });
});

describe('observerConvictionStreakRequired — boundary inputs', () => {
  it('empty history → floor', () => {
    expect(observerConvictionStreakRequired([])).toBe(2);
  });
  it('single sample → floor', () => {
    expect(observerConvictionStreakRequired([0.5])).toBe(2);
  });
});

describe('observerConvictionStreakRequired — monotonic collapse fires at floor', () => {
  it('all positive, no flips → floor (monotonic gate hold)', () => {
    const history = [0.1, 0.2, 0.3, 0.4, 0.5];
    expect(observerConvictionStreakRequired(history)).toBe(2);
  });
  it('all negative, no flips → floor (monotonic gate not held)', () => {
    const history = [-0.1, -0.2, -0.3, -0.4, -0.5];
    expect(observerConvictionStreakRequired(history)).toBe(2);
  });
});

describe('observerConvictionStreakRequired — oscillation lifts requirement', () => {
  it('every-tick sign flip (max oscillation) → cap', () => {
    const history = [0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1];
    expect(observerConvictionStreakRequired(history)).toBe(12);
  });

  it('half of pairs flip → mid-range (≈ floor + (cap-floor)) ≈ 12 with rounding', () => {
    // 10 samples, 5 flips → flip rate ~0.55. Scaled = 2 + round(0.55*20) = 13 → clamped to 12.
    const history = [0.1, -0.1, -0.2, 0.1, -0.1, -0.2, 0.1, -0.1, -0.2, 0.1];
    const r = observerConvictionStreakRequired(history);
    expect(r).toBeGreaterThanOrEqual(8);
    expect(r).toBeLessThanOrEqual(12);
  });

  it('quarter flip rate → moderate increase', () => {
    // 10 samples, 2 flips → flip rate ~0.22. Scaled = 2 + round(0.22*20) ≈ 6.
    const history = [0.1, 0.2, 0.3, -0.1, -0.2, 0.1, 0.2, 0.3, 0.4, 0.5];
    const r = observerConvictionStreakRequired(history);
    expect(r).toBeGreaterThanOrEqual(2);
    expect(r).toBeLessThanOrEqual(8);
  });
});

describe('observerConvictionStreakRequired — zero-crossings handled as flips', () => {
  it('positive → zero → positive: zero treated as neutral (no flip)', () => {
    const history = [0.5, 0, 0.5, 0, 0.5];
    expect(observerConvictionStreakRequired(history)).toBe(2);
  });
});
