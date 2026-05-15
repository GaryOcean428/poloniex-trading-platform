/**
 * Tests for the FAT reconciler side-aware-mismatch fix (2026-05-14).
 *
 * Background:
 *   Production incident 2026-05-14T03:24Z onward: 3 BTC LONG DB rows
 *   sat as phantoms for 50+ minutes after Poloniex netted them against
 *   an external SHORT. The legacy reconciler did a symbol-level diff —
 *   ``Set<string>`` of DB symbols vs ``Set<string>`` of exchange
 *   symbols — which evaluated "BTC in DB" ∧ "BTC on exchange" =
 *   match, NOT mismatched. So no UPDATE ran. Monkey's stale_bleed gate
 *   then spun every 30 s, firing close orders that came back with
 *   ``code=21002 Position not enough`` because the exchange's BTC was
 *   actually a SHORT, not the LONG the DB row was trying to close.
 *
 *   Root cause: symbol-only set difference. Fix: build a per-symbol
 *   ``Set<'long' | 'short'>`` from exchangePositions and require each
 *   DB row's ``(symbol, side)`` to be in that set; close the rows
 *   that aren't, by id (NOT by symbol — same-symbol opposite-side
 *   rows can coexist in HEDGE-mode lane isolation).
 *
 * Coverage:
 *   1. DB long, exchange long (ONE_WAY shape) — no UPDATE.
 *   2. DB long, exchange short (the 2026-05-14 failure shape) — UPDATE
 *      fires and closes the specific id with reason='reconciliation:
 *      side mismatch with exchange'.
 *   3. DB short, exchange long (mirror of #2) — same behavior.
 *   4. DB short, exchange long+short HEDGE-mode (both sides open) —
 *      no UPDATE: the short DB row matches the exchange's short side.
 *   5. DB row, exchange has no position on the symbol at all — UPDATE
 *      fires (legacy "symbol entirely missing" case still handled).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

/**
 * Stub pool.query with SQL-pattern matching. The FAT constructor's
 * loadConfigs() also calls pool.query, so a naive ``mockResolvedValueOnce``
 * gets consumed before reconcilePositions runs. Discriminating on the
 * SQL text lets us return the test's DB rows ONLY for the reconciler's
 * SELECT and ``{ rows: [] }`` for everything else (loadConfigs, the
 * logAgentEvent INSERT into agent_events, etc.).
 */
function stubReconcilerQueries(rows: Array<{ id: string; symbol: string; side: string }>) {
  vi.mocked(pool.query).mockReset();
  vi.mocked(pool.query).mockImplementation((async (sql: unknown) => {
    const sqlStr = typeof sql === 'string' ? sql : '';
    if (sqlStr.includes('SELECT id, symbol, side, order_id')) {
      return { rows } as never;
    }
    return { rows: [] } as never;
  }) as never);
}

/** Find the FIRST pool.query call whose SQL contains the given substring. */
function findCallContaining(substr: string): { args: unknown[] } | null {
  const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
  for (const c of calls) {
    const sql = typeof c[0] === 'string' ? c[0] : '';
    if (sql.includes(substr)) return { args: c as unknown[] };
  }
  return null;
}

