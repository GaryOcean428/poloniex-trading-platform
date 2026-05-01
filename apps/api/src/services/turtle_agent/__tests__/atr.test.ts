import { describe, it, expect } from 'vitest';

import { atrSeries, latestAtr, trueRange } from '../atr.js';
import type { TurtleOHLCV } from '../state.js';

function bar(o: number, h: number, l: number, c: number, t = 0): TurtleOHLCV {
  return { timestamp: t, open: o, high: h, low: l, close: c, volume: 100 };
}

describe('trueRange', () => {
  it('first bar is high - low (no prior close)', () => {
    const tr = trueRange([bar(10, 12, 9, 11)]);
    expect(tr[0]).toBeCloseTo(3, 6);
  });

  it('subsequent bars include gap term against prior close', () => {
    // bar 0: H=12, L=9, C=11
    // bar 1: H=13, L=11.5, prior_close=11
    //   range = 1.5, |H-pc|=2, |L-pc|=0.5, max=2.
    const tr = trueRange([bar(10, 12, 9, 11), bar(11.6, 13, 11.5, 12.5)]);
    expect(tr[0]).toBeCloseTo(3, 6);
    expect(tr[1]).toBeCloseTo(2, 6);
  });
});

describe('atrSeries (Wilder)', () => {
  it('returns all NaN when fewer bars than period', () => {
    const series = atrSeries([bar(10, 11, 9, 10)], 3);
    expect(Number.isNaN(series[0])).toBe(true);
  });

  it('seed at period-1 is the simple-mean of the first `period` TRs', () => {
    // Constant range bars: H-L = 2 each, no gaps.
    const candles: TurtleOHLCV[] = [];
    for (let i = 0; i < 20; i++) candles.push(bar(10, 11, 9, 10));
    const series = atrSeries(candles, 5);
    // tr[0..4] all = 2 (first bar) or 1 (subsequent: H-L=2, but
    // |H - pc=10| = 1, |L - pc=10| = 1; max = 2 since H-L=2 still
    // dominates). Simple mean = 2.
    expect(series[4]).toBeCloseTo(2, 6);
  });

  it('Wilder smoothing matches the known recurrence', () => {
    const candles: TurtleOHLCV[] = [];
    for (let i = 0; i < 25; i++) candles.push(bar(10, 11, 9, 10));
    const series = atrSeries(candles, 20);
    // All TRs are 2 → ATR converges and stays at 2.
    expect(series[19]).toBeCloseTo(2, 6);
    expect(series[24]).toBeCloseTo(2, 6);
  });

  it('atr increases on a true expansion bar', () => {
    const candles: TurtleOHLCV[] = [];
    for (let i = 0; i < 20; i++) candles.push(bar(10, 11, 9, 10));
    candles.push(bar(10, 20, 5, 18)); // big-range bar, TR = 15
    const series = atrSeries(candles, 20);
    const before = series[19]!;
    const after = series[20]!;
    expect(after).toBeGreaterThan(before);
    // Wilder: atr_n = ((19) * 2 + 15) / 20 = (38 + 15) / 20 = 2.65
    expect(after).toBeCloseTo(2.65, 4);
  });
});

describe('latestAtr', () => {
  it('returns NaN when insufficient data', () => {
    expect(Number.isNaN(latestAtr([], 20))).toBe(true);
  });

  it('returns the last finite value of atrSeries', () => {
    const candles: TurtleOHLCV[] = [];
    for (let i = 0; i < 25; i++) candles.push(bar(10, 11, 9, 10));
    expect(latestAtr(candles, 20)).toBeCloseTo(2, 6);
  });
});
