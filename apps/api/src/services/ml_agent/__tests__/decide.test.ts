/**
 * decide.test.ts — Agent M (ml control arm) decision tests.
 */
import { describe, it, expect } from 'vitest';
import { mlAgentDecide, ML_AGENT_CONSTANTS, type MLAgentInputs } from '../decide.js';

const baseAccount = {
  availableEquityUsdt: 100,
  heldSide: null,
  lastPrice: 75000,
  minNotional: 5,
};

const ohlcv: MLAgentInputs['ohlcv'] = Array.from({ length: 60 }, (_, i) => ({
  timestamp: i * 60_000,
  open: 75000,
  high: 75100,
  low: 74900,
  close: 75000 + i,
  volume: 1000,
}));

describe('mlAgentDecide — entry decisions', () => {
  it('holds when ml strength below threshold', () => {
    const decision = mlAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      mlSignal: 'BUY',
      mlStrength: 0.30,
      account: baseAccount,
    });
    expect(decision.action).toBe('hold');
    expect(decision.size_usdt).toBe(0);
    expect(decision.reason).toContain('< threshold');
  });

  it('holds on HOLD signal regardless of strength', () => {
    const decision = mlAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      mlSignal: 'HOLD',
      mlStrength: 0.99,
      account: baseAccount,
    });
    expect(decision.action).toBe('hold');
  });

  it('enters long on BUY above threshold', () => {
    const decision = mlAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      mlSignal: 'BUY',
      mlStrength: 0.80,
      account: baseAccount,
    });
    expect(decision.action).toBe('enter_long');
    expect(decision.size_usdt).toBeGreaterThan(0);
    expect(decision.leverage).toBe(ML_AGENT_CONSTANTS.ML_DEFAULT_LEVERAGE);
  });

  it('enters short on SELL above threshold', () => {
    const decision = mlAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      mlSignal: 'SELL',
      mlStrength: 0.80,
      account: baseAccount,
    });
    expect(decision.action).toBe('enter_short');
    expect(decision.size_usdt).toBeGreaterThan(0);
  });

  it('holds when equity is zero', () => {
    const decision = mlAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      mlSignal: 'BUY',
      mlStrength: 0.90,
      account: { ...baseAccount, availableEquityUsdt: 0 },
    });
    expect(decision.action).toBe('hold');
    expect(decision.reason).toContain('equity');
  });
});

describe('mlAgentDecide — exit decisions', () => {
  it('exits when held side conflicts with strong opposite signal', () => {
    const decision = mlAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      mlSignal: 'SELL',
      mlStrength: 0.80,
      account: { ...baseAccount, heldSide: 'long' },
    });
    expect(decision.action).toBe('exit');
    expect(decision.size_usdt).toBe(0);
    expect(decision.reason).toContain('reverses long');
  });

  it('exits on HOLD while position open', () => {
    const decision = mlAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      mlSignal: 'HOLD',
      mlStrength: 0.10,
      account: { ...baseAccount, heldSide: 'short' },
    });
    expect(decision.action).toBe('exit');
    expect(decision.reason).toContain('HOLD while short held');
  });

  it('holds existing position when signal agrees', () => {
    const decision = mlAgentDecide({
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      mlSignal: 'BUY',
      mlStrength: 0.80,
      account: { ...baseAccount, heldSide: 'long' },
    });
    expect(decision.action).toBe('hold');
    expect(decision.reason).toContain('agrees');
  });
});

describe('mlAgentDecide — kernel-state independence', () => {
  it('produces decisions with no kernel/basin/emotion state available', () => {
    // The directive: "Agent M produces decisions with kernel state mocked
    // as None." MLAgentInputs has no field for kernel state — this test
    // confirms the type signature itself enforces that. We just construct
    // and call with the documented surface.
    const inputs: MLAgentInputs = {
      symbol: 'BTC_USDT_PERP',
      ohlcv,
      mlSignal: 'BUY',
      mlStrength: 0.80,
      account: baseAccount,
    };
    const decision = mlAgentDecide(inputs);
    expect(decision.action).toBe('enter_long');
    // No basin / no emotions / no kernel ever appeared in the input.
    expect(Object.keys(inputs)).toEqual([
      'symbol', 'ohlcv', 'mlSignal', 'mlStrength', 'account',
    ]);
  });
});
