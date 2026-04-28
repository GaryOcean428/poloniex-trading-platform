/**
 * lane_decision_surface.test.ts — v0.8.6 (#586) lane feature tests.
 *
 * Verifies:
 *   1. BankEntry schema includes lane field; default 'swing' on rowToEntry.
 *   2. writeBubble includes lane in INSERT SQL.
 *   3. findNearestBasins(lane='scalp') includes AND lane = $N in SQL.
 *   4. findNearestBasins without lane does NOT add a lane SQL clause.
 *   5. chooseLane emits all 4 valid lane values.
 *   6. chooseLane temperature: high κ → sharper distribution.
 *   7. chooseLane softmax probabilities sum to 1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB pool before any module that uses it is imported.
vi.mock('../../../db/connection.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../../db/connection.js';
import { ResonanceBank } from '../resonance_bank.js';
import type { Bubble } from '../working_memory.js';
import { BASIN_DIM } from '../basin.js';
import { chooseLane, type BasinState, type LaneType } from '../executive.js';
import type { NeurochemicalState } from '../neurochemistry.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBasin(): Float64Array {
  return new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
}

function makeNc(): NeurochemicalState {
  return {
    acetylcholine: 0.5, dopamine: 0.5, serotonin: 0.5,
    norepinephrine: 0.5, gaba: 0.5, endorphins: 0.5,
  };
}

function makeBasinState(overrides: Partial<BasinState> = {}): BasinState {
  const basin = makeBasin();
  return {
    basin,
    identityBasin: basin,
    phi: 0.5,
    kappa: 64,
    regimeWeights: { quantum: 1/3, efficient: 1/3, equilibrium: 1/3 },
    neurochemistry: makeNc(),
    sovereignty: 0.5,
    basinVelocity: 0.02,
    ...overrides,
  };
}

function makeBubble(orderId: string, pnl: number, lane?: LaneType): Bubble {
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
    realized_pnl: 0.5,
    trade_duration_ms: null,
    trade_outcome: 'win',
    order_id: orderId,
    basin_depth: 0.5,
    access_count: 1,
    phi_at_creation: 0.5,
    source: 'lived',
    lane,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ResonanceBank — lane field (#586)', () => {
  let bank: ResonanceBank;

  beforeEach(() => {
    bank = new ResonanceBank();
    vi.mocked(pool.query).mockReset();
  });

  // ── 1. rowToEntry populates lane field ──────────────────────────────────────

  it('rowToEntry: lane field from DB row is preserved', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)  // load seen-orderIds
      .mockResolvedValueOnce({ rows: [fakeDbRow('order1', 'scalp')] } as never);

    const bubble = makeBubble('order1', 0.5, 'scalp');
    const result = await bank.writeBubble(bubble, 'test-v1');
    expect(result).not.toBeNull();
    expect(result!.lane).toBe('scalp');
  });

  it('rowToEntry: missing lane in DB row defaults to swing', async () => {
    const rowNoLane: Record<string, unknown> = {
      ...fakeDbRow('order2'),
      lane: null,  // simulate pre-migration row
    };
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [rowNoLane] } as never);

    const bubble = makeBubble('order2', 0.5);
    const result = await bank.writeBubble(bubble, 'test-v1');
    expect(result).not.toBeNull();
    expect(result!.lane).toBe('swing');
  });

  // ── 2. writeBubble includes lane in INSERT ─────────────────────────────────

  it('writeBubble: INSERT SQL includes lane parameter', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)  // load
      .mockResolvedValueOnce({ rows: [fakeDbRow('order3', 'scalp')] } as never);

    const bubble = makeBubble('order3', 0.3, 'scalp');
    await bank.writeBubble(bubble, 'test-v1');

    const insertCall = vi.mocked(pool.query).mock.calls[1];
    const sql = String(insertCall[0] ?? '');
    expect(sql).toMatch(/lane/i);

    // The 'scalp' value should appear in the params.
    const params = insertCall[1] as unknown[];
    expect(params).toContain('scalp');
  });

  it('writeBubble: bubble without lane defaults to swing in INSERT', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [fakeDbRow('order4', 'swing')] } as never);

    // No lane in bubble.payload
    const bubble = makeBubble('order4', 0.1);
    await bank.writeBubble(bubble, 'test-v1');

    const insertCall = vi.mocked(pool.query).mock.calls[1];
    const params = insertCall[1] as unknown[];
    expect(params).toContain('swing');
  });

  // ── 3. findNearestBasins with lane filter adds AND lane = $N ───────────────

  it('findNearestBasins(lane=scalp) adds AND lane = $N to SQL', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    await bank.findNearestBasins(makeBasin(), null, 5, 100, 'scalp');
    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).toMatch(/AND\s+lane\s*=\s*\$/i);
  });

  it('findNearestBasins(symbol, lane) adds both symbol and lane filters', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    await bank.findNearestBasins(makeBasin(), 'BTC_USDT_PERP', 5, 100, 'trend');
    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).toMatch(/AND\s+symbol\s*=\s*\$/i);
    expect(sql).toMatch(/AND\s+lane\s*=\s*\$/i);
    // Both values should be in params.
    const params = vi.mocked(pool.query).mock.calls[0][1] as unknown[];
    expect(params).toContain('BTC_USDT_PERP');
    expect(params).toContain('trend');
  });

  // ── 4. findNearestBasins without lane does NOT add lane clause ─────────────

  it('findNearestBasins without lane does NOT include lane filter', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    await bank.findNearestBasins(makeBasin(), null, 5, 100);
    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).not.toMatch(/AND\s+lane/i);
  });

  // ── #579 regression: quarantine filter still present with lane filter ───────

  it('findNearestBasins with lane filter still has quarantined = false', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    await bank.findNearestBasins(makeBasin(), null, 5, 100, 'swing');
    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    expect(sql).toMatch(/quarantined\s*=\s*false/i);
  });
});

// ── chooseLane unit tests ──────────────────────────────────────────────────────

describe('chooseLane (#586)', () => {
  // ── 5. Emits all 4 lane values ─────────────────────────────────────────────

  it('returns a valid LaneType', () => {
    const s = makeBasinState();
    const result = chooseLane(s);
    expect(['scalp', 'swing', 'trend', 'observe']).toContain(result.value);
  });

  it('low phi + low sovereignty + zero velocity → scalp', () => {
    const s = makeBasinState({ phi: 0.0, sovereignty: 0.0, basinVelocity: 0.0 });
    const result = chooseLane(s, 0.0);
    expect(result.value).toBe('scalp');
  });

  it('high phi + high sovereignty + strong tape → trend', () => {
    const s = makeBasinState({ phi: 1.0, sovereignty: 1.0, basinVelocity: 0.0 });
    const result = chooseLane(s, 1.0);
    expect(result.value).toBe('trend');
  });

  it('extreme basin velocity → observe', () => {
    const s = makeBasinState({ phi: 0.5, sovereignty: 0.5, basinVelocity: 10.0 });
    const result = chooseLane(s, 0.0);
    expect(result.value).toBe('observe');
  });

  // ── 6. Temperature scaling ──────────────────────────────────────────────────

  it('high kappa → sharper distribution (higher max prob)', () => {
    const sHi = makeBasinState({ kappa: 200 });
    const sLo = makeBasinState({ kappa: 1 });
    const rHi = chooseLane(sHi);
    const rLo = chooseLane(sLo);
    const maxHi = Math.max(...Object.values(rHi.derivation.softmaxProbs as Record<string, number>));
    const maxLo = Math.max(...Object.values(rLo.derivation.softmaxProbs as Record<string, number>));
    expect(maxHi).toBeGreaterThanOrEqual(maxLo);
  });

  it('tau equals 1/kappa', () => {
    const kappa = 40;
    const s = makeBasinState({ kappa });
    const result = chooseLane(s);
    expect((result.derivation.tau as number)).toBeCloseTo(1 / kappa, 6);
  });

  // ── 7. Softmax probs sum to 1 ──────────────────────────────────────────────

  it('softmax probabilities sum to 1', () => {
    const s = makeBasinState();
    const result = chooseLane(s);
    const probs = result.derivation.softmaxProbs as Record<string, number>;
    const total = Object.values(probs).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 9);
  });

  // ── Reward injection ───────────────────────────────────────────────────────

  it('positive reward for a lane increases its probability', () => {
    const s = makeBasinState({ phi: 0.5, sovereignty: 0.5 });
    const rBase = chooseLane(s, 0.0);
    const rRew = chooseLane(s, 0.0, { trend: 5.0, scalp: 0, swing: 0, observe: 0 });
    const baseProbs = rBase.derivation.softmaxProbs as Record<string, number>;
    const rewProbs = rRew.derivation.softmaxProbs as Record<string, number>;
    expect(rewProbs['trend']).toBeGreaterThanOrEqual(baseProbs['trend']);
  });
});
