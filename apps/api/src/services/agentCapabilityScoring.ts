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

export function calculateCompositeCapabilityScore(input: CapabilityPerformanceInput): number {
  const normalizedWinRate = Math.min(Math.max(input.winRate, 0), 1);
  const normalizedProfitFactor = Math.min(Math.max(input.profitFactor, 0), 2.5) / 2.5;
  const normalizedSharpe = Math.min(Math.max(input.sharpeRatio || 0, 0), 2) / 2;
  const normalizedDrawdown = Math.max(0, 1 - Math.min(Math.max(input.maxDrawdown || 0, 0), 0.3) / 0.3);

  // Weighted blend inspired by PowerTrader-style reliability + risk discipline
  const score =
    normalizedWinRate * 35 +
    normalizedProfitFactor * 25 +
    normalizedDrawdown * 25 +
    normalizedSharpe * 15;

  return Math.round(Math.min(100, Math.max(0, score)));
}

export function getStrategyCapabilityClass(score: number): CapabilityClass {
  if (score >= 75) return 'tier1';
  if (score >= 50) return 'tier2';
  return 'tier3';
}

export function generateCapabilityHints(input: CapabilityPerformanceInput): CapabilityHint[] {
  const hints: CapabilityHint[] = [];

  if (input.winRate < 0.55) {
    hints.push({
      metric: 'winRate',
      current: input.winRate,
      target: 0.55,
      gap: parseFloat((0.55 - input.winRate).toFixed(4)),
      priority: input.winRate < 0.45 ? 'high' : 'medium',
      recommendation: 'Tighten entry filters and reduce low-conviction setups.'
    });
  }

  if (input.profitFactor < 1.5) {
    hints.push({
      metric: 'profitFactor',
      current: input.profitFactor,
      target: 1.5,
      gap: parseFloat((1.5 - input.profitFactor).toFixed(4)),
      priority: input.profitFactor < 1.2 ? 'high' : 'medium',
      recommendation: 'Improve reward-to-risk ratio with tighter stops and stronger take-profit rules.'
    });
  }

  const maxDrawdown = input.maxDrawdown || 0;
  if (maxDrawdown > 0.15) {
    hints.push({
      metric: 'maxDrawdown',
      current: maxDrawdown,
      target: 0.15,
      gap: parseFloat((maxDrawdown - 0.15).toFixed(4)),
      priority: maxDrawdown > 0.22 ? 'high' : 'medium',
      recommendation: 'Lower position size and enforce stricter drawdown-aware throttling.'
    });
  }

  return hints;
}
