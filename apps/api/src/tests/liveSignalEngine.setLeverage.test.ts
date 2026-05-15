/**
 * Tests for LiveSignalEngine.submitOrder HEDGE-mode posSide plumbing.
 *
 * Background (PR #611 HEDGE flip + post-deploy 11011 errors):
 *   /v3/position/leverage on a HEDGE account requires `posSide: LONG|SHORT`
 *   in the body. Without it Poloniex returns code=11011 and leverage stays
 *   at the exchange default. The Monkey kernel already plumbs this through
 *   (loop.ts:2126-2154); this engine was the missing call site.
 *
 * Coverage:
 *   1. HEDGE + long entry → setLeverage receives `{ posSide: 'LONG' }`.
 *   2. HEDGE + short entry → setLeverage receives `{ posSide: 'SHORT' }`.
 *   3. ONE_WAY entry → setLeverage receives `{}` (posSide omitted, exchange
 *      defaults to BOTH which is correct for one-way accounts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock heavy dependencies ──────────────────────────────────────────────────
vi.mock('../db/connection.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) }
}));
vi.mock('../services/poloniexFuturesService.js', () => ({
  default: {
    setLeverage: vi.fn().mockResolvedValue({}),
    placeOrder: vi.fn().mockResolvedValue({ ordId: 'mock-order-id' }),
    getPositionDirectionMode: vi.fn(),
    getPositions: vi.fn().mockResolvedValue([]),
    getAccountBalance: vi.fn().mockResolvedValue({ totalBalance: '1000', availableBalance: '900' }),
  }
}));
vi.mock('../services/apiCredentialsService.js', () => ({
  apiCredentialsService: { getCredentials: vi.fn() }
}));
vi.mock('../services/marketCatalog.js', () => ({
  getPrecisions: vi.fn().mockResolvedValue({ lotSize: 0.001 }),
  getMaxLeverage: vi.fn().mockResolvedValue(100),
}));
vi.mock('../services/mlPredictionService.js', () => ({ default: {} }));
vi.mock('../services/monitoringService.js', () => ({
  monitoringService: { recordPipelineHeartbeat: vi.fn(), recordTradeEvent: vi.fn() }
}));
vi.mock('../services/thompsonBandit.js', () => ({
  bucketOfLeverage: vi.fn(() => 'low'),
  sampleBeta: vi.fn(() => 0.5),
}));
vi.mock('../services/monkey/loop.js', () => ({
  allMonkeyKernels: () => [],
  getFreshestMonkeyBasinSnapshot: vi.fn(),
}));
vi.mock('../services/monkey/kernel_client.js', () => ({
  callLiveDecide: vi.fn(),
  isLiveSignalShadowEnabled: vi.fn(() => false),
}));
vi.mock('../services/executionModeService.js', () => ({
  getCurrentExecutionMode: vi.fn(() => 'auto'),
}));
vi.mock('../services/riskKernel.js', () => ({
  evaluatePreTradeVetoes: vi.fn(),
}));
vi.mock('../utils/engineVersion.js', () => ({ getEngineVersion: () => 'v-test' }));

import { LiveSignalEngine } from '../services/liveSignalEngine.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';

/** Access private members for testing. */
function priv(e: LiveSignalEngine) {
  return e as unknown as {
    submitOrder: (
      order: { symbol: string; side: 'long' | 'short'; notional: number; leverage: number; price: number },
      signal: Record<string, unknown>,
      atr: number,
      userId: string,
      credentials: { apiKey: string; apiSecret: string; passphrase?: string },
    ) => Promise<void>;
    positionDirectionMode: 'HEDGE' | 'ONE_WAY' | undefined;
  };
}

const CREDS = { apiKey: 'k', apiSecret: 's' };
const SIGNAL = {
  symbol: 'BTC_USDT_PERP',
  signal: 'BUY' as const,
  strength: 0.5,
  reason: 'test',
  timestamp: Date.now(),
  signalKey: 'k',
  regime: 'trending',
  leverageBucket: 'low' as const,
};

