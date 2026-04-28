/**
 * resonance_bank_lane.test.ts — TS tests for lane field in resonance bank
 *
 * Tests:
 *   1. writeBubble includes lane in INSERT SQL
 *   2. writeBubble defaults to 'swing' when no lane in payload
 *   3. findNearestBasins includes lane filter in SQL when provided
 *   4. findNearestBasins omits lane filter when not provided
 *   5. rowToEntry parses lane from DB row
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/connection.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../../db/connection.js';
import { ResonanceBank } from '../resonance_bank.js';
import type { Bubble } from '../working_memory.js';
import { BASIN_DIM } from '../basin.js';

function makeBasin(): Float64Array {
  return new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
}

function makeBubble(
  orderId: string,
  pnl: number,
  lane?: 'scalp' | 'swing' | 'trend' | 'observe',
): Bubble {
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
      symbol: 'ETH',
      signal: 'BUY',
      realizedPnl: pnl,
      entryBasin: center,
      orderId,
      lane,
    },
  };
}

function fakeDbRow(orderId: string, lane = 'swing'): Record<string, unknown> {
  return {
    id: '1',
    symbol: 'ETH',
    entry_basin: JSON.stringify(Array.from(makeBasin())),
    realized_pnl: -0.45,
    trade_duration_ms: null,
    trade_outcome: 'loss',
    order_id: orderId,
    basin_depth: 0.5,
    access_count: 1,
    phi_at_creation: 0.5,
    source: 'lived',
    lane,
  };
}

describe('ResonanceBank — lane field', () => {
  let bank: ResonanceBank;

  beforeEach(() => {
    bank = new ResonanceBank();
    vi.mocked(pool.query).mockReset();
  });

  it('writeBubble includes lane in INSERT SQL and params', async () => {
    const ORDER_ID = 'lane-test-1';
    const bubble = makeBubble(ORDER_ID, -0.5, 'scalp');

    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [fakeDbRow(ORDER_ID, 'scalp')] } as never);

    const result = await bank.writeBubble(bubble, 'test-v1');
    expect(result).not.toBeNull();
    expect(result!.lane).toBe('scalp');

    // Check the INSERT SQL includes 'lane'
    const insertCall = vi.mocked(pool.query).mock.calls[1];
    const sql = String(insertCall[0]);
    expect(sql).toMatch(/lane/);
    // Check the params include 'scalp' as last param
    const params = insertCall[1] as unknown[];
    expect(params[params.length - 1]).toBe('scalp');
  });

  it('writeBubble defaults lane to swing when not in payload', async () => {
    const ORDER_ID = 'lane-test-2';
    const bubble = makeBubble(ORDER_ID, 0.3); // no lane

    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [fakeDbRow(ORDER_ID, 'swing')] } as never);

    const result = await bank.writeBubble(bubble, 'test-v1');
    expect(result).not.toBeNull();
    expect(result!.lane).toBe('swing');

    const insertCall = vi.mocked(pool.query).mock.calls[1];
    const params = insertCall[1] as unknown[];
    expect(params[params.length - 1]).toBe('swing');
  });

  it('findNearestBasins includes lane filter in SQL when provided', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    await bank.findNearestBasins(makeBasin(), null, 5, 100, 'scalp');

    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).toMatch(/AND\s+lane\s*=\s*\$/i);
    const params = vi.mocked(pool.query).mock.calls[0][1] as unknown[];
    expect(params).toContain('scalp');
  });

  it('findNearestBasins omits lane filter when not provided', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    await bank.findNearestBasins(makeBasin(), null, 5, 100);

    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).not.toMatch(/AND\s+lane\s*=/i);
  });

  it('findNearestBasins with symbol + lane includes both filters', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    await bank.findNearestBasins(makeBasin(), 'ETH_USDT_PERP', 5, 100, 'trend');

    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).toMatch(/symbol\s*=\s*\$1/i);
    expect(sql).toMatch(/lane\s*=\s*\$2/i);
    const params = vi.mocked(pool.query).mock.calls[0][1] as unknown[];
    expect(params).toEqual(['ETH_USDT_PERP', 'trend']);
  });

  it('rowToEntry parses lane from DB row when lane is present', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [fakeDbRow('order-1', 'trend')],
    } as never);

    const entries = await bank.findNearestBasins(makeBasin(), null, 5, 100);
    expect(entries).toHaveLength(1);
    expect(entries[0].entry.lane).toBe('trend');
  });

  it('rowToEntry falls back to lane="swing" when DB lane is null', async () => {
    const rowWithNullLane: Record<string, unknown> = {
      ...fakeDbRow('order-2'),
      lane: null,
    };
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [rowWithNullLane],
    } as never);

    const entries = await bank.findNearestBasins(makeBasin(), null, 5, 100);
    expect(entries).toHaveLength(1);
    expect(entries[0].entry.lane).toBe('swing');
  });

  it('rowToEntry falls back to lane="swing" when DB lane field is missing entirely', async () => {
    const rowWithoutLane: Record<string, unknown> = { ...fakeDbRow('order-3') };
    delete rowWithoutLane.lane;
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [rowWithoutLane],
    } as never);

    const entries = await bank.findNearestBasins(makeBasin(), null, 5, 100);
    expect(entries).toHaveLength(1);
    expect(entries[0].entry.lane).toBe('swing');
  });
});
