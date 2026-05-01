import { describe, it, expect } from 'vitest';

import {
  TURTLE_DEFAULT_LEVERAGE,
  TURTLE_MAX_UNITS,
  TURTLE_PYRAMID_STEP_ATR_MULT,
  appendUnit,
  turtleAgentDecide,
} from '../decide.js';
import { newTurtleState, type TurtleOHLCV, type TurtleState } from '../state.js';

function bar(close: number, high?: number, low?: number, t = 0): TurtleOHLCV {
  const h = high ?? close + 0.5;
  const l = low ?? close - 0.5;
  return { timestamp: t, open: close, high: h, low: l, close, volume: 100 };
}

/** Same fixture as decide.test.ts: 25 flat bars at price 10, then
 *  an upward breakout at 12. */
function risingBreakoutSeries(): TurtleOHLCV[] {
  const candles: TurtleOHLCV[] = [];
  for (let i = 0; i < 25; i++) candles.push(bar(10, 10.5, 9.5, i * 60_000));
  candles.push(bar(12, 12.5, 11.8, 25 * 60_000));
  return candles;
}

describe('turtleAgentDecide — pyramiding (test 5, 6)', () => {
  it('adds a unit on 0.5 × ATR favorable past last unit entry (long)', () => {
    const ohlcv = risingBreakoutSeries();
    // Held long unit at entry 12, atrAtEntry = 1.0 → pyramid threshold
    // = 12 + 0.5 × 1.0 = 12.5.
    let state: TurtleState = appendUnit(newTurtleState(), {
      side: 'long',
      entryPrice: 12,
      atrAtEntry: 1.0,
      stopPrice: 10,
      marginUsdt: 5,
      leverage: TURTLE_DEFAULT_LEVERAGE,
      openedAtMs: Date.now(),
    });
    expect(state.units.length).toBe(1);
    // New bar with close above the threshold.
    const advanceBar = bar(12.6, 12.7, 12.4, 26 * 60_000);
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv: [...ohlcv, advanceBar],
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state,
    });
    expect(r.action).toBe('pyramid_long');
    expect(r.sizeUsdt).toBeGreaterThan(0);
    expect(r.derivation.pyramidThresholdPrice).toBeCloseTo(12.5, 6);
  });

  it('does NOT pyramid before reaching the 0.5 × ATR threshold', () => {
    const ohlcv = risingBreakoutSeries();
    const state: TurtleState = appendUnit(newTurtleState(), {
      side: 'long',
      entryPrice: 12,
      atrAtEntry: 1.0,
      stopPrice: 10,
      marginUsdt: 5,
      leverage: TURTLE_DEFAULT_LEVERAGE,
      openedAtMs: Date.now(),
    });
    // Close at 12.3 — below the 12.5 threshold.
    const stillLowBar = bar(12.3, 12.4, 12.2, 26 * 60_000);
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv: [...ohlcv, stillLowBar],
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state,
    });
    expect(r.action).not.toBe('pyramid_long');
  });

  it('caps pyramid at TURTLE_MAX_UNITS (4)', () => {
    const ohlcv = risingBreakoutSeries();
    let state: TurtleState = newTurtleState();
    // Stack TURTLE_MAX_UNITS units. Each entry is 0.5 ATR above
    // the previous; ATR = 1, so units at 12, 12.5, 13.0, 13.5.
    for (let i = 0; i < TURTLE_MAX_UNITS; i++) {
      state = appendUnit(state, {
        side: 'long',
        entryPrice: 12 + i * 0.5,
        atrAtEntry: 1.0,
        stopPrice: 10 + i * 0.5,
        marginUsdt: 5,
        leverage: TURTLE_DEFAULT_LEVERAGE,
        openedAtMs: Date.now(),
      });
    }
    expect(state.units.length).toBe(TURTLE_MAX_UNITS);
    // Move past the would-be 5th-unit threshold (14.0). Since
    // TURTLE_MAX_UNITS is reached, decide() must not pyramid.
    const advanceBar = bar(14.5, 14.7, 14.3, 30 * 60_000);
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv: [...ohlcv, advanceBar],
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state,
    });
    expect(r.action).not.toBe('pyramid_long');
  });

  it('pyramid step magnitude is exactly 0.5 × ATR per Turtle classic', () => {
    expect(TURTLE_PYRAMID_STEP_ATR_MULT).toBe(0.5);
  });
});
