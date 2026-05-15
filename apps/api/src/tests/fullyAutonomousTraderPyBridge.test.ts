/**
 * Unit + integration tests for the TRADING_ENGINE_PY=true short-circuits
 * added to fullyAutonomousTrader.ts.
 *
 * Coverage:
 *   1. closePosition  → POST /trading/close-position
 *   2. recordTradeResult → POST /trading/record-result
 *   3. getCircuitBreakerStatus → GET /trading/circuit-breaker/{user_id}
 *   4. executeSignals DB-insert → POST /trading/insert-entry
 *
 * For each: flag off exercises TS path; flag on (mocked fetch) exercises
 * Python path with a mocked 200; flag on but Python returning 503 falls
 * through to TS path with a warning log.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock heavy dependencies ──────────────────────────────────────────────────
vi.mock('../db/connection.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) }
}));
vi.mock('../services/poloniexFuturesService.js', () => ({
  default: {
    getPositions: vi.fn(),
    closePosition: vi.fn().mockResolvedValue({}),
    normalizeSymbol: vi.fn((s: string) => s),
    getAccountBalance: vi.fn().mockResolvedValue({ eq: '10000' }),
  }
}));
vi.mock('../services/riskService.js', () => ({ default: {} }));
vi.mock('../services/mlPredictionService.js', () => ({ default: {} }));
vi.mock('../services/apiCredentialsService.js', () => ({
  apiCredentialsService: { getCredentials: vi.fn() }
}));
vi.mock('../utils/marketDataValidator.js', () => ({ validateMarketData: vi.fn() }));
vi.mock('../services/marketCatalog.js', () => ({ getPrecisions: vi.fn() }));
vi.mock('../services/monitoringService.js', () => ({
  monitoringService: { recordPipelineHeartbeat: vi.fn(), recordTradeEvent: vi.fn() }
}));
vi.mock('../utils/engineVersion.js', () => ({ getEngineVersion: () => 'v-test' }));
vi.mock('../services/backtestingEngine.js', () => ({ default: {} }));
vi.mock('../services/simpleMlService.js', () => ({ default: {} }));
vi.mock('../services/monkey/kernel_client.js', () => ({
  callExitDecide: vi.fn(),
  callReconcile: vi.fn(),
  isExitShadowEnabled: vi.fn(() => false),
  logExitParityDiff: vi.fn(),
  logReconcileParityDiff: vi.fn(),
}));
vi.mock('../services/signalGenome.js', () => ({
  buildIndicatorMap: vi.fn(() => new Map()),
  evaluateGenomeEntry: vi.fn(() => ({ action: 'HOLD', score: 0 })),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { FullyAutonomousTrader } from '../services/fullyAutonomousTrader.js';
import { pool } from '../db/connection.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';

/** Access private members for testing */
function priv(t: FullyAutonomousTrader) {
  return t as any;
}

const USER = 'test-user-py';
const ML_WORKER = 'http://ml-worker:8000';

// ── helpers ──────────────────────────────────────────────────────────────────

function mockFetchOk(body: Record<string, unknown>) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

function mockFetch503() {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 503,
    text: () => Promise.resolve('{"error":"TRADING_ENGINE_PY=false"}'),
  });
}

/** Simulate a network-level failure where fetch rejects (DNS, connection, etc.) */
function mockFetchNetworkError() {
  fetchMock.mockRejectedValueOnce(new Error('ENETUNREACH ml-worker:8000'));
}

/** Simulate the AbortController firing on timeout — fetch rejects with AbortError. */
function mockFetchAbort() {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  fetchMock.mockRejectedValueOnce(err);
}

// ── Test suites ──────────────────────────────────────────────────────────────

