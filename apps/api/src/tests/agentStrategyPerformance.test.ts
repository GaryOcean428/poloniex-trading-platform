import { describe, it, expect } from 'vitest';
import {
  validateAgentStrategyPerformance,
  normalizeAgentStrategyPerformance,
} from '../services/agentStrategyPerformance.js';

/**
 * Canonical-unit tests for `agent_strategies.performance`.
 *
 * Mirrors the `validateBacktestMetrics` guard in backtestingEngine.shorts
 * but for the `agent_strategies.performance` JSONB column, which stores
 * metrics in DECIMAL form (0.4286 = 42.86%) rather than PERCENT (42.86 =
 * 42.86%).
 *
 * Background: prod had mixed-convention rows (winRate 0.4286 decimal,
 * totalReturn −89.60 percent, maxDrawdown 5.886 percent) which produced
 * the "−89.60% Total Return with PF 1.14" contradiction on the Backtest
 * card. PR #502 fixed the consumer (UI strict decimal). This PR fixes the
 * producer (validator) and the legacy-row reader path (normaliser).
 */

describe('validateAgentStrategyPerformance — canonical decimal guard', () => {
  const validRow = {
    winRate: 0.4286, // 42.86%
    totalReturn: -0.006, // −0.6%
    maxDrawdown: 0.05886, // 5.886%
    profitFactor: 1.55,
    totalTrades: 7,
    totalPnl: -0.03,
  };

  it('accepts a canonical decimal row', () => {
    expect(() => validateAgentStrategyPerformance({ ...validRow })).not.toThrow();
  });

  it('refuses winRate > 1 (percent-form in a decimal field)', () => {
    expect(() =>
      validateAgentStrategyPerformance({ ...validRow, winRate: 42.86 })
    ).toThrow(/winRate/);
    expect(() =>
      validateAgentStrategyPerformance({ ...validRow, winRate: 100 })
    ).toThrow(/winRate/);
  });

  it('refuses winRate < 0', () => {
    expect(() =>
      validateAgentStrategyPerformance({ ...validRow, winRate: -0.01 })
    ).toThrow(/winRate/);
  });

  it('refuses totalReturn > 10 (percent-form bug vector — the −89.60 row)', () => {
    expect(() =>
      validateAgentStrategyPerformance({ ...validRow, totalReturn: -89.6 })
    ).toThrow(/totalReturn/);
    expect(() =>
      validateAgentStrategyPerformance({ ...validRow, totalReturn: 100 })
    ).toThrow(/totalReturn/);
  });

  it('refuses maxDrawdown > 1 (percent-form bug vector — the 5.886 row)', () => {
    expect(() =>
      validateAgentStrategyPerformance({ ...validRow, maxDrawdown: 5.886 })
    ).toThrow(/maxDrawdown/);
  });

  it('refuses maxDrawdown < 0', () => {
    expect(() =>
      validateAgentStrategyPerformance({ ...validRow, maxDrawdown: -0.01 })
    ).toThrow(/maxDrawdown/);
  });

  it('refuses non-finite values', () => {
    expect(() =>
      validateAgentStrategyPerformance({ ...validRow, totalReturn: NaN })
    ).toThrow(/totalReturn/);
    expect(() =>
      validateAgentStrategyPerformance({ ...validRow, profitFactor: Infinity })
    ).toThrow(/profitFactor/);
  });

  it('accepts the 9999.99 profitFactor sentinel (zero-loss case)', () => {
    expect(() =>
      validateAgentStrategyPerformance({ ...validRow, profitFactor: 9999.99 })
    ).not.toThrow();
  });

  it('refuses profitFactor > 1000 (non-sentinel)', () => {
    expect(() =>
      validateAgentStrategyPerformance({ ...validRow, profitFactor: 1001 })
    ).toThrow(/profitFactor/);
  });

  it('refuses non-object input', () => {
    expect(() => validateAgentStrategyPerformance(null as any)).toThrow();
    expect(() => validateAgentStrategyPerformance('not-object' as any)).toThrow();
  });
});

