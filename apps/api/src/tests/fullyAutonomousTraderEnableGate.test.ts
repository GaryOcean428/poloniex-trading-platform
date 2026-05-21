/**
 * Unit tests for the FAT master kill-switch (FAT_ENABLE).
 *
 * FAT is disabled by default. Its loop auto-restores on module construction
 * via loadActiveConfigs(), so startTrading() owns the env gate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock heavy dependencies so the class constructor doesn't touch the DB ──
vi.mock('../db/connection.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] })
  }
}));

vi.mock('../services/poloniexFuturesService.js', () => ({ default: {} }));
vi.mock('../services/riskService.js', () => ({ default: {} }));
vi.mock('../services/mlPredictionService.js', () => ({ default: {} }));
vi.mock('../services/apiCredentialsService.js', () => ({ apiCredentialsService: {} }));
vi.mock('../utils/marketDataValidator.js', () => ({ validateMarketData: vi.fn() }));
vi.mock('../services/marketCatalog.js', () => ({ getPrecisions: vi.fn() }));

import { FullyAutonomousTrader } from '../services/fullyAutonomousTrader.js';

/** Convenience alias to call private methods without TypeScript errors. */
function priv(trader: FullyAutonomousTrader) {
  return trader as any;
}

const USER = 'test-user-fat-gate';

/** Minimal config that satisfies the `!config || !config.enabled` guard. */
function seedConfig(trader: FullyAutonomousTrader): void {
  priv(trader).configs.set(USER, {
    userId: USER,
    initialCapital: 1000,
    maxRiskPerTrade: 2,
    maxDrawdown: 10,
    targetDailyReturn: 1,
    symbols: ['BTC_USDT_PERP'],
    enabled: true,
    paperTrading: true,
    stopLossPercent: 2,
    takeProfitPercent: 4,
    leverage: 3,
    maxConcurrentPositions: 3,
    tradingCycleSeconds: 60,
    confidenceThreshold: 65,
    signalScoreThreshold: 30,
  });
}

describe('FullyAutonomousTrader – FAT_ENABLE kill-switch', () => {
  let trader: FullyAutonomousTrader;
  const savedEnv = process.env.FAT_ENABLE;

  beforeEach(() => {
    trader = new FullyAutonomousTrader();
    seedConfig(trader);
    // Stub the heavy fire-and-forget calls startTrading() makes when enabled.
    vi.spyOn(priv(trader), 'tradingCycle').mockResolvedValue(undefined);
    vi.spyOn(priv(trader), 'bootstrapMlModels').mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Tear down any interval the enabled-path test armed.
    const interval = priv(trader).runningIntervals.get(USER);
    if (interval) clearInterval(interval);
    if (savedEnv === undefined) delete process.env.FAT_ENABLE;
    else process.env.FAT_ENABLE = savedEnv;
    vi.restoreAllMocks();
  });

  it('does NOT arm a trading interval when FAT_ENABLE is unset', async () => {
    delete process.env.FAT_ENABLE;
    await priv(trader).startTrading(USER);
    expect(priv(trader).runningIntervals.has(USER)).toBe(false);
    expect(priv(trader).tradingCycle).not.toHaveBeenCalled();
    expect(priv(trader).bootstrapMlModels).not.toHaveBeenCalled();
  });

  it('does NOT arm a trading interval when FAT_ENABLE is "false"', async () => {
    process.env.FAT_ENABLE = 'false';
    await priv(trader).startTrading(USER);
    expect(priv(trader).runningIntervals.has(USER)).toBe(false);
    expect(priv(trader).tradingCycle).not.toHaveBeenCalled();
    expect(priv(trader).bootstrapMlModels).not.toHaveBeenCalled();
  });

  it('treats FAT_ENABLE case and whitespace insensitively', async () => {
    process.env.FAT_ENABLE = ' TRUE ';
    await priv(trader).startTrading(USER);
    expect(priv(trader).runningIntervals.has(USER)).toBe(true);
  });

  it('arms the trading interval when FAT_ENABLE is "true"', async () => {
    process.env.FAT_ENABLE = 'true';
    await priv(trader).startTrading(USER);
    expect(priv(trader).runningIntervals.has(USER)).toBe(true);
  });
});