describe('FullyAutonomousTrader Python bridge – closePosition', () => {
  let trader: FullyAutonomousTrader;

  beforeEach(() => {
    trader = new FullyAutonomousTrader();
    fetchMock.mockReset();
    vi.mocked(pool.query).mockReset();
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any);
    // Set up a mock open position
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([
      { symbol: 'BTC_USDT_PERP', qty: '1', markPx: '50000', openAvgPx: '49000', unrealPnl: '1000' }
    ] as any);
    vi.mocked(apiCredentialsService.getCredentials).mockResolvedValue({ apiKey: 'k', secret: 's' } as any);
  });

  afterEach(() => {
    delete process.env.TRADING_ENGINE_PY;
    delete process.env.ML_WORKER_URL;
  });

  it('flag off → TS path: pool.query UPDATE is called', async () => {
    delete process.env.TRADING_ENGINE_PY;
    await priv(trader).closePosition(USER, 'BTC_USDT_PERP', 'stop_loss');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE autonomous_trades'), expect.any(Array));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flag on → Python path: POST /trading/close-position called, pool.query skipped', async () => {
    process.env.TRADING_ENGINE_PY = 'true';
    process.env.ML_WORKER_URL = ML_WORKER;
    mockFetchOk({ rows_updated: 1, outcome_published: true });

    await priv(trader).closePosition(USER, 'BTC_USDT_PERP', 'take_profit');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${ML_WORKER}/trading/close-position`);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.user_id).toBe(USER);
    expect(body.symbol).toBe('BTC_USDT_PERP');
    expect(body.exit_reason).toBe('take_profit');
    // pool.query should NOT have been called (short-circuit)
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE autonomous_trades'), expect.any(Array));
  });

  it('flag on but Python returns 503 → falls through to TS path', async () => {
    process.env.TRADING_ENGINE_PY = 'true';
    process.env.ML_WORKER_URL = ML_WORKER;
    mockFetch503();

    await priv(trader).closePosition(USER, 'BTC_USDT_PERP', 'stop_loss');

    // Python was tried
    expect(fetchMock).toHaveBeenCalledOnce();
    // TS fallback: pool.query UPDATE was called
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE autonomous_trades'), expect.any(Array));
  });

  it('flag on but Python fetch rejects (network error) → falls through to TS path without throwing', async () => {
    process.env.TRADING_ENGINE_PY = 'true';
    process.env.ML_WORKER_URL = ML_WORKER;
    mockFetchNetworkError();

    await expect(
      priv(trader).closePosition(USER, 'BTC_USDT_PERP', 'stop_loss'),
    ).resolves.not.toThrow();

    expect(fetchMock).toHaveBeenCalledOnce();
    // TS fallback executed despite the rejected fetch
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE autonomous_trades'), expect.any(Array));
  });

  it('flag on but Python fetch aborts (timeout) → falls through to TS path', async () => {
    process.env.TRADING_ENGINE_PY = 'true';
    process.env.ML_WORKER_URL = ML_WORKER;
    mockFetchAbort();

    await expect(
      priv(trader).closePosition(USER, 'BTC_USDT_PERP', 'stop_loss'),
    ).resolves.not.toThrow();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE autonomous_trades'), expect.any(Array));
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('FullyAutonomousTrader Python bridge – recordTradeResult', () => {
  let trader: FullyAutonomousTrader;

  beforeEach(() => {
    trader = new FullyAutonomousTrader();
    fetchMock.mockReset();
  });

  afterEach(() => {
    delete process.env.TRADING_ENGINE_PY;
    delete process.env.ML_WORKER_URL;
  });

  it('flag off → TS path: in-memory CB state is updated', async () => {
    delete process.env.TRADING_ENGINE_PY;
    await priv(trader).recordTradeResult(USER, -500, 10000);
    const cb = priv(trader).getCircuitBreaker(USER);
    expect(cb.consecutiveLosses).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flag on → Python path: POST /trading/record-result called', async () => {
    process.env.TRADING_ENGINE_PY = 'true';
    process.env.ML_WORKER_URL = ML_WORKER;
    mockFetchOk({ is_tripped: false, consecutive_losses: 1, daily_loss: 50, tripped_reason: null });

    await priv(trader).recordTradeResult(USER, -50, 10000);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${ML_WORKER}/trading/record-result`);
    const body = JSON.parse(opts.body);
    expect(body.user_id).toBe(USER);
    expect(body.pnl).toBe(-50);
    expect(body.capital_base).toBe(10000);
    // TS in-memory CB state should NOT be updated (early return)
    const cb = priv(trader).getCircuitBreaker(USER);
    expect(cb.consecutiveLosses).toBe(0);
  });

  it('flag on but Python returns 503 → falls through to TS path', async () => {
    process.env.TRADING_ENGINE_PY = 'true';
    process.env.ML_WORKER_URL = ML_WORKER;
    mockFetch503();

    await priv(trader).recordTradeResult(USER, -50, 10000);

    expect(fetchMock).toHaveBeenCalledOnce();
    // TS fallback: in-memory CB state updated
    const cb = priv(trader).getCircuitBreaker(USER);
    expect(cb.consecutiveLosses).toBe(1);
  });

  it('flag on but Python fetch rejects (network error) → TS in-memory CB still updated', async () => {
    process.env.TRADING_ENGINE_PY = 'true';
    process.env.ML_WORKER_URL = ML_WORKER;
    mockFetchNetworkError();

    await expect(priv(trader).recordTradeResult(USER, -50, 10000)).resolves.not.toThrow();

    expect(fetchMock).toHaveBeenCalledOnce();
    // TS fallback: in-memory CB state updated despite the rejected fetch
    const cb = priv(trader).getCircuitBreaker(USER);
    expect(cb.consecutiveLosses).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('FullyAutonomousTrader Python bridge – getCircuitBreakerStatus', () => {
  let trader: FullyAutonomousTrader;

  beforeEach(() => {
    trader = new FullyAutonomousTrader();
    fetchMock.mockReset();
  });

  afterEach(() => {
    delete process.env.TRADING_ENGINE_PY;
    delete process.env.ML_WORKER_URL;
  });

  it('flag off → TS path: returns TS in-memory CB state', async () => {
    delete process.env.TRADING_ENGINE_PY;
    const status = await trader.getCircuitBreakerStatus(USER);
    expect(status.isTripped).toBe(false);
    expect(status.consecutiveLosses).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flag on → Python path: GET /trading/circuit-breaker/{user_id} called', async () => {
    process.env.TRADING_ENGINE_PY = 'true';
    process.env.ML_WORKER_URL = ML_WORKER;
    mockFetchOk({
      user_id: USER,
      is_tripped: true,
      consecutive_losses: 3,
      daily_loss: 150,
      tripped_reason: '3 consecutive losses',
      tripped_at_ms: Date.now() - 10000,
    });

    const status = await trader.getCircuitBreakerStatus(USER);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${ML_WORKER}/trading/circuit-breaker/${USER}`);
    expect(opts.method).toBe('GET');
    expect(status.isTripped).toBe(true);
    expect(status.consecutiveLosses).toBe(3);
    expect(status.reason).toBe('3 consecutive losses');
    expect(status.cooldownRemaining).toBeGreaterThan(0);
  });

  it('flag on but Python returns 503 → falls through to TS path', async () => {
    process.env.TRADING_ENGINE_PY = 'true';
    process.env.ML_WORKER_URL = ML_WORKER;
    mockFetch503();

    const status = await trader.getCircuitBreakerStatus(USER);

    expect(fetchMock).toHaveBeenCalledOnce();
    // TS fallback: returns TS in-memory state
    expect(status.isTripped).toBe(false);
    expect(status.consecutiveLosses).toBe(0);
  });

  it('flag on but Python fetch aborts (timeout) → returns TS in-memory state without throwing', async () => {
    process.env.TRADING_ENGINE_PY = 'true';
    process.env.ML_WORKER_URL = ML_WORKER;
    mockFetchAbort();

    const status = await trader.getCircuitBreakerStatus(USER);

    expect(fetchMock).toHaveBeenCalledOnce();
    // TS fallback: returns TS in-memory state, error did not bubble
    expect(status.isTripped).toBe(false);
    expect(status.consecutiveLosses).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('FullyAutonomousTrader Python bridge – executeSignals DB insert', () => {
  let trader: FullyAutonomousTrader;

  const SIGNAL = {
    symbol: 'ETH_USDT_PERP',
    action: 'BUY' as const,
    side: 'long' as const,
    confidence: 80,
    entryPrice: 3000,
    stopLoss: 2940,
    takeProfit: 3120,
    positionSize: 300,
    leverage: 3,
    reason: 'test-signal',
    indicators: {},
  };

  beforeEach(() => {
    trader = new FullyAutonomousTrader();
    fetchMock.mockReset();
    vi.mocked(pool.query).mockReset();
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ count: '0' }] } as any);
    // Set config so the trader knows about this user
    priv(trader).configs.set(USER, {
      userId: USER,
      initialCapital: 10000,
      maxRiskPerTrade: 2,
      maxDrawdown: 10,
      targetDailyReturn: 1,
      symbols: ['ETH_USDT_PERP'],
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
  });

  afterEach(() => {
    delete process.env.TRADING_ENGINE_PY;
    delete process.env.ML_WORKER_URL;
  });

  it('flag off → TS path: pool.query INSERT is called', async () => {
    delete process.env.TRADING_ENGINE_PY;
    await priv(trader).executeSignals(USER, [SIGNAL]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO autonomous_trades'),
      expect.any(Array)
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/trading/insert-entry'),
      expect.any(Object)
    );
  });

  it('flag on → Python path: POST /trading/insert-entry called, pool.query INSERT skipped', async () => {
    process.env.TRADING_ENGINE_PY = 'true';
    process.env.ML_WORKER_URL = ML_WORKER;
    // Mock for insert-entry
    mockFetchOk({ id: 'uuid-1234' });

    await priv(trader).executeSignals(USER, [SIGNAL]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${ML_WORKER}/trading/insert-entry`);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.user_id).toBe(USER);
    expect(body.symbol).toBe('ETH_USDT_PERP');
    expect(body.side).toBe('long');
    expect(body.leverage).toBe(3);
    expect(body.paper_trade).toBe(true);
    // pool.query INSERT should NOT have been called
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO autonomous_trades'),
      expect.any(Array)
    );
  });

  it('flag on but Python returns 503 → falls through to TS path', async () => {
    process.env.TRADING_ENGINE_PY = 'true';
    process.env.ML_WORKER_URL = ML_WORKER;
    mockFetch503();

    await priv(trader).executeSignals(USER, [SIGNAL]);

    // Python was tried
    expect(fetchMock).toHaveBeenCalledOnce();
    // TS fallback: pool.query INSERT was called
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO autonomous_trades'),
      expect.any(Array)
    );
  });
});
