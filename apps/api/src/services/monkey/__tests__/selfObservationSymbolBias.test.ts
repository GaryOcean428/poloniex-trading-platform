import { describe, it, expect } from 'vitest';
import { computeSymbolSideBias, type SymbolSideStats } from '../self_observation.js';

const emptyStat = (symbol: string, side: 'long' | 'short'): SymbolSideStats => ({
  symbol,
  side,
  trades: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  totalPnl: 0,
  avgPnl: 0,
});

describe('computeSymbolSideBias', () => {
  it('returns neutral (1.0) when no symbols have evidence', () => {
    const bias = computeSymbolSideBias({});
    expect(bias).toEqual({});
  });

  it('stays neutral when sample is too small for Wilson CI to exclude 0.5', () => {
    // 2/3 wins on ETH long: classic small-sample case — CI ~[0.21, 0.94].
    const ethLong: SymbolSideStats = {
      ...emptyStat('ETH_USDT_PERP', 'long'),
      trades: 3,
      wins: 2,
      losses: 1,
      winRate: 2 / 3,
    };
    const bias = computeSymbolSideBias({
      ETH_USDT_PERP: { long: ethLong, short: emptyStat('ETH_USDT_PERP', 'short') },
    });
    expect(bias.ETH_USDT_PERP.long).toBe(1.0);
    expect(bias.ETH_USDT_PERP.short).toBe(1.0);
  });

  it('deflects bias upward (harder entry) for losing symbol-side with firm evidence', () => {
    // ETH long: 30/100 (30% WR), CI ~[0.22, 0.40] — entirely below 0.5.
    const ethLong: SymbolSideStats = {
      ...emptyStat('ETH_USDT_PERP', 'long'),
      trades: 100,
      wins: 30,
      losses: 70,
      winRate: 0.30,
    };
    const bias = computeSymbolSideBias({
      ETH_USDT_PERP: { long: ethLong, short: emptyStat('ETH_USDT_PERP', 'short') },
    });
    // winRateToBias(0.30) = 1 - (0.30-0.5)*2*0.30 = 1.12
    expect(bias.ETH_USDT_PERP.long).toBeGreaterThan(1.0);
    expect(bias.ETH_USDT_PERP.long).toBeCloseTo(1.12, 2);
    // Short bucket stays neutral (no data).
    expect(bias.ETH_USDT_PERP.short).toBe(1.0);
  });

  it('deflects bias downward (easier entry) for winning symbol-side with firm evidence', () => {
    // BTC long: 70/100 (70% WR), CI ~[0.60, 0.78] — entirely above 0.5.
    const btcLong: SymbolSideStats = {
      ...emptyStat('BTC_USDT_PERP', 'long'),
      trades: 100,
      wins: 70,
      losses: 30,
      winRate: 0.70,
    };
    const bias = computeSymbolSideBias({
      BTC_USDT_PERP: { long: btcLong, short: emptyStat('BTC_USDT_PERP', 'short') },
    });
    // winRateToBias(0.70) = 1 - (0.70-0.5)*2*0.30 = 0.88
    expect(bias.BTC_USDT_PERP.long).toBeLessThan(1.0);
    expect(bias.BTC_USDT_PERP.long).toBeCloseTo(0.88, 2);
  });

  it('applies independent biases per symbol — ETH long penalty does NOT bleed into BTC long', () => {
    const ethLong: SymbolSideStats = {
      ...emptyStat('ETH_USDT_PERP', 'long'),
      trades: 100,
      wins: 30,
      losses: 70,
      winRate: 0.30,
    };
    const btcLong: SymbolSideStats = {
      ...emptyStat('BTC_USDT_PERP', 'long'),
      trades: 100,
      wins: 70,
      losses: 30,
      winRate: 0.70,
    };
    const bias = computeSymbolSideBias({
      ETH_USDT_PERP: { long: ethLong, short: emptyStat('ETH_USDT_PERP', 'short') },
      BTC_USDT_PERP: { long: btcLong, short: emptyStat('BTC_USDT_PERP', 'short') },
    });
    expect(bias.ETH_USDT_PERP.long).toBeGreaterThan(1.0);
    expect(bias.BTC_USDT_PERP.long).toBeLessThan(1.0);
  });

  it('respects the MAX_BIAS_SWING bound (≤0.30) — extreme WR caps at [0.70, 1.30]', () => {
    // 99/100 win-rate is firmer than firm; raw bias would be 1 - 0.49*2*0.30 = 0.706
    const ethShort: SymbolSideStats = {
      ...emptyStat('ETH_USDT_PERP', 'short'),
      trades: 100,
      wins: 99,
      losses: 1,
      winRate: 0.99,
    };
    const bias = computeSymbolSideBias({
      ETH_USDT_PERP: { long: emptyStat('ETH_USDT_PERP', 'long'), short: ethShort },
    });
    expect(bias.ETH_USDT_PERP.short).toBeGreaterThanOrEqual(0.70);
    expect(bias.ETH_USDT_PERP.short).toBeLessThanOrEqual(1.30);
  });
});
