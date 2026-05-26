import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 8765,
    DATABASE_URL: '******ql://test:5432/test',
    JWT_SECRET: 'test-jwt-secret-32-characters-xxxxxxxxxx',
  },
}));

const { poolQueryMock } = vi.hoisted(() => ({ poolQueryMock: vi.fn() }));
vi.mock('../../../db/connection.js', () => ({
  pool: { query: poolQueryMock },
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../utils/engineVersion.js', () => ({
  getEngineVersion: () => 'test-engine',
}));

describe('kernel prediction corpus capture', () => {
  beforeEach(() => {
    poolQueryMock.mockReset();
    poolQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
  });

  it('stores 64-element basin arrays and all six chemistry channels', async () => {
    const { insertKernelPrediction } = await import('../kernel_predictions.js');
    const basin = Array.from({ length: 64 }, () => 1 / 64);
    await insertKernelPrediction({
      tradeId: 42,
      kernelId: 'monkey-position',
      perceptionBasin: basin,
      strategyForecastBasin: basin,
      fisherRaoDisagreement: 0,
      basinVelocity: 0.02,
      phi: 0.7,
      kappaEff: 63.5,
      predictedHorizonSeconds: 50,
      predictedTerminalPnlUsdt: 1.2,
      predictedPnlStddevUsdt: 0.4,
      predictedDirection: 1,
      predictedConfidence: 0.8,
      neurochemistry: {
        dopamine: 0.1,
        serotonin: 0.2,
        norepinephrine: 0.3,
        gaba: 0.4,
        endorphins: 0.5,
        acetylcholine: 0.6,
      },
      regimeWeights: { quantum: 0.2, efficient: 0.3, equilibrium: 0.5 },
      mode: 'INVESTIGATION',
      lane: 'swing',
      snapshotReason: 'periodic',
      sourcePath: 'test',
    }, { query: poolQueryMock });

    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain('INSERT INTO kernel_predictions');
    expect(sql).toContain('prediction_count = COALESCE(prediction_count, 0) + 1');
    expect(params[2]).toHaveLength(64);
    expect(params[3]).toHaveLength(64);
    expect(params.slice(13, 19)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  });

  it('drop-and-logs insert failures without throwing into the caller', async () => {
    const {
      recordKernelPrediction,
      _resetKernelPredictionBufferForTests,
    } = await import('../kernel_predictions.js');
    _resetKernelPredictionBufferForTests();
    poolQueryMock.mockRejectedValueOnce(new Error('db down'));
    const basin = Array.from({ length: 64 }, () => 1 / 64);

    expect(() => recordKernelPrediction({
      tradeId: 42,
      kernelId: 'monkey-position',
      perceptionBasin: basin,
      strategyForecastBasin: basin,
      snapshotReason: 'periodic',
      sourcePath: 'test',
    })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('derives observer cadence from basin velocity and clamps it', async () => {
    const { clampPredictionCadenceSeconds } = await import('../kernel_predictions.js');
    expect(clampPredictionCadenceSeconds(0.01)).toBe(100);
    expect(clampPredictionCadenceSeconds(1)).toBe(5);
    expect(clampPredictionCadenceSeconds(0)).toBe(300);
  });
});
