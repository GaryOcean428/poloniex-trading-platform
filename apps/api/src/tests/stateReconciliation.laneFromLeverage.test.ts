/**
 * Tests for inferLaneFromLeverage — operator-conviction → kernel-lane
 * mapping used by the reconciler when adopting orphan exchange positions.
 *
 * Operator directive 2026-05-19: "kernels should take over my trades.
 * but learn from the amount of leverage as to what I expect."
 *
 * Mapping (default bounds; overridable via env):
 *   lev ≤ 3       → scalp  (3%/3% SL/TP — small conviction)
 *   4 ≤ lev ≤ 10  → swing  (15%/15% — medium conviction)
 *   lev ≥ 11      → trend  (40%/40% — high conviction, ride the macro)
 *
 * The two SHORTs from the bleed-diagnosis incident were both opened at
 * 22× — by this mapping they would have been adopted into the trend
 * lane, which has the widest retreat tolerance and the longest hold
 * profile (consistent with the operator's evident conviction signal).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { inferLaneFromLeverage } from '../services/laneFromLeverage.js';

describe('inferLaneFromLeverage', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.MONKEY_ADOPT_SWING_LEV_MIN;
    delete process.env.MONKEY_ADOPT_TREND_LEV_MIN;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('default boundaries (no env override)', () => {
    it('lev=1 → scalp (low conviction)', () => {
      expect(inferLaneFromLeverage(1)).toBe('scalp');
    });

    it('lev=3 → scalp (upper edge of scalp band)', () => {
      expect(inferLaneFromLeverage(3)).toBe('scalp');
    });

    it('lev=4 → swing (lower edge of swing band)', () => {
      expect(inferLaneFromLeverage(4)).toBe('swing');
    });

    it('lev=10 → swing (upper edge of swing band)', () => {
      expect(inferLaneFromLeverage(10)).toBe('swing');
    });

    it('lev=11 → trend (lower edge of trend band)', () => {
      expect(inferLaneFromLeverage(11)).toBe('trend');
    });

    it('lev=22 → trend (the incident shape)', () => {
      // 2026-05-19 bleed: operator opened BTC and ETH SHORTs at 22×.
      // Trend is the right lane for the conviction signal carried by
      // the chosen leverage; the orphans would have been adopted into
      // trend if this code had been live at the time.
      expect(inferLaneFromLeverage(22)).toBe('trend');
    });

    it('lev=75 → trend (Poloniex futures max)', () => {
      expect(inferLaneFromLeverage(75)).toBe('trend');
    });
  });

  describe('env overrides', () => {
    it('honours MONKEY_ADOPT_SWING_LEV_MIN', () => {
      process.env.MONKEY_ADOPT_SWING_LEV_MIN = '2';
      expect(inferLaneFromLeverage(1)).toBe('scalp');
      expect(inferLaneFromLeverage(2)).toBe('swing');
      expect(inferLaneFromLeverage(10)).toBe('swing');
    });

    it('honours MONKEY_ADOPT_TREND_LEV_MIN', () => {
      process.env.MONKEY_ADOPT_TREND_LEV_MIN = '20';
      expect(inferLaneFromLeverage(11)).toBe('swing');
      expect(inferLaneFromLeverage(19)).toBe('swing');
      expect(inferLaneFromLeverage(20)).toBe('trend');
    });

    it('non-numeric env value falls back to default (parses to NaN → || default)', () => {
      process.env.MONKEY_ADOPT_TREND_LEV_MIN = 'banana';
      expect(inferLaneFromLeverage(11)).toBe('trend');
    });
  });

  describe('edge cases', () => {
    it('lev=0 (defensive) → scalp', () => {
      expect(inferLaneFromLeverage(0)).toBe('scalp');
    });

    it('negative lev (defensive) → scalp', () => {
      expect(inferLaneFromLeverage(-5)).toBe('scalp');
    });
  });
});
