/**
 * resonance_bank.test.ts — orderId-level deduplication tests
 *
 * Verifies that:
 *   1. Calling writeBubble twice with the same orderId results in exactly
 *      one bank entry. Second call returns null (no-op).
 *   2. When both Position and Swing kernels witness the same exit,
 *      exactly one write (and thus one reward signal) is emitted.
 *      The reward in loop.ts is gated on writeBubble returning non-null,
 *      so a null second return prevents the duplicate pushReward.
 *   3. On startup witnessExit history replay, orderIds already in the
 *      bank are not re-promoted — the load from DB into seenOrderIds
 *      prevents re-insertion.
 *
 * Closes #574.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB pool before importing anything that uses it.
vi.mock('../../../db/connection.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../../db/connection.js';
import { ResonanceBank } from '../resonance_bank.js';
import type { Bubble } from '../working_memory.js';
import { BASIN_DIM } from '../basin.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBasin(): Float64Array {
  return new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
}

function makeBubble(orderId: string, pnl: number, symbol = 'ETH'): Bubble {
  const center = makeBasin();
  return {
    id: `test-${orderId}`,
    center,
    phi: 0.5,
    createdAt: Date.now(),
    lifetimeMs: 1_000,
    status: 'promoted',
    metadata: {},
    payload: {
      symbol,
      signal: 'BUY',
      realizedPnl: pnl,
      entryBasin: center,
      orderId,
    },
  };
}

/** Minimal DB row that satisfies rowToEntry's expectations. */
function fakeDbRow(orderId: string, symbol = 'ETH', pnl = -0.45): Record<string, unknown> {
  return {
    id: '1',
    symbol,
    entry_basin: JSON.stringify(Array.from(makeBasin())),
    realized_pnl: pnl,
    trade_duration_ms: null,
    trade_outcome: pnl > 0 ? 'win' : 'loss',
    order_id: orderId,
    basin_depth: 0.5,
    access_count: 1,
    phi_at_creation: 0.5,
    source: 'lived',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ResonanceBank — orderId deduplication', () => {
  let bank: ResonanceBank;

  beforeEach(() => {
    // Fresh bank instance per test — isolated seenOrderIds set.
    bank = new ResonanceBank();
    vi.mocked(pool.query).mockReset();
  });

  // ── Test 1: double-promote same orderId ─────────────────────────────────

  it('single-promotion: first call writes entry, returns BankEntry', async () => {
    const ORDER_ID = '571832166808645632';
    const bubble = makeBubble(ORDER_ID, -0.4527);

    // Load pass: empty bank (no existing orderIds).
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)           // SELECT order_id (load)
      .mockResolvedValueOnce({ rows: [fakeDbRow(ORDER_ID)] } as never); // INSERT

    const result = await bank.writeBubble(bubble, 'test-v1');

    expect(result).not.toBeNull();
    expect(result!.orderId).toBe(ORDER_ID);
    // query called exactly twice: once for load, once for INSERT
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(2);
  });

  it('duplicate-promotion: second call with same orderId returns null, no extra INSERT', async () => {
    const ORDER_ID = '571832166808645632';
    const bubble = makeBubble(ORDER_ID, -0.4527);

    // Load pass returns empty, first INSERT succeeds.
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [fakeDbRow(ORDER_ID)] } as never);

    const first = await bank.writeBubble(bubble, 'test-v1');
    expect(first).not.toBeNull();

    // Second call — same bubble, same orderId (e.g. Swing kernel replay).
    // No further pool.query calls should happen.
    const second = await bank.writeBubble(bubble, 'test-v1');
    expect(second).toBeNull();

    // pool.query was called only the 2 times from the first call.
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(2);
  });

  // ── Test 2: Position + Swing kernels same exit → one reward emitted ─────
  //
  // The reward signal in loop.ts is gated on writeBubble returning non-null:
  //   const written = await resonanceBank.writeBubble(bubble, ...);
  //   if (written) { this.pushReward(...); }
  //
  // Therefore a null return from the second writeBubble call (dedup) prevents
  // the duplicate pushReward. This test verifies that mechanism.

  it('Position + Swing simultaneous witness: second writeBubble returns null, preventing duplicate reward', async () => {
    const ORDER_ID = '571831537184890880';
    const positionBubble = makeBubble(ORDER_ID, -1.6649, 'BTC');
    const swingBubble = makeBubble(ORDER_ID, -1.6649, 'BTC');

    // Load pass: empty bank, then one INSERT for the Position kernel.
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [fakeDbRow(ORDER_ID, 'BTC', -1.6649)] } as never);

    // Position kernel writes first — succeeds.
    const posResult = await bank.writeBubble(positionBubble, 'test-v1');
    expect(posResult).not.toBeNull();

    // Swing kernel writes second (same orderId) — deduped, no INSERT.
    const swingResult = await bank.writeBubble(swingBubble, 'test-v1');
    expect(swingResult).toBeNull();

    // Only 2 pool.query calls total (load + one INSERT).
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(2);
  });

  // ── Test 3: startup replay does not re-promote already-banked orderIds ──

  it('startup replay: pre-existing orderIds in DB are not re-promoted', async () => {
    const ORDER_A = '571814891225432064'; // already in bank from prior session
    const ORDER_B = '571831537184890880'; // already in bank from prior session
    const ORDER_C = '571999999999999999'; // new orderId not yet in bank

    // The load query returns A and B as already-banked.
    vi.mocked(pool.query)
      .mockResolvedValueOnce({          // SELECT order_id (load)
        rows: [{ order_id: ORDER_A }, { order_id: ORDER_B }],
      } as never)
      .mockResolvedValueOnce({ rows: [fakeDbRow(ORDER_C)] } as never); // INSERT for C

    const bubbleA = makeBubble(ORDER_A, 0.0804, 'ETH');
    const bubbleB = makeBubble(ORDER_B, -1.6649, 'BTC');
    const bubbleC = makeBubble(ORDER_C, 0.25, 'ETH');

    const resultA = await bank.writeBubble(bubbleA, 'test-v1');
    const resultB = await bank.writeBubble(bubbleB, 'test-v1');
    const resultC = await bank.writeBubble(bubbleC, 'test-v1');

    // A and B were already in the bank — skipped.
    expect(resultA).toBeNull();
    expect(resultB).toBeNull();

    // C is new — promoted.
    expect(resultC).not.toBeNull();
    expect(resultC!.orderId).toBe(ORDER_C);

    // 2 pool.query calls: one SELECT (load) + one INSERT (for C only).
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(2);
  });

  // ── Test 4: hasOrderId reflects current state ────────────────────────────

  it('hasOrderId returns false for unknown orderId, true after promotion', async () => {
    const ORDER_ID = '571900000000000001';
    const bubble = makeBubble(ORDER_ID, 0.3, 'ETH');

    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)                      // load
      .mockResolvedValueOnce({ rows: [fakeDbRow(ORDER_ID, 'ETH', 0.3)] } as never); // INSERT

    expect(await bank.hasOrderId(ORDER_ID)).toBe(false);
    await bank.writeBubble(bubble, 'test-v1');
    expect(await bank.hasOrderId(ORDER_ID)).toBe(true);
  });

  // ── Test 5: orderId-less bubbles are always written (no dedup applied) ───

  it('bubbles without orderId are always written (no dedup applicable)', async () => {
    const bubbleNoId: Bubble = {
      id: 'test-noid',
      center: makeBasin(),
      phi: 0.5,
      createdAt: Date.now(),
      lifetimeMs: 1_000,
      status: 'promoted',
      metadata: {},
      payload: {
        symbol: 'ETH',
        realizedPnl: 0.1,
        entryBasin: makeBasin(),
        // orderId intentionally absent
      },
    };

    const fakeRow = fakeDbRow('', 'ETH', 0.1);
    fakeRow.order_id = null;

    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [fakeRow] } as never)  // first INSERT
      .mockResolvedValueOnce({ rows: [fakeRow] } as never); // second INSERT

    const first = await bank.writeBubble(bubbleNoId, 'test-v1');
    const second = await bank.writeBubble(bubbleNoId, 'test-v1');

    // Both succeed — no orderId to dedup on.
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(2);
  });

  // ── Test 6: ensureSeenOrderIdsLoaded retries after initial SELECT fails ─

  it('assertOrderIdCacheReady throws when initial SELECT fails, succeeds on retry', async () => {
    // First load (SELECT order_id) rejects — cache stays cold.
    vi.mocked(pool.query)
      .mockRejectedValueOnce(new Error('initial SELECT order_id failed') as never)
      .mockResolvedValueOnce({ rows: [] } as never);  // retry load succeeds

    // First call surfaces the load failure explicitly.
    await expect(bank.assertOrderIdCacheReady()).rejects.toThrow(/seen-orderIds cache not ready/);
    expect(bank.isOrderIdCacheReady()).toBe(false);

    // Retry succeeds — cache is now ready.
    await expect(bank.assertOrderIdCacheReady()).resolves.toBeUndefined();
    expect(bank.isOrderIdCacheReady()).toBe(true);

    // 2 pool.query calls total — failed load + retry load.
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(2);
  });

  it('hasOrderId returns false when the cache has not loaded — caller must check isOrderIdCacheReady', async () => {
    // Force the initial load to fail.
    vi.mocked(pool.query).mockRejectedValueOnce(new Error('SELECT failed') as never);

    // hasOrderId returns false even for an orderId that may exist in DB —
    // it can only see the in-memory cache, which is cold.
    const present = await bank.hasOrderId('any-id');
    expect(present).toBe(false);
    // The cache flag tells the caller this `false` is unreliable.
    expect(bank.isOrderIdCacheReady()).toBe(false);
  });

  // ── Test 7: insert failure releases the reservation for retry ───────────

  it('insert failure releases orderId reservation so retry is possible', async () => {
    const ORDER_ID = '571832100000000001';
    const bubble = makeBubble(ORDER_ID, -0.5, 'BTC');
    const dbRow = fakeDbRow(ORDER_ID, 'BTC', -0.5);

    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)    // load (empty)
      .mockRejectedValueOnce(new Error('connection refused') as never)  // first INSERT fails
      .mockResolvedValueOnce({ rows: [dbRow] } as never);               // retry INSERT succeeds

    // First attempt fails — reservation is released.
    const firstAttempt = await bank.writeBubble(bubble, 'test-v1');
    expect(firstAttempt).toBeNull();

    // Second attempt (retry) — reservation was released, so it proceeds.
    const retry = await bank.writeBubble(bubble, 'test-v1');
    expect(retry).not.toBeNull();
    expect(retry!.orderId).toBe(ORDER_ID);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// #579 — Quarantine filter on retrieval queries
// ─────────────────────────────────────────────────────────────────────────────
//
// Migration 036 added a `quarantined` BOOLEAN column to monkey_resonance_bank
// and flagged all bubbles created before the basinDirection saturation fix
// (commit 589c775, deployed 2026-04-27T02:39:32Z). Pre-fix bubbles have
// warped geometric coordinates (basinDir pegged at -1.0) that poison
// nearest-neighbour retrieval against any post-fix bearish-lean tick.
//
// The fix is a WHERE quarantined = false predicate on every retrieval site:
//   findNearestBasins, sovereignty, bankSize.
//
// These tests verify the SQL emitted at each call site contains the filter
// string. They don't run against a real DB; they assert on the query mock.

describe('ResonanceBank — #579 quarantine filter', () => {
  let bank: ResonanceBank;

  beforeEach(() => {
    bank = new ResonanceBank();
    vi.mocked(pool.query).mockReset();
  });

  it('findNearestBasins includes WHERE quarantined = false', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    await bank.findNearestBasins(makeBasin(), null, 5, 100);
    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).toMatch(/WHERE\s+quarantined\s*=\s*false/i);
  });

  it('findNearestBasins(symbol) preserves quarantine filter alongside symbol filter', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    await bank.findNearestBasins(makeBasin(), 'ETH_USDT_PERP', 5, 100);
    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).toMatch(/quarantined\s*=\s*false/i);
    expect(sql).toMatch(/AND\s+symbol\s*=\s*\$1/i);
  });

  it('sovereignty excludes quarantined bubbles', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ lived: 100, total: 100 }],
    } as never);
    await bank.sovereignty();
    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).toMatch(/WHERE\s+quarantined\s*=\s*false/i);
  });

  it('bankSize excludes quarantined bubbles', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ n: 397 }],
    } as never);
    const n = await bank.bankSize();
    expect(n).toBe(397);
    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).toMatch(/WHERE\s+quarantined\s*=\s*false/i);
  });

  it('seenOrderIds load DOES NOT filter quarantined (we want to dedupe against ALL existing ids)', async () => {
    // Quarantined orderIds still need to block re-write — we don't want
    // to recreate a quarantined bubble's history under a fresh row.
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)  // load (no quarantine filter expected)
      .mockResolvedValueOnce({ rows: [fakeDbRow('orderX')] } as never);  // INSERT

    const bubble = makeBubble('orderX', 0.5);
    await bank.writeBubble(bubble, 'test-v1');

    // First call is the seen-orderIds load — must NOT filter quarantined.
    const loadSql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(loadSql).toMatch(/SELECT\s+order_id\s+FROM\s+monkey_resonance_bank/i);
    expect(loadSql).not.toMatch(/quarantined/i);
  });
});
