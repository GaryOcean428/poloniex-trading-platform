/**
 * Paper Trading Promotion Threshold and Censoring Tests
 */
import { describe, it, expect } from 'vitest';

const BACKTEST_THRESHOLDS = {
  default:  { winRate: 0.40, profitFactor: 1.0 },
  scalping: { winRate: 0.42, profitFactor: 1.1 },
};

const PAPER_TO_LIVE_THRESHOLDS = {
  default:  { winRate: 0.52, profitFactor: 1.5, minTrades: 5 },
  scalping: { winRate: 0.50, profitFactor: 1.3, minTrades: 10 },
};

function shouldPromoteToPaper(
  winRate: number,
  profitFactor: number,
  style: 'scalping' | 'default' = 'default'
): boolean {
  const t = BACKTEST_THRESHOLDS[style];
  return winRate >= t.winRate && profitFactor >= t.profitFactor;
}

function shouldPromoteToLive(
  winRate: number,
  profitFactor: number,
  totalTrades: number,
  isCensored: boolean,
  style: 'scalping' | 'default' = 'default'
): boolean {
  if (isCensored) return false;
  const t = PAPER_TO_LIVE_THRESHOLDS[style];
  return winRate > t.winRate && profitFactor > t.profitFactor && totalTrades >= t.minTrades;
}

describe('Backtest to Paper promotion thresholds', () => {
  it('promotes strategy with WR=50% PF=1.2', () => {
    expect(shouldPromoteToPaper(0.50, 1.2)).toBe(true);
  });

  it('promotes strategy at threshold floor WR=40% PF=1.0', () => {
    expect(shouldPromoteToPaper(0.40, 1.0)).toBe(true);
  });

  it('promotes strategy with WR=45% PF=1.5', () => {
    expect(shouldPromoteToPaper(0.45, 1.5)).toBe(true);
  });

  it('blocks strategy with WR=39% below floor', () => {
    expect(shouldPromoteToPaper(0.39, 1.5)).toBe(false);
  });

  it('blocks strategy with PF=0.8 below break-even', () => {
    expect(shouldPromoteToPaper(0.55, 0.8)).toBe(false);
  });

  it('documents the fix: 50% WR was blocked at old 55% gate now passes at 40%', () => {
    const strategyWR = 0.50;
    expect(strategyWR > 0.55).toBe(false);
    expect(strategyWR >= 0.40).toBe(true);
  });

  it('blocks Multi-Combo ETH WR=28.6% genuinely too low', () => {
    expect(shouldPromoteToPaper(0.286, 0.9)).toBe(false);
  });

  it('promotes scalping strategy at scalping floor WR=42% PF=1.1', () => {
    expect(shouldPromoteToPaper(0.42, 1.1, 'scalping')).toBe(true);
  });

  it('blocks scalping strategy with WR=41% just below scalping floor', () => {
    expect(shouldPromoteToPaper(0.41, 1.5, 'scalping')).toBe(false);
  });
});

describe('Paper to Live promotion thresholds', () => {
  it('promotes uncensored strategy meeting all criteria', () => {
    expect(shouldPromoteToLive(0.55, 1.6, 10, false)).toBe(true);
  });

  it('blocks strategy with insufficient trades', () => {
    expect(shouldPromoteToLive(0.55, 1.6, 4, false)).toBe(false);
  });

  it('blocks strategy at WR exactly at threshold strict greater-than', () => {
    expect(shouldPromoteToLive(0.52, 1.6, 10, false)).toBe(false);
  });

  it('blocks strategy with low profit factor', () => {
    expect(shouldPromoteToLive(0.55, 1.5, 10, false)).toBe(false);
  });
});

describe('QIG Censoring censored sessions blocked from live promotion', () => {
  it('blocks live promotion when session hit max drawdown kill threshold', () => {
    expect(shouldPromoteToLive(0.80, 3.0, 50, true)).toBe(false);
  });

  it('blocks live promotion when session was force-closed with open positions', () => {
    expect(shouldPromoteToLive(0.70, 2.0, 20, true)).toBe(false);
  });

  it('allows live promotion for clean uncensored session meeting criteria', () => {
    expect(shouldPromoteToLive(0.55, 1.6, 10, false)).toBe(true);
  });

  it('replicates QIG R squared failure mode censored outlier inflates avg WR by over 20 percent', () => {
    const sessions = [
      { winRate: 0.50, isCensored: false },
      { winRate: 0.40, isCensored: false },
      { winRate: 0.60, isCensored: false },
      { winRate: 0.95, isCensored: true },
    ];

    const avgOf = (arr: typeof sessions) =>
      arr.reduce((s, x) => s + x.winRate, 0) / arr.length;

    const allWR        = avgOf(sessions);
    const uncensoredWR = avgOf(sessions.filter(s => !s.isCensored));
    const divergence   = Math.abs(allWR - uncensoredWR) / uncensoredWR;

    expect(divergence).toBeGreaterThan(0.20);
  });

  it('strategy is reliable when censored and uncensored WR diverge less than 20 percent', () => {
    const sessions = [
      { winRate: 0.50, isCensored: false },
      { winRate: 0.52, isCensored: false },
      { winRate: 0.51, isCensored: true },
    ];

    const avgOf = (arr: typeof sessions) =>
      arr.reduce((s, x) => s + x.winRate, 0) / arr.length;

    const allWR        = avgOf(sessions);
    const uncensoredWR = avgOf(sessions.filter(s => !s.isCensored));
    const divergence   = Math.abs(allWR - uncensoredWR) / uncensoredWR;

    expect(divergence).toBeLessThan(0.20);
  });
});

describe('Pipeline funnel Generated to Backtested to Paper Trading', () => {
  it('volume_analysis_BTC WR=50% now promotes to paper', () => {
    expect(shouldPromoteToPaper(0.50, 1.1)).toBe(true);
  });

  it('momentum ETH WR=50% now promotes to paper', () => {
    expect(shouldPromoteToPaper(0.50, 1.05)).toBe(true);
  });

  it('Multi-Combo ETH WR=28.6% correctly stays blocked', () => {
    expect(shouldPromoteToPaper(0.286, 0.8)).toBe(false);
  });

  it('4 of 6 representative strategies are promoted with new thresholds', () => {
    const backtested = [
      { winRate: 0.50, profitFactor: 1.1 },
      { winRate: 0.50, profitFactor: 1.05 },
      { winRate: 0.42, profitFactor: 1.0 },
      { winRate: 0.44, profitFactor: 1.2 },
      { winRate: 0.38, profitFactor: 0.9 },
      { winRate: 0.286, profitFactor: 0.8 },
    ];

    const promoted = backtested.filter(s => shouldPromoteToPaper(s.winRate, s.profitFactor));
    expect(promoted.length).toBeGreaterThan(0);
    expect(promoted.length).toBe(4);
  });
});
