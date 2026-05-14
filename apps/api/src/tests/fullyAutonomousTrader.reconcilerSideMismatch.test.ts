/**
 * Tests for FAT reconcilePositions — DISABLED 2026-05-15 (now a no-op).
 *
 * Background: FAT used to run its OWN position reconciler. It was a
 * SECOND reconciler racing `stateReconciliationService` over the same
 * `autonomous_trades` rows, and it was a churn AMPLIFIER, not a safety
 * net:
 *   - side-PRESENCE only, not quantity-aware — no FIFO/aggregate-qty
 *     matching, so on the HEDGE account (two kernels legitimately
 *     holding opposite legs) any transient DB/exchange skew flagged
 *     good rows as "side mismatch".
 *   - it closed those rows with NULL `pnl` (no Poloniex
 *     position-history recovery) → ~94% of closes became NULL-pnl
 *     ledger holes that hid real losses.
 * `stateReconciliationService` is now the SOLE reconciler: quantity-
 * aware (FIFO aggregate matching) and it recovers realized pnl from
 * Poloniex position-history. FAT's `reconcilePositions` is kept as a
 * no-op so the Step-0 call site stays valid.
 *
 * These tests pin the no-op contract: reconcilePositions must NOT read
 * exchange positions and must NOT touch `autonomous_trades` (no SELECT
 * of open rows, no UPDATE). If FAT's reconciler is ever re-enabled,
 * these fail loudly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/connection.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) }
}));
vi.mock('../services/poloniexFuturesService.js', () => ({
  default: {
    getPositions: vi.fn().mockResolvedValue([]),
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

import { FullyAutonomousTrader } from '../services/fullyAutonomousTrader.js';
import { pool } from '../db/connection.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';

function priv(t: FullyAutonomousTrader) {
  return t as unknown as {
    reconcilePositions: (userId: string) => Promise<void>;
  };
}

const USER = 'test-user-reconcile';

/** True if any pool.query call's SQL contains the substring. */
function anyQueryContains(substr: string): boolean {
  const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
  return calls.some((c) => typeof c[0] === 'string' && (c[0] as string).includes(substr));
}

beforeEach(() => {
  vi.mocked(apiCredentialsService.getCredentials).mockResolvedValue({
    apiKey: 'k', apiSecret: 's',
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FAT reconcilePositions — disabled (no-op; stateReconciliationService is the sole reconciler)', () => {
  it('does NOT read exchange positions', async () => {
    const trader = new FullyAutonomousTrader();
    vi.mocked(poloniexFuturesService.getPositions).mockClear();

    await priv(trader).reconcilePositions(USER);

    expect(poloniexFuturesService.getPositions).not.toHaveBeenCalled();
  });

  it('does NOT SELECT open rows and does NOT UPDATE autonomous_trades', async () => {
    const trader = new FullyAutonomousTrader();
    vi.mocked(pool.query).mockClear();

    await priv(trader).reconcilePositions(USER);

    // The legacy reconciler ran `SELECT id, symbol, side, order_id ...`
    // then `UPDATE autonomous_trades ... 'reconciliation: side mismatch'`.
    // The no-op must do neither.
    expect(anyQueryContains('SELECT id, symbol, side, order_id')).toBe(false);
    expect(anyQueryContains('UPDATE autonomous_trades')).toBe(false);
  });

  it('resolves cleanly (no throw) — it is an unconditional no-op', async () => {
    const trader = new FullyAutonomousTrader();
    await expect(priv(trader).reconcilePositions(USER)).resolves.toBeUndefined();
  });
});