beforeEach(() => {
  vi.mocked(apiCredentialsService.getCredentials).mockResolvedValue({
    apiKey: 'k', apiSecret: 's',
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FAT reconcilePositions — side-aware mismatch (#11011/phantom-row fix)', () => {
  // ────────────────────────────────────────────────────────────────────────
  // 1. ONE_WAY long match — no UPDATE fires.
  // ────────────────────────────────────────────────────────────────────────
  it('ONE_WAY long DB + long exchange (positive qty) → no UPDATE', async () => {
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([
      { symbol: 'BTC_USDT_PERP', qty: '0.027' },  // long: positive qty, no posSide
    ] as never);
    stubReconcilerQueries([
      { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', symbol: 'BTC_USDT_PERP', side: 'buy' },
    ]);
    const trader = new FullyAutonomousTrader();

    await priv(trader).reconcilePositions(USER);

    // The reconciler's SELECT fires; no UPDATE-autonomous-trades call.
    expect(findCallContaining('SELECT id, symbol, side, order_id')).not.toBeNull();
    expect(findCallContaining('UPDATE autonomous_trades')).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. The 2026-05-14 failure shape: DB long, exchange short — UPDATE fires.
  // ────────────────────────────────────────────────────────────────────────
  it('DB long + exchange SHORT (HEDGE posSide) → UPDATE closes the DB row by id', async () => {
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([
      { symbol: 'BTC_USDT_PERP', qty: '0.137', posSide: 'SHORT' },  // exchange has SHORT
    ] as never);
    stubReconcilerQueries([
      { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', symbol: 'BTC_USDT_PERP', side: 'buy' },
    ]);
    const trader = new FullyAutonomousTrader();

    await priv(trader).reconcilePositions(USER);

    const upd = findCallContaining('UPDATE autonomous_trades');
    expect(upd).not.toBeNull();
    const [updateSql, updateParams] = upd!.args as [string, unknown[]];
    expect(updateSql).toContain("status = 'closed'");
    expect(updateSql).toContain("exit_reason = 'reconciliation: side mismatch with exchange'");
    expect(updateSql).toContain('id = ANY($1::uuid[])');
    expect(updateParams[0]).toEqual(['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. Mirror: DB short + exchange long.
  // ────────────────────────────────────────────────────────────────────────
  it('DB short + exchange LONG (positive qty, no posSide) → UPDATE fires', async () => {
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([
      { symbol: 'ETH_USDT_PERP', qty: '0.1' },  // ONE_WAY long
    ] as never);
    stubReconcilerQueries([
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', symbol: 'ETH_USDT_PERP', side: 'sell' },
    ]);
    const trader = new FullyAutonomousTrader();

    await priv(trader).reconcilePositions(USER);

    const upd = findCallContaining('UPDATE autonomous_trades');
    expect(upd).not.toBeNull();
    const [, updateParams] = upd!.args as [string, unknown[]];
    expect(updateParams[0]).toEqual(['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. HEDGE both-sides open — same-symbol opposite-side rows coexist.
  // ────────────────────────────────────────────────────────────────────────
  it('HEDGE mode: DB short + exchange has both long AND short → no UPDATE for short row', async () => {
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([
      { symbol: 'BTC_USDT_PERP', qty: '0.01', posSide: 'LONG' },
      { symbol: 'BTC_USDT_PERP', qty: '0.02', posSide: 'SHORT' },
    ] as never);
    stubReconcilerQueries([
      { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', symbol: 'BTC_USDT_PERP', side: 'sell' },
    ]);
    const trader = new FullyAutonomousTrader();

    await priv(trader).reconcilePositions(USER);

    // DB short matches exchange short — no UPDATE.
    expect(findCallContaining('UPDATE autonomous_trades')).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────────────
  // 5. Symbol entirely missing on exchange — legacy case still covered.
  // ────────────────────────────────────────────────────────────────────────
  it('symbol entirely absent from exchange → UPDATE closes the orphan row', async () => {
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([] as never);
    stubReconcilerQueries([
      { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', symbol: 'ETH_USDT_PERP', side: 'buy' },
    ]);
    const trader = new FullyAutonomousTrader();

    await priv(trader).reconcilePositions(USER);

    const upd = findCallContaining('UPDATE autonomous_trades');
    expect(upd).not.toBeNull();
    const [, updateParams] = upd!.args as [string, unknown[]];
    expect(updateParams[0]).toEqual(['dddddddd-dddd-dddd-dddd-dddddddddddd']);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 6. Multi-row mismatch — only the side-mismatched ones get closed.
  // ────────────────────────────────────────────────────────────────────────
  it('multi-row: closes only the side-mismatched ids, leaves matching rows alone', async () => {
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([
      { symbol: 'BTC_USDT_PERP', qty: '0.137', posSide: 'SHORT' },  // exchange BTC short
      { symbol: 'ETH_USDT_PERP', qty: '0.1', posSide: 'LONG' },     // exchange ETH long
    ] as never);
    stubReconcilerQueries([
      // Phantom: DB BTC long but exchange BTC is short.
      { id: '11111111-1111-1111-1111-111111111111', symbol: 'BTC_USDT_PERP', side: 'buy' },
      // Real: DB ETH long matches exchange ETH long.
      { id: '22222222-2222-2222-2222-222222222222', symbol: 'ETH_USDT_PERP', side: 'buy' },
      // Phantom: DB BTC long #2 (same side as #1, both miss the short).
      { id: '33333333-3333-3333-3333-333333333333', symbol: 'BTC_USDT_PERP', side: 'buy' },
    ]);
    const trader = new FullyAutonomousTrader();

    await priv(trader).reconcilePositions(USER);

    const upd = findCallContaining('UPDATE autonomous_trades');
    expect(upd).not.toBeNull();
    const [, updateParams] = upd!.args as [string, unknown[]];
    // The two phantom BTC longs get closed; the real ETH long is left alone.
    expect(updateParams[0]).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '33333333-3333-3333-3333-333333333333',
    ]);
  });
});
