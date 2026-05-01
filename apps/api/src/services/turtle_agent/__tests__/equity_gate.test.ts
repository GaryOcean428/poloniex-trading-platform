import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  TURTLE_MIN_EQUITY_USDT_DEFAULT,
  turtleAgentDecide,
  turtleMinEquityUsdt,
} from '../decide.js';
import { newTurtleState, type TurtleOHLCV } from '../state.js';

function bar(close: number, high?: number, low?: number, t = 0): TurtleOHLCV {
  const h = high ?? close + 0.5;
  const l = low ?? close - 0.5;
  return { timestamp: t, open: close, high: h, low: l, close, volume: 100 };
}

function risingBreakoutSeries(): TurtleOHLCV[] {
  const candles: TurtleOHLCV[] = [];
  for (let i = 0; i < 25; i++) candles.push(bar(10, 10.5, 9.5, i * 60_000));
  candles.push(bar(12, 12.5, 11.8, 25 * 60_000));
  return candles;
}

describe('turtleAgentDecide — equity activation gate (test 7)', () => {
  let savedEnv: string | undefined;
  beforeEach(() => {
    savedEnv = process.env.TURTLE_MIN_EQUITY_USDT;
    delete process.env.TURTLE_MIN_EQUITY_USDT;
  });
  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.TURTLE_MIN_EQUITY_USDT;
    } else {
      process.env.TURTLE_MIN_EQUITY_USDT = savedEnv;
    }
  });

  it('holds when equity below default threshold ($150)', () => {
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv: risingBreakoutSeries(),
      account: { equityUsdt: 100, availableEquityUsdt: 100 },
      allocatedCapitalUsdt: 50,
      state: newTurtleState(),
    });
    expect(r.action).toBe('hold');
    expect(r.derivation.equityGated).toBe(true);
    expect(r.reason).toContain('equity_gate');
  });

  it('trades when equity at exactly threshold (>= 150)', () => {
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv: risingBreakoutSeries(),
      account: {
        equityUsdt: TURTLE_MIN_EQUITY_USDT_DEFAULT,
        availableEquityUsdt: TURTLE_MIN_EQUITY_USDT_DEFAULT,
      },
      allocatedCapitalUsdt: 50,
      state: newTurtleState(),
    });
    expect(r.action).toBe('enter_long');
    expect(r.derivation.equityGated).toBe(false);
  });

  it('honors env override TURTLE_MIN_EQUITY_USDT', () => {
    process.env.TURTLE_MIN_EQUITY_USDT = '500';
    expect(turtleMinEquityUsdt()).toBe(500);
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv: risingBreakoutSeries(),
      account: { equityUsdt: 200, availableEquityUsdt: 200 },
      allocatedCapitalUsdt: 50,
      state: newTurtleState(),
    });
    // 200 < 500 → blocked.
    expect(r.action).toBe('hold');
    expect(r.derivation.equityGated).toBe(true);
  });

  it('falls back to default when env override is invalid', () => {
    process.env.TURTLE_MIN_EQUITY_USDT = 'not-a-number';
    expect(turtleMinEquityUsdt()).toBe(TURTLE_MIN_EQUITY_USDT_DEFAULT);
    process.env.TURTLE_MIN_EQUITY_USDT = '0';
    expect(turtleMinEquityUsdt()).toBe(TURTLE_MIN_EQUITY_USDT_DEFAULT);
    process.env.TURTLE_MIN_EQUITY_USDT = '-50';
    expect(turtleMinEquityUsdt()).toBe(TURTLE_MIN_EQUITY_USDT_DEFAULT);
  });

  it('does not enter even with positive allocation if equity-gated', () => {
    const r = turtleAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv: risingBreakoutSeries(),
      account: { equityUsdt: 75, availableEquityUsdt: 75 },
      allocatedCapitalUsdt: 200, // hypothetical allocation; gate trumps it
      state: newTurtleState(),
    });
    expect(r.action).toBe('hold');
  });
});
