/**
 * laneMultiplierFromTickPeriod.test.ts — observer-derived lane multiplier
 * (post-#1009 cascading-knob-strip).
 *
 * The function now reads lane decision period from `substrate_observer`
 * (operator no-knob doctrine 2026-05-29). The prior
 * `LANE_DECISION_PERIOD_MS = {60_000, 180_000, 600_000}` hardcoded table
 * has been removed.
 *
 * Tests seed the observer with synthetic decision-change samples to
 * verify the function's derivation. The expected periods (60s scalp,
 * 180s swing, 600s trend) match the legacy values because that's what
 * the kernel converges on empirically — the OBSERVATIONS reproduce the
 * old designer table, but now via measurement instead of declaration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import {
  recordLaneDecision,
  _resetSubstrateObserverState,
} from '../substrate_observer.js';

/**
 * Helper — seed the substrate observer with synthetic decision-change
 * samples for `lane` at the given interval (the observer median
 * converges to the seeded interval). Uses a unique decisionTag per
 * push so every call is a change.
 */
function seedObservedPeriod(
  lane: 'scalp' | 'swing' | 'trend',
  intervalMs: number,
  samples: number,
): void {
  for (let i = 0; i < samples; i++) {
    // Each call has a unique tag so it counts as a change.
    recordLaneDecision(lane, i * intervalMs, `decision-${i}`);
  }
}

describe('laneMultiplierFromTickPeriod — observer-derived (60s seed)', () => {
  beforeEach(() => _resetSubstrateObserverState());

  describe('canonical 30s tick (default base cadence)', () => {
    it('scalp → 2 (= 60/30)', () => {
      seedObservedPeriod('scalp', 60_000, 5);
      expect(laneMultiplierFromTickPeriod('scalp', 30_000)).toBe(2);
    });
    it('swing → 6 (= 180/30)', () => {
      seedObservedPeriod('swing', 180_000, 5);
      expect(laneMultiplierFromTickPeriod('swing', 30_000)).toBe(6);
    });
    it('trend → 20 (= 600/30)', () => {
      seedObservedPeriod('trend', 600_000, 5);
      expect(laneMultiplierFromTickPeriod('trend', 30_000)).toBe(20);
    });
  });

  describe('fast tick 15s (EXPLORATION mode) — more confirmation per lane', () => {
    it('scalp → 4', () => {
      seedObservedPeriod('scalp', 60_000, 5);
      expect(laneMultiplierFromTickPeriod('scalp', 15_000)).toBe(4);
    });
    it('swing → 12', () => {
      seedObservedPeriod('swing', 180_000, 5);
      expect(laneMultiplierFromTickPeriod('swing', 15_000)).toBe(12);
    });
    it('trend → 40', () => {
      seedObservedPeriod('trend', 600_000, 5);
      expect(laneMultiplierFromTickPeriod('trend', 15_000)).toBe(40);
    });
  });

  describe('slow tick 60s (INTEGRATION/DRIFT) — matches legacy hardcoded {2, 3, 10}', () => {
    it('scalp → 2 (floor — 60/60 = 1, floored to 2)', () => {
      seedObservedPeriod('scalp', 60_000, 5);
      expect(laneMultiplierFromTickPeriod('scalp', 60_000)).toBe(2);
    });
    it('swing → 3', () => {
      seedObservedPeriod('swing', 180_000, 5);
      expect(laneMultiplierFromTickPeriod('swing', 60_000)).toBe(3);
    });
    it('trend → 10', () => {
      seedObservedPeriod('trend', 600_000, 5);
      expect(laneMultiplierFromTickPeriod('trend', 60_000)).toBe(10);
    });
  });
});

describe('laneMultiplierFromTickPeriod — floor / defensive / cold-start', () => {
  beforeEach(() => _resetSubstrateObserverState());

  it('floor at 2 — degenerate fast tick still requires ≥ 2 ticks', () => {
    seedObservedPeriod('scalp', 60_000, 5);
    expect(laneMultiplierFromTickPeriod('scalp', 100_000)).toBe(2);
  });

  it('zero tick period → floor (defensive)', () => {
    seedObservedPeriod('scalp', 60_000, 5);
    expect(laneMultiplierFromTickPeriod('scalp', 0)).toBe(2);
    seedObservedPeriod('swing', 180_000, 5);
    expect(laneMultiplierFromTickPeriod('swing', 0)).toBe(2);
    seedObservedPeriod('trend', 600_000, 5);
    expect(laneMultiplierFromTickPeriod('trend', 0)).toBe(2);
  });

  it('cold-start observer (no samples) → floor 2', () => {
    // No seed call — observer has no decision-change samples yet.
    expect(laneMultiplierFromTickPeriod('scalp', 30_000)).toBe(2);
    expect(laneMultiplierFromTickPeriod('swing', 30_000)).toBe(2);
    expect(laneMultiplierFromTickPeriod('trend', 30_000)).toBe(2);
  });

  it('NaN tick period → floor (defensive)', () => {
    seedObservedPeriod('scalp', 60_000, 5);
    expect(laneMultiplierFromTickPeriod('scalp', NaN)).toBe(2);
  });

  it('Infinity tick period → floor', () => {
    seedObservedPeriod('scalp', 60_000, 5);
    expect(laneMultiplierFromTickPeriod('scalp', Infinity)).toBe(2);
  });
});
