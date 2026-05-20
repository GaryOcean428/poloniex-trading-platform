/**
 * Tests for atr14 — the true-range ATR added to perception.ts for the
 * Phase B synthetic TP/SL bracket. Mirrors the Pine `ta.atr(14)` the
 * canonical QIG indicator uses.
 */

import { describe, it, expect } from 'vitest';
import { atr14 } from '../services/monkey/perception.js';
import type { OHLCVCandle } from '../services/monkey/perception.js';

function candle(
  high: number, low: number, close: number,
): OHLCVCandle {
  return { timestamp: 0, open: close, high, low, close, volume: 1 };
}

describe('atr14', () => {
  it('returns 0 with insufficient history (< period+1 candles)', () => {
    const few = Array.from({ length: 10 }, () => candle(11, 9, 10));
    expect(atr14(few, 14)).toBe(0);
  });

  it('constant-range candles → ATR equals that range', () => {
    // 20 candles, each high-low = 2, close flat at 10 → every TR = 2.
    const flat = Array.from({ length: 20 }, () => candle(11, 9, 10));
    expect(atr14(flat, 14)).toBeCloseTo(2, 6);
  });

  it('true range includes the gap vs previous close', () => {
    // Candle 1: close 100. Candle 2: high 110, low 108, close 109.
    //   TR = max(110-108, |110-100|, |108-100|) = max(2, 10, 8) = 10
    // Use period 1 so ATR = that single TR.
    const gap = [candle(100, 100, 100), candle(110, 108, 109)];
    expect(atr14(gap, 1)).toBeCloseTo(10, 6);
  });

  it('mean of true ranges over the period window', () => {
    // prevClose=10 for all. Candle ranges: TR alternates 2 and 4.
    // 8 candles after the seed, period 8 → mean(2,4,2,4,2,4,2,4) = 3.
    const seed = candle(10, 10, 10);
    const seq: OHLCVCandle[] = [seed];
    for (let i = 0; i < 8; i++) {
      seq.push(i % 2 === 0 ? candle(11, 9, 10) : candle(12, 8, 10));
    }
    expect(atr14(seq, 8)).toBeCloseTo(3, 6);
  });

  it('default period is 14', () => {
    const flat = Array.from({ length: 30 }, () => candle(13, 7, 10));
    // range 6 everywhere → ATR 6 regardless of period
    expect(atr14(flat)).toBeCloseTo(6, 6);
  });

  it('exactly period+1 candles is the minimum that yields a value', () => {
    const exact = Array.from({ length: 15 }, () => candle(11, 9, 10));
    expect(atr14(exact, 14)).toBeGreaterThan(0);
    const oneShort = exact.slice(0, 14);
    expect(atr14(oneShort, 14)).toBe(0);
  });
});
