/**
 * Tests for aggregatePeakTracker — cross-kernel aggregate-PnL peak
 * tracker introduced to fix the multi-kernel fragmentation that lets
 * $3+ aggregate wins evaporate when per-subset peaks each sit at $1-2.
 *
 * Operator directive 2026-05-19: "kernels should have bus and basin
 * sync and talk and decide together anyway." This module is the
 * in-process shared-state channel for harvest decisions; FAT writes
 * each cycle from its aggregate-position view, monkey loop.ts reads
 * during the harvest decision.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { aggregatePeakTracker } from '../services/monkey/aggregate_peak.js';

describe('aggregatePeakTracker', () => {
  beforeEach(() => {
    aggregatePeakTracker.resetForTests();
  });

  describe('first observation', () => {
    it('returns null peak before any recordTick', () => {
      expect(aggregatePeakTracker.getPeak('BTC_USDT_PERP', 'short')).toBeNull();
      expect(aggregatePeakTracker.getLastPnl('BTC_USDT_PERP', 'short')).toBeNull();
    });

    it('first recordTick sets both peak and last to that value', () => {
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', 2.5);
      expect(aggregatePeakTracker.getPeak('BTC_USDT_PERP', 'short')).toBe(2.5);
      expect(aggregatePeakTracker.getLastPnl('BTC_USDT_PERP', 'short')).toBe(2.5);
    });
  });

  describe('peak tracking', () => {
    it('peak increases when current rises', () => {
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', 2.0);
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', 5.0);
      expect(aggregatePeakTracker.getPeak('BTC_USDT_PERP', 'short')).toBe(5.0);
    });

    it('peak holds when current drops', () => {
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', 5.0);
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', 1.5);
      expect(aggregatePeakTracker.getPeak('BTC_USDT_PERP', 'short')).toBe(5.0);
      expect(aggregatePeakTracker.getLastPnl('BTC_USDT_PERP', 'short')).toBe(1.5);
    });

    it('peak holds when current goes negative (still in profit historically)', () => {
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', 3.0);
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', -0.5);
      expect(aggregatePeakTracker.getPeak('BTC_USDT_PERP', 'short')).toBe(3.0);
      expect(aggregatePeakTracker.getLastPnl('BTC_USDT_PERP', 'short')).toBe(-0.5);
    });
  });

  describe('per-(symbol, side) isolation', () => {
    it('BTC short and ETH short are tracked independently', () => {
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', 5.0);
      aggregatePeakTracker.recordTick('ETH_USDT_PERP', 'short', 2.0);
      expect(aggregatePeakTracker.getPeak('BTC_USDT_PERP', 'short')).toBe(5.0);
      expect(aggregatePeakTracker.getPeak('ETH_USDT_PERP', 'short')).toBe(2.0);
    });

    it('BTC long and BTC short are tracked independently', () => {
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'long', 4.0);
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', 6.0);
      expect(aggregatePeakTracker.getPeak('BTC_USDT_PERP', 'long')).toBe(4.0);
      expect(aggregatePeakTracker.getPeak('BTC_USDT_PERP', 'short')).toBe(6.0);
    });
  });

  describe('clearOnClose', () => {
    it('removes the record so re-opens start fresh', () => {
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', 5.0);
      aggregatePeakTracker.clearOnClose('BTC_USDT_PERP', 'short');
      expect(aggregatePeakTracker.getPeak('BTC_USDT_PERP', 'short')).toBeNull();
    });

    it('next recordTick after clearOnClose seeds fresh peak', () => {
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', 5.0);
      aggregatePeakTracker.clearOnClose('BTC_USDT_PERP', 'short');
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', 0.5);
      // Without clearOnClose, the next tick would inherit peak=5 from
      // the stale record and immediately fire harvest on a brand-new
      // position. With clearOnClose, the new position starts at $0.5
      // peak — correct.
      expect(aggregatePeakTracker.getPeak('BTC_USDT_PERP', 'short')).toBe(0.5);
    });

    it('clearOnClose on missing record is a no-op', () => {
      // Doesn't throw.
      aggregatePeakTracker.clearOnClose('FOO_USDT_PERP', 'long');
      expect(aggregatePeakTracker.getPeak('FOO_USDT_PERP', 'long')).toBeNull();
    });
  });

  describe('snapshot()', () => {
    it('returns empty array when no records', () => {
      expect(aggregatePeakTracker.snapshot()).toEqual([]);
    });

    it('returns one entry per tracked (symbol, side)', () => {
      aggregatePeakTracker.recordTick('BTC_USDT_PERP', 'short', 5.0);
      aggregatePeakTracker.recordTick('ETH_USDT_PERP', 'long', 2.0);
      const snap = aggregatePeakTracker.snapshot();
      expect(snap).toHaveLength(2);
      const btc = snap.find(s => s.symbol === 'BTC_USDT_PERP');
      const eth = snap.find(s => s.symbol === 'ETH_USDT_PERP');
      expect(btc?.peakPnlUsdt).toBe(5.0);
      expect(eth?.peakPnlUsdt).toBe(2.0);
      expect(btc?.ageMs).toBeGreaterThanOrEqual(0);
    });
  });
});
