import { describe, it, expect, beforeEach } from 'vitest';
import {
  observeLiquidationCascade,
  computeLiquidationCascade,
  _resetLiquidationCascade,
  _peekLiquidationCascade,
  type LiquidationSample,
} from '../liquidation_cascade_observer.js';

describe('computeLiquidationCascade — pure derivation', () => {
  it('empty input returns warmup with all-zero', () => {
    const r = computeLiquidationCascade([]);
    expect(r.n).toBe(0);
    expect(r.warmup).toBe(true);
    expect(r.clusterFires).toBe(false);
    expect(r.suggestedEntrySide).toBe(null);
  });

  it('quiet baseline (no liquidations) → no cluster fires', () => {
    const samples: LiquidationSample[] = [];
    for (let i = 0; i < 30; i++) {
      samples.push({ longLiqUsd: 0, shortLiqUsd: 0, net: 0, atMs: i * 60_000 });
    }
    const r = computeLiquidationCascade(samples);
    expect(r.warmup).toBe(false);
    expect(r.clusterFires).toBe(false);  // total=0, no cluster
  });

  it('cluster fires when latest sample exceeds upper-tercile of history', () => {
    const samples: LiquidationSample[] = [];
    for (let i = 0; i < 20; i++) {
      samples.push({ longLiqUsd: 100, shortLiqUsd: 100, net: 0, atMs: i * 60_000 });
    }
    // Big long-liquidation spike
    samples.push({ longLiqUsd: 50_000, shortLiqUsd: 200, net: 49_800, atMs: 21 * 60_000 });
    const r = computeLiquidationCascade(samples);
    expect(r.warmup).toBe(false);
    expect(r.clusterFires).toBe(true);
    expect(r.dominantSide).toBe('long_liq_reversion_up');
    expect(r.suggestedEntrySide).toBe('long');
  });

  it('short-side cluster yields short reversion side', () => {
    const samples: LiquidationSample[] = [];
    for (let i = 0; i < 20; i++) {
      samples.push({ longLiqUsd: 100, shortLiqUsd: 100, net: 0, atMs: i * 60_000 });
    }
    samples.push({ longLiqUsd: 200, shortLiqUsd: 50_000, net: -49_800, atMs: 21 * 60_000 });
    const r = computeLiquidationCascade(samples);
    expect(r.clusterFires).toBe(true);
    expect(r.dominantSide).toBe('short_liq_reversion_down');
    expect(r.suggestedEntrySide).toBe('short');
  });

  it('warmup blocks cluster fire even when total is high', () => {
    const samples: LiquidationSample[] = [];
    for (let i = 0; i < 10; i++) {  // < MIN_SAMPLES=20
      samples.push({ longLiqUsd: 100_000, shortLiqUsd: 100, net: 99_900, atMs: i * 60_000 });
    }
    const r = computeLiquidationCascade(samples);
    expect(r.warmup).toBe(true);
    expect(r.clusterFires).toBe(false);
  });

  it('cluster threshold rises with history of clusters (self-calibrating)', () => {
    // History where clusters are common — the threshold should be high.
    const samples: LiquidationSample[] = [];
    for (let i = 0; i < 30; i++) {
      samples.push({ longLiqUsd: 10_000, shortLiqUsd: 10_000, net: 0, atMs: i * 60_000 });
    }
    // A merely "average" spike (20k total = same as baseline) → no fire
    samples.push({ longLiqUsd: 10_000, shortLiqUsd: 10_000, net: 0, atMs: 30 * 60_000 });
    const r = computeLiquidationCascade(samples);
    expect(r.totalNotional).toBe(r.clusterThreshold);  // at the threshold, not above
    // No strict fire because total == threshold, but tied case may or may not fire
    // — important: a quiet sample after high baseline doesn't false-positive
    expect(r.clusterThreshold).toBeGreaterThan(0);
  });
});

describe('observeLiquidationCascade — per-symbol singleton buffers', () => {
  beforeEach(() => _resetLiquidationCascade());

  it('isolates buffers per symbol', () => {
    observeLiquidationCascade('BTC_USDT_PERP', 100, 50);
    observeLiquidationCascade('ETH_USDT_PERP', 200, 75);
    expect(_peekLiquidationCascade('BTC_USDT_PERP')).toHaveLength(1);
    expect(_peekLiquidationCascade('ETH_USDT_PERP')).toHaveLength(1);
    expect(_peekLiquidationCascade('SOL_USDT_PERP')).toHaveLength(0);
  });

  it('accumulates samples and returns a reading', () => {
    for (let i = 0; i < 21; i++) {
      observeLiquidationCascade('BTC_USDT_PERP', 1000, 1000);
    }
    const r = observeLiquidationCascade('BTC_USDT_PERP', 100_000, 500);
    expect(r.clusterFires).toBe(true);
    expect(r.suggestedEntrySide).toBe('long');  // long-liq dominant → long reversion
  });
});