describe('normalizeAgentStrategyPerformance — legacy-row coercion', () => {
  it('converts legacy percent-form totalReturn to decimal', () => {
    const legacy = { totalReturn: -89.6, winRate: 0.4286, maxDrawdown: 0.05, profitFactor: 1.14 };
    const out = normalizeAgentStrategyPerformance(legacy);
    expect(out.totalReturn).toBeCloseTo(-0.896, 6);
  });

  it('leaves canonical decimal totalReturn untouched', () => {
    const canonical = { totalReturn: -0.006, winRate: 0.4286, maxDrawdown: 0.05, profitFactor: 1.14 };
    const out = normalizeAgentStrategyPerformance(canonical);
    expect(out.totalReturn).toBeCloseTo(-0.006, 6);
  });

  it('converts legacy percent-form maxDrawdown to decimal', () => {
    const legacy = { totalReturn: -0.006, winRate: 0.4286, maxDrawdown: 5.886, profitFactor: 1.14 };
    const out = normalizeAgentStrategyPerformance(legacy);
    expect(out.maxDrawdown).toBeCloseTo(0.05886, 6);
  });

  it('leaves canonical decimal maxDrawdown untouched', () => {
    const canonical = { totalReturn: -0.006, winRate: 0.4286, maxDrawdown: 0.05886, profitFactor: 1.14 };
    const out = normalizeAgentStrategyPerformance(canonical);
    expect(out.maxDrawdown).toBeCloseTo(0.05886, 6);
  });

  it('handles the exact production bug row (−89.60% / PF 1.14 / 5.886% DD)', () => {
    const prodBug = {
      winRate: 0.4286,
      totalReturn: -89.6,
      maxDrawdown: 5.886,
      profitFactor: 1.14,
      totalTrades: 7,
    };
    const out = normalizeAgentStrategyPerformance(prodBug);
    expect(out.totalReturn).toBeCloseTo(-0.896, 6);
    expect(out.maxDrawdown).toBeCloseTo(0.05886, 6);
    // winRate/profitFactor/totalTrades passed through unchanged.
    expect(out.winRate).toBeCloseTo(0.4286, 6);
    expect(out.profitFactor).toBeCloseTo(1.14, 6);
    expect(out.totalTrades).toBe(7);
  });

  it('returns sensible zeros for null/undefined input', () => {
    const outNull = normalizeAgentStrategyPerformance(null);
    expect(outNull.winRate).toBe(0);
    expect(outNull.totalReturn).toBe(0);
    expect(outNull.maxDrawdown).toBe(0);
    expect(outNull.profitFactor).toBe(0);
    expect(outNull.totalTrades).toBe(0);
    expect(outNull.totalPnl).toBe(0);

    const outUndef = normalizeAgentStrategyPerformance(undefined);
    expect(outUndef.winRate).toBe(0);
  });

  it('coerces non-numeric fields to zero', () => {
    const junk = {
      winRate: 'bad' as any,
      totalReturn: null as any,
      maxDrawdown: NaN,
      profitFactor: undefined as any,
    };
    const out = normalizeAgentStrategyPerformance(junk);
    expect(out.winRate).toBe(0);
    expect(out.totalReturn).toBe(0);
    expect(out.maxDrawdown).toBe(0);
    expect(out.profitFactor).toBe(0);
  });

  it('preserves unknown pass-through fields', () => {
    const extra = {
      totalReturn: -0.006,
      winRate: 0.5,
      maxDrawdown: 0.1,
      profitFactor: 1.5,
      sharpeRatio: 1.23,
      customMetric: { nested: true },
    };
    const out = normalizeAgentStrategyPerformance(extra);
    expect(out.sharpeRatio).toBe(1.23);
    expect(out.customMetric).toEqual({ nested: true });
  });
});
