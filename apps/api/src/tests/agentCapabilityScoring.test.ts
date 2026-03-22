import { describe, it, expect } from 'vitest';
import {
  calculateCompositeCapabilityScore,
  generateCapabilityHints,
  getStrategyCapabilityClass
} from '../services/agentCapabilityScoring.js';

describe('agentCapabilityScoring', () => {
  it('assigns tier1 for strong strategy metrics', () => {
    const score = calculateCompositeCapabilityScore({
      winRate: 0.74,
      profitFactor: 2.3,
      totalTrades: 120,
      totalReturn: 0.48,
      sharpeRatio: 1.9,
      maxDrawdown: 0.05
    });
    expect(score).toBeGreaterThanOrEqual(75);
    expect(getStrategyCapabilityClass(score)).toBe('tier1');
  });

  it('assigns tier3 and emits hints for weak strategy metrics', () => {
    const score = calculateCompositeCapabilityScore({
      winRate: 0.42,
      profitFactor: 0.95,
      totalTrades: 40,
      totalReturn: -0.1,
      sharpeRatio: 0.1,
      maxDrawdown: 0.28
    });
    expect(score).toBeLessThan(50);
    expect(getStrategyCapabilityClass(score)).toBe('tier3');

    const hints = generateCapabilityHints({
      winRate: 0.42,
      profitFactor: 0.95,
      totalTrades: 40,
      totalReturn: -0.1,
      sharpeRatio: 0.1,
      maxDrawdown: 0.28
    });
    expect(hints.map(h => h.metric)).toEqual(expect.arrayContaining(['winRate', 'profitFactor', 'maxDrawdown']));
  });
});
