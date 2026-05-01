import { describe, it, expect } from 'vitest';

import {
  TURTLE_DEFAULT_LEVERAGE,
  TURTLE_ENTRY_PERIOD,
  TURTLE_MIN_EQUITY_USDT_DEFAULT,
  TURTLE_STOP_ATR_MULT,
  appendUnit,
  turtleAgentDecide,
} from '../decide.js';
import { newTurtleState, type TurtleOHLCV, type TurtleState } from '../state.js';

function bar(close: number, high?: number, low?: number, t = 0): TurtleOHLCV {
  const h = high ?? close + 0.5;
  const l = low ?? close - 0.5;
  return { timestamp: t, open: close, high: h, low: l, close, volume: 100 };
}

/** 25 flat bars at price 10, then a closing breakout at 12 above
 *  the prior 20-bar high (10.5). Suitable for entry-long tests. */
function risingBreakoutSeries(): TurtleOHLCV[] {
  const candles: TurtleOHLCV[] = [];
  for (let i = 0; i < 25; i++) {
    candles.push(bar(10, 10.5, 9.5, i * 60_000));
  }
  candles.push(bar(12, 12.5, 11.8, 25 * 60_000));
  return candles;
}

/** 25 flat bars at price 10, then a closing breakdown at 8 below
 *  the prior 20-bar low (9.5). */
function fallingBreakoutSeries(): TurtleOHLCV[] {
  const candles: TurtleOHLCV[] = [];
  for (let i = 0; i < 25; i++) {
    candles.push(bar(10, 10.5, 9.5, i * 60_000));
  }
  candles.push(bar(8, 8.2, 7.5, 25 * 60_000));
  return candles;
}

describe('turtleAgentDecide — entry signals (test 1, 4, 7, 8)', () => {
  it('enters long on synthetic 20-bar Donchian breakout', () => {
    const ohlcv = risingBreakoutSeries();
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state: newTurtleState(),
    });
    expect(r.action).toBe('enter_long');
    expect(r.sizeUsdt).toBeGreaterThan(0);
    expect(r.leverage).toBe(TURTLE_DEFAULT_LEVERAGE);
    expect(r.stopPrice).toBeLessThan(ohlcv[ohlcv.length - 1]!.close);
    // 2× ATR stop within a few percent of close (synthetic ATR ~ 1).
    const lastClose = ohlcv[ohlcv.length - 1]!.close;
    expect(lastClose - r.stopPrice).toBeGreaterThan(0);
    expect(r.derivation.equityGated).toBe(false);
  });

  it('enters short on Donchian breakdown', () => {
    const r = turtleAgentDecide({
      symbol: 'ETH_USDT_PERP',
      ohlcv: fallingBreakoutSeries(),
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state: newTurtleState(),
    });
    expect(r.action).toBe('enter_short');
    expect(r.stopPrice).toBeGreaterThan(8); // entry 8 + 2 × ATR
  });

  it('holds when allocated capital is zero (arbiter excluded T)', () => {
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv: risingBreakoutSeries(),
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 0,
      state: newTurtleState(),
    });
    expect(r.action).toBe('hold');
  });

  it('position sizing: margin × leverage × (1 / entry) × 2×ATR ≈ 1% allocation', () => {
    const ohlcv = risingBreakoutSeries();
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      account: { equityUsdt: 1000, availableEquityUsdt: 1000 },
      allocatedCapitalUsdt: 500,
      state: newTurtleState(),
    });
    expect(r.action).toBe('enter_long');
    const lastClose = ohlcv[ohlcv.length - 1]!.close;
    const atr = r.derivation.atr;
    const qty = (r.sizeUsdt * r.leverage) / lastClose;
    const lossOn2Atr = qty * 2 * atr;
    // Volatility target: a 2× ATR adverse move should lose ~1 % of allocation = $5.
    expect(lossOn2Atr).toBeGreaterThan(4);
    expect(lossOn2Atr).toBeLessThan(6);
  });

  it('does not consume kernel state — accepts only its declared inputs', () => {
    // Intent: T's signature is symbol/ohlcv/account/allocation/state.
    // No kernel basin, no ML signal — verified via TS compile-time;
    // this runtime test confirms decide() works with that input set
    // alone, no other fields.
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv: risingBreakoutSeries(),
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state: newTurtleState(),
    });
    expect(r.action).toBe('enter_long');
  });
});

