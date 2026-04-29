import { describe, it, expect } from 'vitest';
import { mlAgentDecide } from '../decide.js';
import type { MLAgentInputs } from '../types.js';

const baseInputs: Omit<MLAgentInputs, 'mlSignal' | 'mlStrength' | 'allocatedCapitalUsdt'> = {
  symbol: 'BTC_USDT_PERP',
  ohlcv: [],
  account: {
    equityFraction: 1.0,
    marginFraction: 0.0,
    openPositions: 0,
    availableEquity: 100,
  },
};

describe('mlAgentDecide', () => {
  it('holds when ml signal is HOLD', () => {
    const r = mlAgentDecide({
      ...baseInputs, mlSignal: 'HOLD', mlStrength: 0.9, allocatedCapitalUsdt: 50,
    });
    expect(r.action).toBe('hold');
    expect(r.reason).toContain('HOLD');
  });

  it('holds when ml strength below threshold', () => {
    const r = mlAgentDecide({
      ...baseInputs, mlSignal: 'BUY', mlStrength: 0.4, allocatedCapitalUsdt: 50,
    });
    expect(r.action).toBe('hold');
    expect(r.reason).toContain('threshold');
  });

  it('holds when arbiter allocates zero capital', () => {
    const r = mlAgentDecide({
      ...baseInputs, mlSignal: 'BUY', mlStrength: 0.7, allocatedCapitalUsdt: 0,
    });
    expect(r.action).toBe('hold');
    expect(r.reason).toContain('0 capital');
  });

  it('enters long when BUY at sufficient strength', () => {
    const r = mlAgentDecide({
      ...baseInputs, mlSignal: 'BUY', mlStrength: 0.7, allocatedCapitalUsdt: 50,
    });
    expect(r.action).toBe('enter_long');
    expect(r.sizeUsdt).toBeGreaterThan(0);
    expect(r.leverage).toBe(8);
  });

  it('enters short when SELL at sufficient strength', () => {
    const r = mlAgentDecide({
      ...baseInputs, mlSignal: 'SELL', mlStrength: 0.7, allocatedCapitalUsdt: 50,
    });
    expect(r.action).toBe('enter_short');
  });

  it('size respects allocated capital fraction', () => {
    const r = mlAgentDecide({
      ...baseInputs, mlSignal: 'BUY', mlStrength: 0.7, allocatedCapitalUsdt: 25,
    });
    expect(r.sizeUsdt).toBeLessThanOrEqual(25);
    expect(r.sizeUsdt).toBeGreaterThan(0);
  });

  it('reason includes signal and strength on entry', () => {
    const r = mlAgentDecide({
      ...baseInputs, mlSignal: 'BUY', mlStrength: 0.722, allocatedCapitalUsdt: 50,
    });
    expect(r.reason).toContain('BUY');
    expect(r.reason).toContain('0.722');
  });
});
