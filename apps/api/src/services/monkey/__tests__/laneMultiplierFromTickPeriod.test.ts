/**
 * laneMultiplierFromTickPeriod.test.ts — Commit 2 (Cascade brief 2026-05-27).
 *
 * Replaces the hardcoded DISAGREEMENT_LANE_MULTIPLIER table {scalp:1,
 * swing:3, trend:10} with a derivation from the substrate's actual
 * tick period. Lane definitions encode the wall-clock decision window;
 * dividing by tick period gives the streak length in ticks that
 * occupies that window. Floor 2 prevents single-tick fires.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock env config so importing loop.ts (→ encryptionService → env)
// doesn't blow up on missing DATABASE_URL / JWT_SECRET in the test env.
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

import { laneMultiplierFromTickPeriod } from '../loop.js';

// LANE_DECISION_PERIOD_MS values (must stay in sync with loop.ts):
// scalp 60s, swing 180s, trend 600s.

describe('laneMultiplierFromTickPeriod — canonical adaptive-tick cadences', () => {
  describe('canonical 30s tick (default base cadence)', () => {
    it('scalp → 2 (= 60/30)', () => {
      expect(laneMultiplierFromTickPeriod('scalp', 30_000)).toBe(2);
    });
    it('swing → 6 (= 180/30)', () => {
      expect(laneMultiplierFromTickPeriod('swing', 30_000)).toBe(6);
    });
    it('trend → 20 (= 600/30)', () => {
      expect(laneMultiplierFromTickPeriod('trend', 30_000)).toBe(20);
    });
  });

  describe('fast tick 15s (EXPLORATION mode) — more confirmation per lane', () => {
    it('scalp → 4', () => {
      expect(laneMultiplierFromTickPeriod('scalp', 15_000)).toBe(4);
    });
    it('swing → 12', () => {
      expect(laneMultiplierFromTickPeriod('swing', 15_000)).toBe(12);
    });
    it('trend → 40', () => {
      expect(laneMultiplierFromTickPeriod('trend', 15_000)).toBe(40);
    });
  });

  describe('slow tick 60s (INTEGRATION/DRIFT) — matches legacy hardcoded {1, 3, 10}', () => {
    it('scalp → 2 (floor — would be 1, floored)', () => {
      expect(laneMultiplierFromTickPeriod('scalp', 60_000)).toBe(2);
    });
    it('swing → 3', () => {
      expect(laneMultiplierFromTickPeriod('swing', 60_000)).toBe(3);
    });
    it('trend → 10', () => {
      expect(laneMultiplierFromTickPeriod('trend', 60_000)).toBe(10);
    });
  });
});

describe('laneMultiplierFromTickPeriod — floor and defensive behaviour', () => {
  it('floor at 2 — degenerate fast tick still requires ≥ 2 ticks', () => {
    // Hypothetical scalp at 100s tick (faster than scalp decision window):
    // 60/100 = 0.6 → rounds to 1 → floored to 2
    expect(laneMultiplierFromTickPeriod('scalp', 100_000)).toBe(2);
  });

  it('zero tick period → floor (defensive)', () => {
    expect(laneMultiplierFromTickPeriod('scalp', 0)).toBe(2);
    expect(laneMultiplierFromTickPeriod('swing', 0)).toBe(2);
    expect(laneMultiplierFromTickPeriod('trend', 0)).toBe(2);
  });

  it('negative tick period → floor (defensive)', () => {
    expect(laneMultiplierFromTickPeriod('scalp', -1000)).toBe(2);
  });

  it('NaN tick period → floor (defensive)', () => {
    expect(laneMultiplierFromTickPeriod('scalp', NaN)).toBe(2);
  });

  it('Infinity tick period → floor (1 second tick would be 1 → floored to 2)', () => {
    expect(laneMultiplierFromTickPeriod('scalp', Infinity)).toBe(2);
  });
});

describe('laneMultiplierFromTickPeriod — round-trip with the legacy multiplier', () => {
  it('at 60s tick all three lanes match legacy {1, 3, 10}, except scalp which floors to 2', () => {
    // The legacy table {scalp:1, swing:3, trend:10} encoded behaviour
    // at tickMs=60s. The new derivation matches swing/trend exactly
    // and tightens scalp from 1 → 2 (which removes the single-tick
    // fire that was identified as a source of noise harvest).
    expect(laneMultiplierFromTickPeriod('swing', 60_000)).toBe(3);
    expect(laneMultiplierFromTickPeriod('trend', 60_000)).toBe(10);
    expect(laneMultiplierFromTickPeriod('scalp', 60_000)).toBe(2);
  });
});