describe('LiveSignalEngine.submitOrder — HEDGE-mode setLeverage posSide', () => {
  let engine: LiveSignalEngine;

  beforeEach(() => {
    engine = new LiveSignalEngine();
    vi.mocked(poloniexFuturesService.setLeverage).mockClear();
    vi.mocked(poloniexFuturesService.placeOrder).mockClear().mockResolvedValue({ ordId: 'mock-order-id' } as never);
    vi.mocked(poloniexFuturesService.getPositionDirectionMode).mockReset();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. HEDGE + long → posSide=LONG.
  // ──────────────────────────────────────────────────────────────────────────
  it('HEDGE + long order → setLeverage called with posSide=LONG', async () => {
    vi.mocked(poloniexFuturesService.getPositionDirectionMode).mockResolvedValue({ posMode: 'HEDGE' } as never);

    const order = { symbol: 'BTC_USDT_PERP', side: 'long' as const, notional: 50, leverage: 10, price: 50000 };
    await priv(engine).submitOrder(order, SIGNAL, 100, 'user-1', CREDS);

    expect(poloniexFuturesService.setLeverage).toHaveBeenCalledTimes(1);
    const [, , , opts] = vi.mocked(poloniexFuturesService.setLeverage).mock.calls[0];
    expect(opts).toEqual({ posSide: 'LONG' });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. HEDGE + short → posSide=SHORT.
  // ──────────────────────────────────────────────────────────────────────────
  it('HEDGE + short order → setLeverage called with posSide=SHORT', async () => {
    vi.mocked(poloniexFuturesService.getPositionDirectionMode).mockResolvedValue({ posMode: 'HEDGE' } as never);

    const order = { symbol: 'ETH_USDT_PERP', side: 'short' as const, notional: 50, leverage: 20, price: 2250 };
    await priv(engine).submitOrder(order, SIGNAL, 100, 'user-1', CREDS);

    expect(poloniexFuturesService.setLeverage).toHaveBeenCalledTimes(1);
    const [, , , opts] = vi.mocked(poloniexFuturesService.setLeverage).mock.calls[0];
    expect(opts).toEqual({ posSide: 'SHORT' });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. ONE_WAY → posSide omitted (exchange defaults to BOTH).
  // ──────────────────────────────────────────────────────────────────────────
  it('ONE_WAY mode → setLeverage called with empty opts (posSide omitted)', async () => {
    vi.mocked(poloniexFuturesService.getPositionDirectionMode).mockResolvedValue({ posMode: 'ONE_WAY' } as never);

    const order = { symbol: 'BTC_USDT_PERP', side: 'long' as const, notional: 50, leverage: 10, price: 50000 };
    await priv(engine).submitOrder(order, SIGNAL, 100, 'user-1', CREDS);

    expect(poloniexFuturesService.setLeverage).toHaveBeenCalledTimes(1);
    const [, , , opts] = vi.mocked(poloniexFuturesService.setLeverage).mock.calls[0];
    expect(opts).toEqual({});
    expect(opts).not.toHaveProperty('posSide');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bonus: detection runs once and is cached across submitOrder calls.
  // ──────────────────────────────────────────────────────────────────────────
  it('caches positionDirectionMode after first detection', async () => {
    vi.mocked(poloniexFuturesService.getPositionDirectionMode).mockResolvedValue({ posMode: 'HEDGE' } as never);

    const order1 = { symbol: 'BTC_USDT_PERP', side: 'long' as const, notional: 50, leverage: 10, price: 50000 };
    const order2 = { symbol: 'ETH_USDT_PERP', side: 'short' as const, notional: 50, leverage: 5, price: 2250 };
    await priv(engine).submitOrder(order1, SIGNAL, 100, 'user-1', CREDS);
    await priv(engine).submitOrder(order2, SIGNAL, 100, 'user-1', CREDS);

    // Mode probe should have been called once across both submitOrder calls.
    expect(poloniexFuturesService.getPositionDirectionMode).toHaveBeenCalledTimes(1);
    expect(priv(engine).positionDirectionMode).toBe('HEDGE');
  });
});
