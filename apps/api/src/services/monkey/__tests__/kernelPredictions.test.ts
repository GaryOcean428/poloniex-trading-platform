/**
 * kernelPredictions.test.ts — Issue #941 Phase 1.
 *
 * Pins the contract that protects the trading path from instrumentation
 * failure (P15 fail-closed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BASIN_DIM } from '../basin.js';

// We mock the pool BEFORE importing the SUT so the import binding picks
// up the mock. The shape mirrors the real pg.Pool we actually use.
const queryMock = vi.fn();
vi.mock('../../../db/connection.js', () => ({
  pool: { query: queryMock },
}));

// Logger is captured so we can assert WARN-on-failure.
const warnMock = vi.fn();
vi.mock('../../../utils/logger.js', () => ({
  default: { warn: warnMock, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { writeKernelPrediction, periodicCadenceSeconds } = await import('../kernel_predictions.js');

function uniformBasin(): Float64Array {
  const b = new Float64Array(BASIN_DIM);
  b.fill(1 / BASIN_DIM);
  return b;
}

function neutralSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    tradeId: null,
    kernelId: 'monkey-position|BTC_USDT_PERP',
    perceptionBasin: uniformBasin(),
    strategyForecastBasin: uniformBasin(),
    basinVelocity: 0.05,
    phi: 0.6,
    kappaEff: 64.0,
    predictedHorizonSeconds: null,
    predictedTerminalPnlUsdt: null,
    predictedPnlStddevUsdt: null,
    predictedDirection: 0 as const,
    predictedConfidence: 0.5,
    dopamine: 0.5, serotonin: 0.5, norepinephrine: 0.5,
    gaba: 0.5, endorphins: 0.5, acetylcholine: 0.5,
    regimeQuantum: 0.33, regimeEfficient: 0.33, regimeEquilibrium: 0.34,
    mode: 'investigation',
    lane: 'swing',
    snapshotReason: 'periodic' as const,
    triggeringGate: null,
    kernelVersion: 'test',
    sourcePath: 'test',
    ...overrides,
  };
}

describe('writeKernelPrediction — P15 fail-closed contract', () => {
  beforeEach(() => {
    queryMock.mockReset();
    warnMock.mockReset();
  });

  it('returns the inserted id on a successful INSERT', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 12345 }] }) // INSERT kernel_predictions
      .mockResolvedValueOnce({ rows: [] }); // (no second query — tradeId is null)

    const id = await writeKernelPrediction(neutralSnapshot());

    expect(id).toBe(12345);
    expect(queryMock).toHaveBeenCalledTimes(1); // tradeId null → no UPDATE
  });

  it('drops-and-logs on DB error — returns null instead of throwing', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'));

    // P15 invariant: the helper MUST NOT throw. If it threw, the kernel
    // tick's `void` call would still discard, but a different caller
    // could mistakenly await. The contract is: never throw.
    let didThrow = false;
    let result: number | null = -1;
    try {
      result = await writeKernelPrediction(neutralSnapshot());
    } catch {
      didThrow = true;
    }

    expect(didThrow).toBe(false);
    expect(result).toBe(null);
    expect(warnMock).toHaveBeenCalledWith(
      '[kernel_predictions] insert failed — dropped',
      expect.objectContaining({
        kernelId: 'monkey-position|BTC_USDT_PERP',
        snapshotReason: 'periodic',
      }),
    );
  });

  it('rejects basins of wrong dimension at the write boundary', async () => {
    const snap = neutralSnapshot({
      perceptionBasin: new Float64Array(32).fill(1 / 32),
    });

    const result = await writeKernelPrediction(snap);

    expect(result).toBe(null);
    expect(queryMock).not.toHaveBeenCalled(); // never reaches DB
    expect(warnMock).toHaveBeenCalledWith(
      '[kernel_predictions] basin dim mismatch — dropped',
      expect.objectContaining({ perceptionDim: 32, expected: BASIN_DIM }),
    );
  });

  it('increments prediction_count on the parent trade row when tradeId is set', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // INSERT kernel_predictions
      .mockResolvedValueOnce({ rows: [] }); // UPDATE autonomous_trades

    await writeKernelPrediction(neutralSnapshot({ tradeId: 99 }));

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE autonomous_trades SET prediction_count'),
      [99],
    );
  });

  it('sends basin coords as 64-element float arrays in INSERT params', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    await writeKernelPrediction(neutralSnapshot());

    expect(queryMock).toHaveBeenCalledTimes(1);
    const params = queryMock.mock.calls[0][1] as unknown[];
    // perception_basin is param $3, strategy_forecast_basin is $4
    expect(Array.isArray(params[2])).toBe(true);
    expect(Array.isArray(params[3])).toBe(true);
    expect((params[2] as number[]).length).toBe(BASIN_DIM);
    expect((params[3] as number[]).length).toBe(BASIN_DIM);
    // All six chemistry channels (params $14-$19) are present and numeric.
    for (let i = 13; i <= 18; i++) {
      expect(typeof params[i]).toBe('number');
    }
  });
});

describe('periodicCadenceSeconds — observer-derived from basin_velocity', () => {
  it('clamps low (rapid basin) at 5s minimum', () => {
    // very high velocity → 1/v → tiny → clamp at 5
    expect(periodicCadenceSeconds(10)).toBe(5);
  });

  it('clamps high (frozen basin) at 300s maximum', () => {
    // very low velocity → 1/v → huge → clamp at 300
    expect(periodicCadenceSeconds(0.001)).toBe(300);
  });

  it('returns 1/v in the normal range', () => {
    expect(periodicCadenceSeconds(0.1)).toBe(10);
    expect(periodicCadenceSeconds(0.05)).toBe(20);
    expect(periodicCadenceSeconds(0.02)).toBe(50);
  });

  it('returns the 60s fallback when bv is degenerate (zero/NaN/negative)', () => {
    expect(periodicCadenceSeconds(0)).toBe(60);
    expect(periodicCadenceSeconds(-1)).toBe(60);
    expect(periodicCadenceSeconds(NaN)).toBe(60);
  });
});
