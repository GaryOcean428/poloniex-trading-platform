import { describe, it, expect } from 'vitest';
import { mlAgentDecide, mlLeverageForStrength } from '../decide.js';
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
    // Proposal #8: leverage now scales with ml_strength. At 0.7 the
    // excess over threshold is 0.15, giving lev = 8 + 12*(0.15/0.45) = 12.
    expect(r.leverage).toBe(12);
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

describe('mlLeverageForStrength (proposal #8)', () => {
  it('returns base leverage at threshold (0.55)', () => {
    expect(mlLeverageForStrength(0.55)).toBe(8);
  });

  it('returns max leverage at perfect confidence (1.0)', () => {
    expect(mlLeverageForStrength(1.0)).toBe(20);
  });

  it('returns base leverage below threshold (no negative scaling)', () => {
    expect(mlLeverageForStrength(0.0)).toBe(8);
    expect(mlLeverageForStrength(0.3)).toBe(8);
    expect(mlLeverageForStrength(0.54)).toBe(8);
  });

  it('clamps at max leverage past 1.0 (defensive)', () => {
    expect(mlLeverageForStrength(1.2)).toBe(20);
  });

  it('scales linearly between base and max', () => {
    // Halfway up: strength = 0.55 + 0.45/2 = 0.775 -> lev = 14.
    expect(mlLeverageForStrength(0.775)).toBe(14);
  });

  it('rounds to integer leverage', () => {
    // 0.6 -> excess 0.05 -> lev_raw = 8 + 12*(0.05/0.45) = 9.333 -> 9
    expect(mlLeverageForStrength(0.6)).toBe(9);
    // 0.65 -> excess 0.10 -> lev_raw = 8 + 12*(0.10/0.45) = 10.667 -> 11
    expect(mlLeverageForStrength(0.65)).toBe(11);
  });

  it('is monotonic non-decreasing in strength', () => {
    let prev = mlLeverageForStrength(0);
    for (let s = 0.05; s <= 1.05; s += 0.05) {
      const cur = mlLeverageForStrength(s);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });

  it('embeds leverage in entry reason text', () => {
    const r = mlAgentDecide({
      ...baseInputs, mlSignal: 'BUY', mlStrength: 0.95, allocatedCapitalUsdt: 50,
    });
    expect(r.action).toBe('enter_long');
    expect(r.reason).toMatch(/lev=\d+x/);
    // 0.95 -> excess 0.40 -> lev_raw = 8 + 12*(0.40/0.45) = 18.667 -> 19
    expect(r.leverage).toBe(19);
  });

  it('never exceeds 20 across the full strength domain', () => {
    for (let s = 0; s <= 2.0; s += 0.01) {
      expect(mlLeverageForStrength(s)).toBeLessThanOrEqual(20);
    }
  });

  it('never returns less than ML_LEV_BASE = 8', () => {
    for (let s = -1.0; s <= 2.0; s += 0.01) {
      expect(mlLeverageForStrength(s)).toBeGreaterThanOrEqual(8);
    }
  });
});
