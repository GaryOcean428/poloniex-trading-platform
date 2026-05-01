/**
 * kellyCapLane.test.ts — per-lane Kelly leverage cap (issue #622).
 *
 * Tests:
 *   1. getKellyRollingStats(agent, lane) queries with AND lane = $2
 *   2. getKellyRollingStats(agent) (no lane) queries pooled (legacy)
 *   3. current_leverage with scalp-only winning stats vs pooled mixed
 *   4. Per-lane cold-start: each lane independently cold until own count >= 5
 *   5. TS/Python parity shape for getKellyRollingStats output
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/connection.js', () => ({
  pool: { query: vi.fn() },
}));

// Minimal env mock — prevents env validation error when logger initialises.
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 8765,
    DATABASE_URL: 'postgresql://test:5432/test',
    JWT_SECRET: 'test-jwt-secret-32-characters-xxxxxxxxxx',
  },
}));

import { pool } from '../../../db/connection.js';
import { getKellyRollingStats } from '../kelly_rolling_stats.js';
import { currentLeverage } from '../executive.js';
import { BASIN_DIM } from '../basin.js';
import { MonkeyMode } from '../modes.js';

// ── helpers ────────────────────────────────────────────────────────

function makePnlRows(pnls: number[]): { rows: { pnl: number }[] } {
  return { rows: pnls.map((p) => ({ pnl: p })) };
}

const NEUTRAL_NC = {
  acetylcholine: 0.5, dopamine: 0.5, serotonin: 0.5,
  norepinephrine: 0, gaba: 0.5, endorphins: 0.5,
};

function basinState(sovereignty = 0.7) {
  const b = new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
  return {
    basin: b as unknown as Float64Array,
    identityBasin: b as unknown as Float64Array,
    phi: 0.5,
    kappa: 64,
    basinVelocity: 0,
    regimeWeights: { equilibrium: 1, efficient: 0, quantum: 0 },
    sovereignty,
    neurochemistry: NEUTRAL_NC,
  } as any;
}

// ── getKellyRollingStats SQL query shape ──────────────────────────

describe('getKellyRollingStats — lane SQL filter', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('no lane -> pooled query (no lane clause)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(
      makePnlRows([1, 2, 3, -1, -0.5]) as never,
    );
    await getKellyRollingStats('K');
    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    const params = vi.mocked(pool.query).mock.calls[0][1] as unknown[];
    expect(sql).not.toContain('lane');
    expect(params).toEqual(['K']);
  });

  it('lane = "scalp" -> AND lane = $2 in SQL', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(
      makePnlRows([1, 2, 3, -1, -0.5]) as never,
    );
    await getKellyRollingStats('K', 'scalp');
    const sql = String(vi.mocked(pool.query).mock.calls[0][0] ?? '');
    const params = vi.mocked(pool.query).mock.calls[0][1] as unknown[];
    expect(sql).toContain('lane = $2');
    expect(params).toEqual(['K', 'scalp']);
  });

  it('lane = "swing" -> AND lane = $2 with correct param', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(
      makePnlRows([1, 2, 3, -1, -0.5]) as never,
    );
    await getKellyRollingStats('K', 'swing');
    const params = vi.mocked(pool.query).mock.calls[0][1] as unknown[];
    expect(params).toEqual(['K', 'swing']);
  });

  it('lane = "trend" -> AND lane = $2 with correct param', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(
      makePnlRows([1, 2, 3, -1, -0.5]) as never,
    );
    await getKellyRollingStats('K', 'trend');
    const params = vi.mocked(pool.query).mock.calls[0][1] as unknown[];
    expect(params).toEqual(['K', 'trend']);
  });

  it('returns winRate/avgWin/avgLoss from lane-filtered rows', async () => {
    // 3 wins (1, 2, 3) + 2 losses (-1, -0.5) = 5 trades
    // winRate = 3/5 = 0.6, avgWin = 2, avgLoss = -0.75
    vi.mocked(pool.query).mockResolvedValueOnce(
      makePnlRows([1, 2, 3, -1, -0.5]) as never,
    );
    const stats = await getKellyRollingStats('K', 'scalp');
    expect(stats).not.toBeNull();
    expect(stats!.winRate).toBeCloseTo(0.6, 5);
    expect(stats!.avgWin).toBeCloseTo(2.0, 5);
    expect(stats!.avgLoss).toBeCloseTo(-0.75, 5);
  });

  it('no lane -> same computation from pooled rows', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(
      makePnlRows([1, 2, 3, -1, -0.5]) as never,
    );
    const stats = await getKellyRollingStats('K');
    expect(stats).not.toBeNull();
    expect(stats!.winRate).toBeCloseTo(0.6, 5);
  });
});

// ── Per-lane cold-start ────────────────────────────────────────────

describe('getKellyRollingStats — per-lane cold-start', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('scalp with 5+ trades returns stats (warm)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(
      makePnlRows([1, 2, 3, -1, -0.5]) as never,
    );
    const stats = await getKellyRollingStats('K', 'scalp');
    expect(stats).not.toBeNull();
  });

  it('swing with 2 trades returns null (cold)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(
      makePnlRows([1, -0.5]) as never,
    );
    const stats = await getKellyRollingStats('K', 'swing');
    expect(stats).toBeNull();
  });

  it('trend with 4 trades returns null (cold)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(
      makePnlRows([1, 2, -1, -0.5]) as never,
    );
    const stats = await getKellyRollingStats('K', 'trend');
    expect(stats).toBeNull();
  });

  it('trend with 5 trades returns stats (just warmed)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(
      makePnlRows([1, 2, -1, -0.5, 0.5]) as never,
    );
    const stats = await getKellyRollingStats('K', 'trend');
    expect(stats).not.toBeNull();
  });

  it('pooled with 0 trades returns null (cold)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    const stats = await getKellyRollingStats('K');
    expect(stats).toBeNull();
  });

  it('DB error returns null (graceful degradation)', async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error('DB down') as never);
    const stats = await getKellyRollingStats('K', 'scalp');
    expect(stats).toBeNull();
  });
});

// ── currentLeverage — lane-specific vs pooled Kelly cap ────────────

describe('currentLeverage — lane-specific vs pooled stats', () => {
  it('scalp-only winning history produces higher Kelly cap than pooled mixed', () => {
    // Scalp lane: high win rate with positive edge
    const scalpOnlyStats = { winRate: 0.80, avgWin: 1.5, avgLoss: -0.3 };
    // Pooled mixed: break-even (scalp wins cancel trend losses)
    const pooledMixedStats = { winRate: 0.50, avgWin: 2.0, avgLoss: -2.0 };

    const scalpOut = currentLeverage(
      basinState(), 40, MonkeyMode.INVESTIGATION, 0, scalpOnlyStats,
    );
    const pooledOut = currentLeverage(
      basinState(), 40, MonkeyMode.INVESTIGATION, 0, pooledMixedStats,
    );
    const scalpCap = (scalpOut.derivation as any).kellyCap as number;
    const pooledCap = (pooledOut.derivation as any).kellyCap as number;

    // Scalp stats are informative + positive edge -> Kelly cap binds
    // Pooled stats are break-even -> Kelly cap is no-op (= max_lev = 40)
    expect(pooledCap).toBe(40);
    expect(scalpCap).toBeLessThan(40);
    expect(scalpCap).toBeGreaterThanOrEqual(8);
  });

  it('scalp warm + swing cold -> swing defers to max_lev (per-lane cold-start)', () => {
    const warmScalpStats = { winRate: 0.7, avgWin: 2, avgLoss: -1 };
    const scalpOut = currentLeverage(
      basinState(), 45, MonkeyMode.INVESTIGATION, 0, warmScalpStats,
    );
    const scalpCap = (scalpOut.derivation as any).kellyCap as number;

    // Swing cold-start: null stats -> no-op
    const coldSwingOut = currentLeverage(
      basinState(), 45, MonkeyMode.INVESTIGATION, 0, null,
    );
    const swingCap = (coldSwingOut.derivation as any).kellyCap as number;

    expect(scalpCap).toBeLessThanOrEqual(45);
    expect(swingCap).toBe(45);
  });

  it('lane stats are independent: scalp cap does not pollute swing cap', () => {
    const scalpStats = { winRate: 0.7, avgWin: 2, avgLoss: -1 };
    const scalpOut = currentLeverage(
      basinState(), 40, MonkeyMode.INVESTIGATION, 0, scalpStats,
    );
    const swingOut = currentLeverage(
      basinState(), 40, MonkeyMode.INVESTIGATION, 0, null,
    );

    const scalpCap = (scalpOut.derivation as any).kellyCap as number;
    const swingCap = (swingOut.derivation as any).kellyCap as number;
    expect(scalpCap).not.toBe(swingCap);
    expect(swingCap).toBe(40);
  });
});

// ── TS / Python parity shape ───────────────────────────────────────

describe('TS/Python parity table — getKellyRollingStats output shape', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('output shape: { winRate, avgWin, avgLoss } with finite numbers', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(
      makePnlRows([2, 3, 1.5, -0.5, -1]) as never,
    );
    const stats = await getKellyRollingStats('K', 'scalp');
    expect(stats).not.toBeNull();
    expect(typeof stats!.winRate).toBe('number');
    expect(typeof stats!.avgWin).toBe('number');
    expect(typeof stats!.avgLoss).toBe('number');
    expect(isFinite(stats!.winRate)).toBe(true);
    expect(isFinite(stats!.avgWin)).toBe(true);
    expect(isFinite(stats!.avgLoss)).toBe(true);
    expect(stats!.winRate).toBeGreaterThanOrEqual(0);
    expect(stats!.winRate).toBeLessThanOrEqual(1);
    expect(stats!.avgWin).toBeGreaterThan(0);
    expect(stats!.avgLoss).toBeLessThanOrEqual(0);
  });

  it('null returned when < 5 trades (matches Python None)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(
      makePnlRows([1, -0.5]) as never,
    );
    const stats = await getKellyRollingStats('K', 'trend');
    expect(stats).toBeNull();
  });
});
