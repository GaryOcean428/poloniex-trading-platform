export type CapabilityClass = 'tier1' | 'tier2' | 'tier3';

export interface CapabilityPerformanceInput {
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  totalReturn: number;
  maxDrawdown?: number;
  sharpeRatio?: number;
}

export interface CapabilityHint {
  metric: 'winRate' | 'profitFactor' | 'maxDrawdown';
  current: number;
  target: number;
  gap: number;
  priority: 'high' | 'medium';
  recommendation: string;
}

const MAX_PROFIT_FACTOR = 2.5;
const MAX_SHARPE_RATIO = 2;
const MAX_DRAWDOWN_FOR_NORMALIZATION = 0.3;

const WIN_RATE_WEIGHT = 35;
const PROFIT_FACTOR_WEIGHT = 25;
const DRAWDOWN_WEIGHT = 25;
const SHARPE_WEIGHT = 15;

const WIN_RATE_TARGET = 0.55;
const WIN_RATE_HIGH_PRIORITY_THRESHOLD = 0.45;
const PROFIT_FACTOR_TARGET = 1.5;
const PROFIT_FACTOR_HIGH_PRIORITY_THRESHOLD = 1.2;
const MAX_DRAWDOWN_TARGET = 0.15;
const MAX_DRAWDOWN_HIGH_PRIORITY_THRESHOLD = 0.22;

export function calculateCompositeCapabilityScore(input: CapabilityPerformanceInput): number {
  const normalizedWinRate = Math.min(Math.max(input.winRate, 0), 1);
  const normalizedProfitFactor = Math.min(Math.max(input.profitFactor, 0), MAX_PROFIT_FACTOR) / MAX_PROFIT_FACTOR;
  const normalizedSharpe = Math.min(Math.max(input.sharpeRatio || 0, 0), MAX_SHARPE_RATIO) / MAX_SHARPE_RATIO;
  const normalizedDrawdown = Math.max(
    0,
    1 - Math.min(Math.max(input.maxDrawdown || 0, 0), MAX_DRAWDOWN_FOR_NORMALIZATION) / MAX_DRAWDOWN_FOR_NORMALIZATION
  );

  // Weighted blend inspired by PowerTrader-style reliability + risk discipline
  const score =
    normalizedWinRate * WIN_RATE_WEIGHT +
    normalizedProfitFactor * PROFIT_FACTOR_WEIGHT +
    normalizedDrawdown * DRAWDOWN_WEIGHT +
    normalizedSharpe * SHARPE_WEIGHT;

  return Math.round(Math.min(100, Math.max(0, score)));
}

export function getStrategyCapabilityClass(score: number): CapabilityClass {
  if (score >= 75) return 'tier1';
  if (score >= 50) return 'tier2';
  return 'tier3';
}

export function generateCapabilityHints(input: CapabilityPerformanceInput): CapabilityHint[] {
  const hints: CapabilityHint[] = [];

  if (input.winRate < WIN_RATE_TARGET) {
    hints.push({
      metric: 'winRate',
      current: input.winRate,
      target: WIN_RATE_TARGET,
      gap: parseFloat((WIN_RATE_TARGET - input.winRate).toFixed(4)),
      priority: input.winRate < WIN_RATE_HIGH_PRIORITY_THRESHOLD ? 'high' : 'medium',
      recommendation: 'Tighten entry filters and reduce low-conviction setups.'
    });
  }

  if (input.profitFactor < PROFIT_FACTOR_TARGET) {
    hints.push({
      metric: 'profitFactor',
      current: input.profitFactor,
      target: PROFIT_FACTOR_TARGET,
      gap: parseFloat((PROFIT_FACTOR_TARGET - input.profitFactor).toFixed(4)),
      priority: input.profitFactor < PROFIT_FACTOR_HIGH_PRIORITY_THRESHOLD ? 'high' : 'medium',
      recommendation: 'Improve reward-to-risk ratio with tighter stops and stronger take-profit rules.'
    });
  }

  const maxDrawdown = input.maxDrawdown || 0;
  if (maxDrawdown > MAX_DRAWDOWN_TARGET) {
    hints.push({
      metric: 'maxDrawdown',
      current: maxDrawdown,
      target: MAX_DRAWDOWN_TARGET,
      gap: parseFloat((maxDrawdown - MAX_DRAWDOWN_TARGET).toFixed(4)),
      priority: maxDrawdown > MAX_DRAWDOWN_HIGH_PRIORITY_THRESHOLD ? 'high' : 'medium',
      recommendation: 'Lower position size and enforce stricter drawdown-aware throttling.'
    });
  }

  return hints;
}
