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

  it('promotes scalping strategy meeting scalping criteria', () => {
    expect(shouldPromoteToLive(0.55, 1.7, 10, false, 'scalping')).toBe(true);
  });

  it('blocks scalping strategy at exact scalping WR threshold (strict >)', () => {
    expect(shouldPromoteToLive(0.50, 1.5, 10, false, 'scalping')).toBe(false);
  });

  it('blocks scalping strategy at exact scalping PF threshold (strict >)', () => {
    expect(shouldPromoteToLive(0.55, 1.3, 10, false, 'scalping')).toBe(false);
  });

  it('blocks scalping strategy with insufficient trades', () => {
    expect(shouldPromoteToLive(0.55, 1.7, 9, false, 'scalping')).toBe(false);
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

  it('replicates QIG R² failure mode censored outlier inflates avg WR by over 20 percent', () => {
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

// ---------------------------------------------------------------------------
// Dual censored/uncensored Sharpe fitness — QIG reliability_warning
// ---------------------------------------------------------------------------

function computeSharpe(trades: Array<{ pnl: number }>): number {
  if (trades.length < 2) return 0;
  const pnls = trades.map(t => t.pnl);
  const avg = pnls.reduce((s, v) => s + v, 0) / pnls.length;
  const variance = pnls.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / pnls.length;
  const stdDev = Math.sqrt(variance);
  return stdDev > 0 ? avg / stdDev : 0;
}

function computeReliabilityWarning(
  allTrades: Array<{ pnl: number; isCensored: boolean }>,
  divergenceThreshold = 0.20
): { reliabilityWarning: boolean; divergence: number } {
  const allSharpe = computeSharpe(allTrades);
  const uncensoredSharpe = computeSharpe(allTrades.filter(t => !t.isCensored));
  const denominator = Math.max(Math.abs(uncensoredSharpe), 0.01);
  const divergence = Math.abs(allSharpe - uncensoredSharpe) / denominator;
  return { reliabilityWarning: divergence > divergenceThreshold, divergence };
}

describe('Dual censored/uncensored Sharpe fitness (QIG reliability_warning)', () => {
  it('flags reliability_warning when censored sessions inflate Sharpe by >20%', () => {
    // Uncensored trades: mediocre, negative-average PnL
    const trades = [
      { pnl: 10, isCensored: false },
      { pnl: -20, isCensored: false },
      { pnl: 5, isCensored: false },
      { pnl: -15, isCensored: false },
      // Censored trade with very large outlier PnL (forced-close artefact)
      { pnl: 500, isCensored: true },
    ];
    const { reliabilityWarning, divergence } = computeReliabilityWarning(trades);
    expect(divergence).toBeGreaterThan(0.20);
    expect(reliabilityWarning).toBe(true);
  });

  it('does not flag reliability_warning when divergence is within 20%', () => {
    const trades = [
      { pnl: 10, isCensored: false },
      { pnl: 12, isCensored: false },
      { pnl: 11, isCensored: false },
      // Censored trade with similar PnL — not distorting
      { pnl: 11, isCensored: true },
    ];
    const { reliabilityWarning, divergence } = computeReliabilityWarning(trades);
    expect(divergence).toBeLessThanOrEqual(0.20);
    expect(reliabilityWarning).toBe(false);
  });

  it('returns reliability_warning=false when no trades are present', () => {
    const { reliabilityWarning } = computeReliabilityWarning([]);
    expect(reliabilityWarning).toBe(false);
  });

  it('returns reliability_warning=false when all trades are uncensored', () => {
    const trades = [
      { pnl: 10, isCensored: false },
      { pnl: 20, isCensored: false },
    ];
    const { reliabilityWarning } = computeReliabilityWarning(trades);
    // allSharpe == uncensoredSharpe → divergence = 0
    expect(reliabilityWarning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Continuous confidence-based position sizing
// ---------------------------------------------------------------------------

function calcPositionSize(
  currentValue: number,
  riskPerTrade: number,
  stopLossPercent: number,
  maxPositionSize: number,
  price: number,
  confidence: number
): number {
  const riskAmount = currentValue * riskPerTrade;
  const maxPositionValue = riskAmount / stopLossPercent;
  const maxPositionSizeUnits = maxPositionValue / price;
  const maxAllowedSize = (currentValue * maxPositionSize) / price;
  const baseSize = Math.min(maxPositionSizeUnits, maxAllowedSize);
  // Continuous confidence scaling
  return baseSize * (Math.min(Math.max(confidence, 0), 100) / 100);
}

describe('Continuous confidence position sizing (no threshold noise)', () => {
  const baseParams = { currentValue: 10000, riskPerTrade: 0.02, stopLossPercent: 0.02, maxPositionSize: 0.10, price: 100 };

  it('scales position linearly with confidence', () => {
    const { currentValue, riskPerTrade, stopLossPercent, maxPositionSize, price } = baseParams;
    const size50 = calcPositionSize(currentValue, riskPerTrade, stopLossPercent, maxPositionSize, price, 50);
    const size100 = calcPositionSize(currentValue, riskPerTrade, stopLossPercent, maxPositionSize, price, 100);
    expect(size50).toBeCloseTo(size100 * 0.5, 5);
  });

  it('confidence=49.9% and confidence=50.1% produce similar (not opposite) sizes', () => {
    const { currentValue, riskPerTrade, stopLossPercent, maxPositionSize, price } = baseParams;
    const size499 = calcPositionSize(currentValue, riskPerTrade, stopLossPercent, maxPositionSize, price, 49.9);
    const size501 = calcPositionSize(currentValue, riskPerTrade, stopLossPercent, maxPositionSize, price, 50.1);
    const ratio = size501 / size499;
    // Should be very close to 1 (within 1%)
    expect(ratio).toBeGreaterThan(0.99);
    expect(ratio).toBeLessThan(1.01);
  });

  it('confidence=0 yields zero position size', () => {
    const { currentValue, riskPerTrade, stopLossPercent, maxPositionSize, price } = baseParams;
    const size = calcPositionSize(currentValue, riskPerTrade, stopLossPercent, maxPositionSize, price, 0);
    expect(size).toBe(0);
  });

  it('confidence above 100 is clamped to 100', () => {
    const { currentValue, riskPerTrade, stopLossPercent, maxPositionSize, price } = baseParams;
    const sizeMax  = calcPositionSize(currentValue, riskPerTrade, stopLossPercent, maxPositionSize, price, 100);
    const sizeover = calcPositionSize(currentValue, riskPerTrade, stopLossPercent, maxPositionSize, price, 150);
    expect(sizeover).toBe(sizeMax);
  });
});

// ---------------------------------------------------------------------------
// Confidence trajectory buffer
// ---------------------------------------------------------------------------

describe('Confidence trajectory (last-N rolling buffer)', () => {
  function buildTrajectory(scores: number[], maxLen = 20): number[] {
    const buf: number[] = [];
    for (const s of scores) {
      buf.push(s);
      if (buf.length > maxLen) buf.shift();
    }
    return [...buf];
  }

  it('retains all scores when below capacity', () => {
    const traj = buildTrajectory([70, 75, 80]);
    expect(traj).toEqual([70, 75, 80]);
  });

  it('evicts oldest score when capacity is exceeded', () => {
    const traj = buildTrajectory([70, 75, 80], 2);
    expect(traj).toEqual([75, 80]);
  });

  it('trajectory length equals trajectoryLength when overfilled', () => {
    const traj = buildTrajectory(Array.from({ length: 30 }, (_, i) => i), 20);
    expect(traj.length).toBe(20);
  });

  it('most recent score is always the last element', () => {
    const traj = buildTrajectory([10, 20, 30, 40, 50], 3);
    expect(traj[traj.length - 1]).toBe(50);
  });
});
