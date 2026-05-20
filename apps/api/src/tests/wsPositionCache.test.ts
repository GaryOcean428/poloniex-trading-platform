/**
 * Tests for wsPositionCache — the Phase D event-driven position cache.
 * Fed by the Poloniex v3 private `position` WebSocket channel; holds the
 * latest exchange-pushed snapshot per (symbol, side).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { wsPositionCache } from '../services/monkey/ws_position_cache.js';

describe('wsPositionCache', () => {
  beforeEach(() => {
    wsPositionCache.resetForTests();
  });

  describe('empty cache', () => {
    it('getPosition returns null before any event', () => {
      expect(wsPositionCache.getPosition('BTC_USDT_PERP', 'long')).toBeNull();
      expect(wsPositionCache.getAgeMs('BTC_USDT_PERP', 'long')).toBeNull();
    });

    it('isLive is false until startFeed', () => {
      expect(wsPositionCache.isLive()).toBe(false);
    });

    it('snapshot is empty', () => {
      const s = wsPositionCache.snapshot();
      expect(s.positions).toEqual([]);
      expect(s.updateCount).toBe(0);
    });
  });

  describe('ingest', () => {
    it('stores a position snapshot keyed by (symbol, side)', () => {
      wsPositionCache.ingestForTests({
        symbol: 'BTC_USDT_PERP', posSide: 'LONG',
        currentQty: 5, markPrice: 76500, unrealisedPnl: 2.5,
        liquidationPrice: 70000,
      });
      const p = wsPositionCache.getPosition('BTC_USDT_PERP', 'long');
      expect(p).not.toBeNull();
      expect(p!.qty).toBe(5);
      expect(p!.markPrice).toBe(76500);
      expect(p!.unrealizedPnlUsdt).toBe(2.5);
      expect(p!.side).toBe('long');
    });

    it('resolves side from posSide first (HEDGE)', () => {
      wsPositionCache.ingestForTests({
        symbol: 'ETH_USDT_PERP', posSide: 'SHORT', currentQty: 10,
      });
      expect(wsPositionCache.getPosition('ETH_USDT_PERP', 'short')).not.toBeNull();
      expect(wsPositionCache.getPosition('ETH_USDT_PERP', 'long')).toBeNull();
    });

    it('falls back to qty sign when posSide absent (ONE_WAY)', () => {
      wsPositionCache.ingestForTests({
        symbol: 'BTC_USDT_PERP', currentQty: -3, // negative → short
      });
      expect(wsPositionCache.getPosition('BTC_USDT_PERP', 'short')).not.toBeNull();
    });

    it('stores qty as magnitude (side carries direction)', () => {
      wsPositionCache.ingestForTests({
        symbol: 'BTC_USDT_PERP', posSide: 'SHORT', currentQty: -8,
      });
      expect(wsPositionCache.getPosition('BTC_USDT_PERP', 'short')!.qty).toBe(8);
    });

    it('accepts the unrealizedPnl field alias', () => {
      wsPositionCache.ingestForTests({
        symbol: 'BTC_USDT_PERP', posSide: 'LONG',
        currentQty: 1, unrealizedPnl: 9.9,
      });
      expect(
        wsPositionCache.getPosition('BTC_USDT_PERP', 'long')!.unrealizedPnlUsdt,
      ).toBe(9.9);
    });

    it('a later event overwrites the prior snapshot for that key', () => {
      wsPositionCache.ingestForTests({
        symbol: 'BTC_USDT_PERP', posSide: 'LONG', currentQty: 5, markPrice: 100,
      });
      wsPositionCache.ingestForTests({
        symbol: 'BTC_USDT_PERP', posSide: 'LONG', currentQty: 7, markPrice: 110,
      });
      const p = wsPositionCache.getPosition('BTC_USDT_PERP', 'long');
      expect(p!.qty).toBe(7);
      expect(p!.markPrice).toBe(110);
    });

    it('qty 0 is a valid snapshot (flat) — distinct from null', () => {
      wsPositionCache.ingestForTests({
        symbol: 'BTC_USDT_PERP', posSide: 'LONG', currentQty: 0,
      });
      const p = wsPositionCache.getPosition('BTC_USDT_PERP', 'long');
      expect(p).not.toBeNull();
      expect(p!.qty).toBe(0);
    });

    it('ignores events with no symbol', () => {
      wsPositionCache.ingestForTests({ posSide: 'LONG', currentQty: 5 });
      expect(wsPositionCache.snapshot().positions).toEqual([]);
    });
  });

  describe('isolation + telemetry', () => {
    it('BTC long / BTC short / ETH long tracked independently', () => {
      wsPositionCache.ingestForTests({ symbol: 'BTC_USDT_PERP', posSide: 'LONG', currentQty: 1 });
      wsPositionCache.ingestForTests({ symbol: 'BTC_USDT_PERP', posSide: 'SHORT', currentQty: 2 });
      wsPositionCache.ingestForTests({ symbol: 'ETH_USDT_PERP', posSide: 'LONG', currentQty: 3 });
      const s = wsPositionCache.snapshot();
      expect(s.positions).toHaveLength(3);
      expect(s.updateCount).toBe(3);
    });

    it('getAgeMs returns a non-negative number after ingest', () => {
      wsPositionCache.ingestForTests({ symbol: 'BTC_USDT_PERP', posSide: 'LONG', currentQty: 1 });
      const age = wsPositionCache.getAgeMs('BTC_USDT_PERP', 'long');
      expect(age).not.toBeNull();
      expect(age!).toBeGreaterThanOrEqual(0);
    });
  });
});
