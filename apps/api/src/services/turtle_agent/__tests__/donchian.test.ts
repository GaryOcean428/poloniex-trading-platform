import { describe, it, expect } from 'vitest';

import {
  donchianHigh,
  donchianLow,
  latestDonchianHigh,
  latestDonchianLow,
} from '../donchian.js';
import type { TurtleOHLCV } from '../state.js';

/** Build a synthetic ascending series: each bar's high = i + 10,
 *  low = i + 9, close = i + 9.5. Indices are explicit so we can
 *  pin expected channel values. */
function makeRising(n: number): TurtleOHLCV[] {
  const out: TurtleOHLCV[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      timestamp: i * 60_000,
      open: i + 9.5,
      high: i + 10,
      low: i + 9,
      close: i + 9.5,
      volume: 100,
    });
  }
  return out;
}

describe('donchianHigh', () => {
  it('returns NaN for indices < period', () => {
    const c = makeRising(5);
    const series = donchianHigh(c, 3);
    expect(Number.isNaN(series[0])).toBe(true);
    expect(Number.isNaN(series[2])).toBe(true);
    expect(Number.isFinite(series[3])).toBe(true);
  });

  it('uses prior bars only — index i is max of bars [i-period, i-1]', () => {
    const c = makeRising(10);
    const series = donchianHigh(c, 3);
    // At i=5: max of high[2..4] = max(12, 13, 14) = 14.
    expect(series[5]).toBeCloseTo(14, 6);
  });

  it('throws on non-positive period', () => {
    expect(() => donchianHigh([], 0)).toThrow();
    expect(() => donchianHigh([], -1)).toThrow();
  });
});

describe('donchianLow', () => {
  it('uses prior bars — symmetric to high', () => {
    const c = makeRising(10);
    const series = donchianLow(c, 3);
    // At i=5: min of low[2..4] = min(11, 12, 13) = 11.
    expect(series[5]).toBeCloseTo(11, 6);
  });
});

describe('latestDonchianHigh / latestDonchianLow', () => {
  it('breakout detection: a 20-bar high → close above prior 20-bar high', () => {
    // 20 bars at price ~10, then a single breakout bar at 15.
    const candles: TurtleOHLCV[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push({
        timestamp: i * 60_000,
        open: 10,
        high: 10.1,
        low: 9.9,
        close: 10,
        volume: 100,
      });
    }
    candles.push({
      timestamp: 20 * 60_000,
      open: 14,
      high: 15.5,
      low: 14,
      close: 15,
      volume: 100,
    });
    const dHigh = latestDonchianHigh(candles, 20);
    expect(dHigh).toBeCloseTo(10.1, 6);
    const lastClose = candles[candles.length - 1]!.close;
    expect(lastClose).toBeGreaterThan(dHigh);
  });

  it('returns NaN when fewer than `period` bars', () => {
    const c = makeRising(5);
    expect(Number.isNaN(latestDonchianHigh(c, 20))).toBe(true);
    expect(Number.isNaN(latestDonchianLow(c, 20))).toBe(true);
  });

  it('latest low excludes current bar', () => {
    // 20 priors with low=10, current bar has low=5. The channel
    // looks at priors only, so latestLow = 10, not 5.
    const candles: TurtleOHLCV[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push({
        timestamp: i * 60_000,
        open: 10, high: 10.5, low: 10, close: 10.2, volume: 100,
      });
    }
    candles.push({
      timestamp: 20 * 60_000,
      open: 8, high: 8.5, low: 5, close: 6, volume: 100,
    });
    const dLow = latestDonchianLow(candles, 20);
    expect(dLow).toBeCloseTo(10, 6);
  });
});
