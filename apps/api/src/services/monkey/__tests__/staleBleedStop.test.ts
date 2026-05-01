/**
 * staleBleedStop.test.ts — verifies the time-based stale-position stop
 * that compensates for the dormant TS conviction gate.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldStaleBleedExit,
  STALE_BLEED_HOLD_MS_BY_LANE,
  STALE_BLEED_HOLD_MS_FALLBACK,
  STALE_BLEED_PRICE_BAND_DEFAULT,
} from '../staleBleedStop.js';

describe('shouldStaleBleedExit defaults', () => {
  it('scalp lane threshold is 10 minutes', () => {
    expect(STALE_BLEED_HOLD_MS_BY_LANE.scalp).toBe(10 * 60_000);
  });
  it('swing lane threshold is 75 minutes (1.5x trailing_harvest avg)', () => {
    expect(STALE_BLEED_HOLD_MS_BY_LANE.swing).toBe(75 * 60_000);
  });
  it('trend lane threshold is 180 minutes', () => {
    expect(STALE_BLEED_HOLD_MS_BY_LANE.trend).toBe(180 * 60_000);
  });
  it('unknown-lane fallback is 60 minutes', () => {
    expect(STALE_BLEED_HOLD_MS_FALLBACK).toBe(60 * 60_000);
  });
  it('price band is 0.3%', () => {
    expect(STALE_BLEED_PRICE_BAND_DEFAULT).toBeCloseTo(0.003);
  });
});

describe('shouldStaleBleedExit — fire conditions per lane', () => {
  it('scalp: fires when held > 10m and price move within ±0.3%', () => {
    const out = shouldStaleBleedExit({
      lastEntryAtMs: 0,
      positionNotional: 100,
      unrealizedPnl: 0.10,            // +0.10% on notional
      nowMs: 11 * 60_000,             // held 11 minutes
      lane: 'scalp',
    });
    expect(out.fire).toBe(true);
    expect(out.reason).toContain('stale_bleed_stop');
    expect(out.reason).toContain('lane=scalp');
    expect(out.derivation.holdMinutes).toBeCloseTo(11, 0);
    expect(out.derivation.armed).toBe(true);
  });

  it('swing: does NOT fire at 30m even with flat price (75m threshold)', () => {
    const out = shouldStaleBleedExit({
      lastEntryAtMs: 0,
      positionNotional: 100,
      unrealizedPnl: 0,
      nowMs: 30 * 60_000,
      lane: 'swing',
    });
    expect(out.fire).toBe(false);
    expect(out.derivation.holdMsThreshold).toBe(75 * 60_000);
  });

  it('swing: fires at 80m with flat price', () => {
    const out = shouldStaleBleedExit({
      lastEntryAtMs: 0,
      positionNotional: 100,
      unrealizedPnl: 0.10,
      nowMs: 80 * 60_000,
      lane: 'swing',
    });
    expect(out.fire).toBe(true);
    expect(out.reason).toContain('lane=swing');
  });

  it('trend: does NOT fire at 60m (180m threshold)', () => {
    const out = shouldStaleBleedExit({
      lastEntryAtMs: 0,
      positionNotional: 100,
      unrealizedPnl: 0,
      nowMs: 60 * 60_000,
      lane: 'trend',
    });
    expect(out.fire).toBe(false);
    expect(out.derivation.holdMsThreshold).toBe(180 * 60_000);
  });

  it('unknown lane: uses 60m fallback', () => {
    const out = shouldStaleBleedExit({
      lastEntryAtMs: 0,
      positionNotional: 100,
      unrealizedPnl: 0,
      nowMs: 65 * 60_000,
      lane: 'wat',
    });
    expect(out.fire).toBe(true);
    expect(out.derivation.holdMsThreshold).toBe(60 * 60_000);
  });

  it('fires symmetrically on negative side (swing)', () => {
    const out = shouldStaleBleedExit({
      lastEntryAtMs: 0,
      positionNotional: 100,
      unrealizedPnl: -0.20,           // -0.20% on notional
      nowMs: 80 * 60_000,
      lane: 'swing',
    });
    expect(out.fire).toBe(true);
    expect(out.derivation.priceMoveFrac).toBeCloseTo(-0.002);
  });
});

describe('shouldStaleBleedExit — non-fire conditions', () => {
  it('scalp: does not fire when held < 10m even with flat price', () => {
    const out = shouldStaleBleedExit({
      lastEntryAtMs: 0,
      positionNotional: 100,
      unrealizedPnl: 0,
      nowMs: 5 * 60_000,
      lane: 'scalp',
    });
    expect(out.fire).toBe(false);
  });

  it('swing winner at 80m: does not fire when price moved meaningfully', () => {
    // Live tape 2026-05-01 21:18 — BTC swing held 47m at +0.50% would have been killed
    // by the original 10m / ±0.3% cut. With per-lane threshold (75m for swing) AND
    // price band exclusion, this winner is correctly preserved.
    const out = shouldStaleBleedExit({
      lastEntryAtMs: 0,
      positionNotional: 100,
      unrealizedPnl: 0.50,            // +0.50% > 0.3% band
      nowMs: 80 * 60_000,
      lane: 'swing',
    });
    expect(out.fire).toBe(false);
    expect(out.derivation.priceMoveFrac).toBeCloseTo(0.005);
  });

  it('does not fire when price has moved meaningfully (loser)', () => {
    const out = shouldStaleBleedExit({
      lastEntryAtMs: 0,
      positionNotional: 100,
      unrealizedPnl: -0.40,           // -0.40% > 0.3% band
      nowMs: 200 * 60_000,
      lane: 'trend',
    });
    expect(out.fire).toBe(false);
  });

  it('does not arm when lastEntryAtMs is null (flat)', () => {
    const out = shouldStaleBleedExit({
      lastEntryAtMs: null,
      positionNotional: 100,
      unrealizedPnl: 0,
      nowMs: 200 * 60_000,
      lane: 'scalp',
    });
    expect(out.fire).toBe(false);
    expect(out.derivation.armed).toBe(false);
  });

  it('does not arm when notional is zero', () => {
    const out = shouldStaleBleedExit({
      lastEntryAtMs: 0,
      positionNotional: 0,
      unrealizedPnl: 0,
      nowMs: 200 * 60_000,
      lane: 'scalp',
    });
    expect(out.fire).toBe(false);
    expect(out.derivation.armed).toBe(false);
  });
});

describe('shouldStaleBleedExit — option overrides', () => {
  it('respects custom holdMs', () => {
    const out = shouldStaleBleedExit(
      {
        lastEntryAtMs: 0,
        positionNotional: 100,
        unrealizedPnl: 0,
        nowMs: 4 * 60_000,
        lane: 'scalp',
      },
      { holdMs: 3 * 60_000 },          // 3 min hold threshold
    );
    expect(out.fire).toBe(true);
  });

  it('respects custom priceBand', () => {
    const out = shouldStaleBleedExit(
      {
        lastEntryAtMs: 0,
        positionNotional: 100,
        unrealizedPnl: 0.40,             // +0.40%
        nowMs: 30 * 60_000,
        lane: 'scalp',
      },
      { priceBand: 0.005 },              // ±0.5% band — now within
    );
    expect(out.fire).toBe(true);
  });
});
