/**
 * Tests for the absolute-USD arm on shouldSlowBleedExit and the
 * cross-kernel shouldAggregateBleedExit — the loss-side mirror of the
 * #855/#856 harvest work.
 *
 * Motivation (2026-05-20 Poloniex-export audit): the loss side bled
 * −$14.84 across BTC+ETH with avg loss 2.5-2.9× avg win. The worst
 * holds:
 *   BTC 52-cont short  17:16→19:00  1h43m  −$13.34
 *   ETH 63-cont        03:14→06:08  2h54m  −$2.59
 * The ETH −$2.59 sat at ≈−0.8% ROI the whole hold — far below the
 * 7.5%/20% half-SL percentage gate, so slow-bleed never fired. The
 * percentage gate measures % but the bleed is in $.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  shouldSlowBleedExit,
  shouldAggregateBleedExit,
} from '../services/monkey/executive.js';

describe('shouldSlowBleedExit — absolute-USD arm', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.MONKEY_SLOW_BLEED_ABS_USD;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('fires on the ETH −$2.59 / 2h54m shape the pct gate misses', () => {
    // ETH 63-cont, ≈−0.8% ROI — below the 7.5% half-SL pct gate.
    // notional ~ $1300, leverage 8x → roiFrac ≈ −0.8%/100 territory.
    // The ABS arm (|pnl| ≥ $3) trips on the −$3+ dollar loss.
    const r = shouldSlowBleedExit({
      unrealizedPnlUsdt: -3.20,
      notionalUsdt: 1300,
      leverage: 8,
      heldMs: 174 * 60_000,   // 2h54m
      tapeTrend: 0.5,          // adverse to a short (alignment = -0.5)
      heldSide: 'short',
      lane: 'trend',
    });
    expect(r.value).toBe(true);
    expect(r.reason).toContain('abs');
  });

  it('2026-05-25 strip — abs threshold removed; any negative USD + adverse tape after 60min qualifies', () => {
    // Pre-strip: $3 default kept this $1.50 loss quiet under the abs
    // gate. Post-strip: abs arm threshold is 0, so any |pnl| ≥ 0
    // qualifies — the test inverts. Chemistry decides cut-loss timing.
    const r = shouldSlowBleedExit({
      unrealizedPnlUsdt: -1.50,
      notionalUsdt: 1300,
      leverage: 8,
      heldMs: 174 * 60_000,
      tapeTrend: 0.5,
      heldSide: 'short',
      lane: 'trend',
    });
    expect(r.value).toBe(true);
    expect(String(r.reason).toLowerCase()).toContain('abs');
  });

  it('still respects the 60-min floor (no fire before 60min even at −$10)', () => {
    const r = shouldSlowBleedExit({
      unrealizedPnlUsdt: -10.0,
      notionalUsdt: 1300,
      leverage: 8,
      heldMs: 30 * 60_000,    // 30min — under floor
      tapeTrend: 0.5,
      heldSide: 'short',
      lane: 'trend',
    });
    expect(r.value).toBe(false);
    expect(r.reason).toBe('under_60min');
  });

  it('still respects tape gate (no fire when tape aligned with position)', () => {
    const r = shouldSlowBleedExit({
      unrealizedPnlUsdt: -5.0,
      notionalUsdt: 1300,
      leverage: 8,
      heldMs: 90 * 60_000,
      tapeTrend: -0.5,        // for a short, negative tape is ALIGNED
      heldSide: 'short',
      lane: 'trend',
    });
    expect(r.value).toBe(false);
    expect(r.reason).toBe('tape_neutral_or_aligned');
  });

  it('does not fire on a scalp-lane position (own fast TP/SL)', () => {
    const r = shouldSlowBleedExit({
      unrealizedPnlUsdt: -5.0,
      notionalUsdt: 1300,
      leverage: 8,
      heldMs: 90 * 60_000,
      tapeTrend: 0.5,
      heldSide: 'short',
      lane: 'scalp',
    });
    expect(r.value).toBe(false);
    expect(r.reason).toBe('scalp_lane_skip');
  });

  it('does not fire when position is green', () => {
    const r = shouldSlowBleedExit({
      unrealizedPnlUsdt: 4.0,    // in profit
      notionalUsdt: 1300,
      leverage: 8,
      heldMs: 90 * 60_000,
      tapeTrend: 0.5,
      heldSide: 'short',
      lane: 'trend',
    });
    expect(r.value).toBe(false);
    expect(r.reason).toBe('not_in_loss');
  });

  it('2026-05-25 strip — env override ignored; any negative USD after 60min with adverse tape fires', () => {
    process.env.MONKEY_SLOW_BLEED_ABS_USD = '10';
    const r = shouldSlowBleedExit({
      unrealizedPnlUsdt: -5.0,
      notionalUsdt: 1300,
      leverage: 8,
      heldMs: 90 * 60_000,
      tapeTrend: 0.5,
      heldSide: 'short',
      lane: 'trend',
    });
    // Pre-strip: $10 env override would gate $5 loss. Post-strip: env
    // read removed, abs arm threshold = 0; any negative + adverse tape
    // qualifies.
    expect(r.value).toBe(true);
    expect(String(r.reason).toLowerCase()).toContain('abs');
    delete process.env.MONKEY_SLOW_BLEED_ABS_USD;
  });
});

describe('shouldAggregateBleedExit (Phase 3 — chemistry-derived, 2026-05-26)', () => {
  // Phase 3 strip: MONKEY_SLOW_BLEED_ABS_USD + MONKEY_SLOW_BLEED_MIN_MIN
  // removed. Bleed-exit fires when in-loss + adverse-tape + gaba > serotonin
  // (kernel inhibition exceeds reassurance). Both thresholds become
  // chemistry-derived; no fixed dollars, no fixed minutes.

  function stubBasinState(gaba: number, serotonin: number): any {
    return {
      neurochemistry: {
        acetylcholine: 0.5, dopamine: 0.5, serotonin,
        norepinephrine: 0.5, gaba, endorphins: 0.0,
      },
    };
  }

  it('returns false when aggregate inputs are null (FAT not observing)', () => {
    const bs = stubBasinState(0.7, 0.3);
    expect(shouldAggregateBleedExit(null, 90 * 60_000, 0.5, 'short', bs).value)
      .toBe(false);
    expect(shouldAggregateBleedExit(-5, null, 0.5, 'short', bs).value)
      .toBe(false);
  });

  it('fires when in-loss + adverse-tape + gaba > serotonin', () => {
    const bs = stubBasinState(0.7, 0.3);  // kernel anxious
    const r = shouldAggregateBleedExit(
      -3.50, 90 * 60_000, 0.5, 'short', bs,
    );
    expect(r.value).toBe(true);
    expect(r.reason).toContain('aggregate_bleed_exit');
  });

  it('does NOT fire when kernel chemistry is unbothered (gaba <= serotonin)', () => {
    const bs = stubBasinState(0.3, 0.6);  // reassurance > inhibition
    const r = shouldAggregateBleedExit(-10.0, 90 * 60_000, 0.5, 'short', bs);
    expect(r.value).toBe(false);
    expect(r.reason).toContain('kernel_unbothered');
  });

  it('fires on small losses too — no dollar floor', () => {
    // Pre-Phase-3: $2 loss was below the $3 floor → no fire.
    // Post-Phase-3: chemistry decides; if gaba > ser, the kernel exits
    // regardless of dollar magnitude.
    const bs = stubBasinState(0.8, 0.2);
    const r = shouldAggregateBleedExit(-2.0, 90 * 60_000, 0.5, 'short', bs);
    expect(r.value).toBe(true);
  });

  it('does NOT fire when aggregate is in profit', () => {
    const bs = stubBasinState(0.7, 0.3);
    const r = shouldAggregateBleedExit(5.0, 90 * 60_000, 0.5, 'short', bs);
    expect(r.value).toBe(false);
    expect(r.reason).toContain('not_in_loss');
  });

  it('does NOT fire when tape is aligned with the held side', () => {
    const bs = stubBasinState(0.8, 0.2);
    // long held, positive tape = aligned
    const r = shouldAggregateBleedExit(-5.0, 90 * 60_000, 0.5, 'long', bs);
    expect(r.value).toBe(false);
    expect(r.reason).toBe('tape_neutral_or_aligned');
  });

  it('fires regardless of position age when chemistry signals exit', () => {
    // Pre-Phase-3: 45min was below the 60min floor → no fire.
    // Post-Phase-3: age is logged for telemetry but does not gate.
    // The kernel's chemistry decides whether time has mattered.
    const bs = stubBasinState(0.8, 0.2);
    const r = shouldAggregateBleedExit(-10.0, 45 * 60_000, 0.5, 'short', bs);
    expect(r.value).toBe(true);
  });
});
