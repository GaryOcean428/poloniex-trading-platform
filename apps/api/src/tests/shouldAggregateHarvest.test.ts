/**
 * Tests for shouldAggregateHarvest — the cross-kernel companion to
 * shouldProfitHarvest.
 *
 * Decides on harvest based on AGGREGATE PnL (from aggregatePeakTracker,
 * which FAT writes from its exchange-position view), not per-subset
 * PnL. Fires when aggregate peak ≥ MONKEY_HARVEST_AGG_PEAK_USD AND
 * aggregate current has given back past peak × (1 - giveback) but is
 * still positive.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shouldAggregateHarvest } from '../services/monkey/executive.js';
import type { BasinState } from '../services/monkey/executive.js';

const baselineBasin: BasinState = {
  phi: 0.5,
  sovereignty: 1.0,
  basinVelocity: 0.05,
  neurochemistry: {
    acetylcholine: 0.5,
    dopamine: 0.5,
    serotonin: 0.5,
    norepinephrine: 0.5,
    gaba: 0.5,
    endorphins: 0.5,
  },
} as unknown as BasinState;

describe('shouldAggregateHarvest', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.MONKEY_HARVEST_AGG_PEAK_USD;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('null inputs (FAT not yet observing)', () => {
    it('returns false when aggregateCurrent is null', () => {
      const r = shouldAggregateHarvest(null, 5.0, baselineBasin);
      expect(r.value).toBe(false);
      expect(r.reason).toContain('aggregate_unavailable');
    });

    it('returns false when aggregatePeak is null', () => {
      const r = shouldAggregateHarvest(2.0, null, baselineBasin);
      expect(r.value).toBe(false);
      expect(r.reason).toContain('aggregate_unavailable');
    });
  });

  describe('default threshold $3', () => {
    it('fires when aggregate peak $5 dropped to $2 (gave back 60%)', () => {
      // Default giveback at serotonin=0.5 → 0.30 + 0.20*0.5 = 0.40
      // floor = $5 * (1 - 0.40) = $3
      // current $2 < $3 floor → fires
      const r = shouldAggregateHarvest(2.0, 5.0, baselineBasin);
      expect(r.value).toBe(true);
      expect(r.reason).toContain('aggregate_harvest');
    });

    it('reproduces operator-observed incident: peak $3, dropped to $1', () => {
      // Operator: "just missed a $3" — aggregate peaked at ~$3, fell.
      // With $3 default threshold, gate just arms (peak ≥ $3).
      // floor = $3 * 0.6 = $1.80. current $1 < $1.80 → fires.
      const r = shouldAggregateHarvest(1.0, 3.0, baselineBasin);
      expect(r.value).toBe(true);
      expect(r.reason).toContain('aggregate_harvest');
    });

    it('2026-05-25 strip — $3 aggregate threshold removed; any peak with give-back fires', () => {
      // Pre-strip: $2.50 peak < $3 default kept aggregate quiet.
      // Post-strip: threshold is 0, so $2.50 peak with give-back to
      // $0.80 (32% give-back) triggers. Chemistry decides timing.
      const r = shouldAggregateHarvest(0.8, 2.5, baselineBasin);
      expect(r.value).toBe(true);
      expect(r.reason).toContain('aggregate_harvest');
    });

    it('does NOT fire when aggregate is still at peak (no giveback)', () => {
      const r = shouldAggregateHarvest(5.0, 5.0, baselineBasin);
      expect(r.value).toBe(false);
    });

    it('does NOT fire when aggregate has gone negative (SL territory)', () => {
      const r = shouldAggregateHarvest(-1.0, 5.0, baselineBasin);
      expect(r.value).toBe(false);
    });

    it('fires when aggregate peak $4 and gave back to $0.50', () => {
      // floor = $4 * 0.6 = $2.40. current $0.50 < $2.40, current > 0 → fires.
      const r = shouldAggregateHarvest(0.50, 4.0, baselineBasin);
      expect(r.value).toBe(true);
    });
  });

  describe('env override (2026-05-25 strip — env read removed)', () => {
    it('env var is ignored after strip; threshold is always 0', () => {
      process.env.MONKEY_HARVEST_AGG_PEAK_USD = '10';
      // Pre-strip: $10 override would gate $5 peak. Post-strip: env read
      // removed, threshold is 0, give-back fires regardless.
      const r = shouldAggregateHarvest(2.0, 5.0, baselineBasin);
      expect(r.value).toBe(true);
      delete process.env.MONKEY_HARVEST_AGG_PEAK_USD;
    });
  });

  describe('derivation telemetry', () => {
    it('exposes peak, current, floor for log/dashboard surfaces', () => {
      const r = shouldAggregateHarvest(2.0, 5.0, baselineBasin);
      expect(r.derivation.aggregateCurrentPnlUsdt).toBe(2.0);
      expect(r.derivation.aggregatePeakPnlUsdt).toBe(5.0);
      expect(r.derivation.floor).toBeCloseTo(3.0, 5);
      expect(r.derivation.exitTypeBit).toBe(5);
    });
  });
});