describe('turtleAgentDecide — exits (tests 3, 4)', () => {
  it('respects 2× ATR stop on adverse move (long)', () => {
    const ohlcv = risingBreakoutSeries();
    // Held long at 12 with ATR ~1 → stop ~ 10.
    const stopPrice = 10;
    let state: TurtleState = newTurtleState();
    state = appendUnit(state, {
      side: 'long',
      entryPrice: 12,
      atrAtEntry: 1,
      stopPrice,
      marginUsdt: 5,
      leverage: TURTLE_DEFAULT_LEVERAGE,
      openedAtMs: Date.now(),
    });
    // New bar with low <= stop.
    const adverseBar = bar(11, 11.2, 9.5, 26 * 60_000);
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv: [...ohlcv, adverseBar],
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state,
    });
    expect(r.action).toBe('exit_stop');
    expect(r.reason).toContain('stop_hit');
  });

  it('exits long on 10-bar opposite Donchian extreme', () => {
    // Build 30 bars: rising into a breakout long entry, then a
    // sharp drop whose close pierces the 10-bar low.
    const candles: TurtleOHLCV[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push(bar(10 + i * 0.05, 10 + i * 0.05 + 0.3, 10 + i * 0.05 - 0.3, i * 60_000));
    }
    // Held long entry around price 11.2.
    const state: TurtleState = appendUnit(newTurtleState(), {
      side: 'long',
      entryPrice: 11.2,
      atrAtEntry: 0.5,
      stopPrice: 10.0,
      marginUsdt: 5,
      leverage: TURTLE_DEFAULT_LEVERAGE,
      openedAtMs: Date.now(),
    });
    // Now a single bar that closes well below the prior 10-bar low.
    const exitBar = bar(8, 9, 7.5, 25 * 60_000);
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv: [...candles, exitBar],
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state,
    });
    // Adverse low in this bar (7.5) pierces the stop (10), so the
    // stop-hit branch fires before the Donchian branch — that's
    // the correct priority: stop loss is the more urgent exit.
    // We test Donchian-exit specifically with a state whose stop
    // is below the adverse low (i.e. a softer exit trigger).
    expect(['exit_stop', 'exit_donchian']).toContain(r.action);
  });

  it('exits long on Donchian when stop is intact', () => {
    const candles: TurtleOHLCV[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push(bar(10 + i * 0.05, 10 + i * 0.05 + 0.3, 10 + i * 0.05 - 0.3, i * 60_000));
    }
    // Held long at 11.2 with stop at 8.5 (deeper than the adverse low).
    const state: TurtleState = appendUnit(newTurtleState(), {
      side: 'long',
      entryPrice: 11.2,
      atrAtEntry: 0.5,
      stopPrice: 8.5,
      marginUsdt: 5,
      leverage: TURTLE_DEFAULT_LEVERAGE,
      openedAtMs: Date.now(),
    });
    // Bar whose close is below the 10-bar low but whose low (8.7)
    // is ABOVE the stop (8.5) — Donchian-exit is the trigger.
    const exitBar = bar(9, 9.2, 8.7, 25 * 60_000);
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv: [...candles, exitBar],
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state,
    });
    expect(r.action).toBe('exit_donchian');
  });
});

describe('turtleAgentDecide — held position (no double entry)', () => {
  it('does not re-enter when already long', () => {
    const ohlcv = risingBreakoutSeries();
    const state: TurtleState = appendUnit(newTurtleState(), {
      side: 'long',
      entryPrice: 12,
      atrAtEntry: 0.6,
      stopPrice: 10.8,
      marginUsdt: 5,
      leverage: TURTLE_DEFAULT_LEVERAGE,
      openedAtMs: Date.now(),
    });
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state,
    });
    expect(r.action).not.toBe('enter_long');
    expect(r.action).not.toBe('enter_short');
  });
});

describe('turtleAgentDecide — stop math', () => {
  it('long stop = close − 2 × ATR', () => {
    const ohlcv = risingBreakoutSeries();
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state: newTurtleState(),
    });
    expect(r.action).toBe('enter_long');
    const lastClose = ohlcv[ohlcv.length - 1]!.close;
    const expected = lastClose - TURTLE_STOP_ATR_MULT * r.derivation.atr;
    expect(r.stopPrice).toBeCloseTo(expected, 6);
  });

  it('short stop = close + 2 × ATR', () => {
    const ohlcv = fallingBreakoutSeries();
    const r = turtleAgentDecide({
      symbol: 'ETH_USDT_PERP',
      ohlcv,
      account: { equityUsdt: 200, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state: newTurtleState(),
    });
    expect(r.action).toBe('enter_short');
    const lastClose = ohlcv[ohlcv.length - 1]!.close;
    const expected = lastClose + TURTLE_STOP_ATR_MULT * r.derivation.atr;
    expect(r.stopPrice).toBeCloseTo(expected, 6);
  });
});

describe('TURTLE_ENTRY_PERIOD sanity', () => {
  it('matches the documented 20-bar System 1 spec', () => {
    expect(TURTLE_ENTRY_PERIOD).toBe(20);
  });
  it('default min equity is 150 USDT', () => {
    expect(TURTLE_MIN_EQUITY_USDT_DEFAULT).toBe(150);
  });
});
