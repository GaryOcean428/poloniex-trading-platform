import { describe, it, expect, beforeEach } from 'vitest';
import {
  observeFundingArb,
  computeFundingArb,
  _resetFundingArb,
  _peekFundingArb,
  type FundingSample,
} from '../funding_arb_observer.js';

describe('computeFundingArb — pure derivation', () => {
  it('returns warmup with all-zero on empty input', () => {
    const r = computeFundingArb([]);
    expect(r.n).toBe(0);
    expect(r.warmup).toBe(true);
    expect(r.signalFires).toBe(false);
    expect(r.suggestedDirection).toBe(null);
  });

  it('computes mean / std / z correctly on synthetic data', () => {
    const samples: FundingSample[] = [];
    for (let i = 0; i < 50; i++) {
      const btc = 0.0001;
      const eth = 0.0001 + (i % 2 === 0 ? 0.00005 : -0.00005);  // gap oscillates
      samples.push({ btcFunding: btc, ethFunding: eth, gap: eth - btc, atMs: i * 1000 });
    }
    const r = computeFundingArb(samples);
    expect(r.n).toBe(50);
    expect(r.warmup).toBe(false);
    expect(Math.abs(r.meanGap)).toBeLessThan(1e-9);  // oscillation cancels
    expect(r.stdGap).toBeGreaterThan(0);
  });

  it('signal fires when current gap is far from rolling mean', () => {
    const samples: FundingSample[] = [];
    // 30 samples of small gap, then 1 sample of LARGE gap
    for (let i = 0; i < 30; i++) {
      samples.push({ btcFunding: 0.0001, ethFunding: 0.0001 + 0.00001, gap: 0.00001, atMs: i * 1000 });
    }
    samples.push({ btcFunding: 0.0001, ethFunding: 0.0001 + 0.001, gap: 0.001, atMs: 31_000 });
    const r = computeFundingArb(samples);
    expect(r.warmup).toBe(false);
    expect(r.zScore).toBeGreaterThan(2);  // big spike
    expect(r.signalFires).toBe(true);
    expect(r.suggestedDirection).toBe('long_btc_short_eth');  // eth funding much higher → short eth
  });

  it('signal does not fire during warmup (n < MIN_SAMPLES)', () => {
    const samples: FundingSample[] = [];
    for (let i = 0; i < 20; i++) {  // < MIN_SAMPLES=30
      samples.push({ btcFunding: 0.0001, ethFunding: 0.001, gap: 0.0009, atMs: i * 1000 });
    }
    const r = computeFundingArb(samples);
    expect(r.warmup).toBe(true);
    expect(r.signalFires).toBe(false);
    expect(r.suggestedDirection).toBe(null);
  });

  it('signal direction flips correctly when btc funding is unusually high', () => {
    const samples: FundingSample[] = [];
    for (let i = 0; i < 30; i++) {
      samples.push({ btcFunding: 0.0001, ethFunding: 0.0001 + 0.00001, gap: 0.00001, atMs: i * 1000 });
    }
    // Negative gap = btc funding rich vs eth
    samples.push({ btcFunding: 0.001, ethFunding: 0.0001, gap: -0.0009, atMs: 31_000 });
    const r = computeFundingArb(samples);
    expect(r.zScore).toBeLessThan(-2);
    expect(r.signalFires).toBe(true);
    expect(r.suggestedDirection).toBe('short_btc_long_eth');  // btc funding rich → short btc, long eth
  });

  it('flat funding (no variance) → no signal even with mismatched rates', () => {
    const samples: FundingSample[] = [];
    for (let i = 0; i < 50; i++) {
      samples.push({ btcFunding: 0.0001, ethFunding: 0.0002, gap: 0.0001, atMs: i * 1000 });
    }
    const r = computeFundingArb(samples);
    expect(r.stdGap).toBe(0);  // perfectly flat
    expect(r.zScore).toBe(0);
    expect(r.signalFires).toBe(false);  // no variance → no statistical basis to fire
  });
});

describe('observeFundingArb — singleton buffer', () => {
  beforeEach(() => _resetFundingArb());

  it('accumulates samples in the buffer', () => {
    observeFundingArb(0.0001, 0.00012);
    observeFundingArb(0.0001, 0.00013);
    expect(_peekFundingArb()).toHaveLength(2);
  });

  it('returns a reading with current values', () => {
    for (let i = 0; i < 31; i++) observeFundingArb(0.0001, 0.00012 + i * 1e-7);
    const r = observeFundingArb(0.0001, 0.00012);
    expect(r.btcFunding).toBe(0.0001);
    expect(r.ethFunding).toBe(0.00012);
    expect(r.warmup).toBe(false);
  });
});
