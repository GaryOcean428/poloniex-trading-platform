import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../../../db/connection.js', () => ({
  pool: {
    query: queryMock,
  },
}));

function makeRow(
  idx: number,
  opts: {
    substrate?: 'ts' | 'py';
    symbol?: string;
    source?: string;
    ts?: string;
    realized?: number;
    predicted?: number | null;
    sigma?: number | null;
    phasicRpe?: number;
    proposedDop?: number;
    tonic?: number;
  } = {},
) {
  return {
    ts: opts.ts ?? new Date(Date.now() - idx * 1000).toISOString(),
    substrate: opts.substrate ?? 'py',
    symbol: opts.symbol ?? 'BTC_USDT_PERP',
    source: opts.source ?? 'trade_close',
    realized_pnl_frac: opts.realized ?? 0,
    predicted_pnl_frac: opts.predicted ?? 0,
    sigma_residual: opts.sigma ?? 0.5,
    phasic_rpe: opts.phasicRpe ?? 0,
    proposed_dop: opts.proposedDop ?? 0.5,
    tonic_baseline: opts.tonic ?? 0.5,
    valid: true,
  };
}

describe('rewardShadowReadiness', () => {
  beforeEach(() => {
    queryMock.mockReset();
    delete process.env.MONKEY_REWARD_RPE_LIVE;
  });

  it('computes prediction skill + dip separation + parity metrics', async () => {
    const { scanRewardShadowReadiness, __resetRewardShadowReadinessStateForTests } = await import('../rewardShadowReadiness.js');
    __resetRewardShadowReadinessStateForTests();
    const rows = [
      makeRow(1, { substrate: 'py', ts: '2026-05-30T00:00:00.000Z', symbol: 'BTC', phasicRpe: -1.6, realized: -0.8, predicted: -0.79, proposedDop: 0.1, tonic: 0.7 }),
      makeRow(2, { substrate: 'ts', ts: '2026-05-30T00:00:00.000Z', symbol: 'BTC', phasicRpe: -1.6, realized: -0.8, predicted: -0.79, proposedDop: 0.1000000002, tonic: 0.7 }),
      makeRow(3, { substrate: 'py', ts: '2026-05-30T00:01:00.000Z', symbol: 'ETH', phasicRpe: -0.2, realized: -0.6, predicted: -0.6, proposedDop: 0.64, tonic: 0.7 }),
      makeRow(4, { substrate: 'ts', ts: '2026-05-30T00:01:00.000Z', symbol: 'ETH', phasicRpe: -0.2, realized: -0.6, predicted: -0.6, proposedDop: 0.6400000002, tonic: 0.7 }),
      makeRow(5, { substrate: 'py', ts: '2026-05-30T00:02:00.000Z', symbol: 'SOL', phasicRpe: -1.4, realized: -0.7, predicted: -0.69, proposedDop: 0.12, tonic: 0.7 }),
      makeRow(6, { substrate: 'ts', ts: '2026-05-30T00:02:00.000Z', symbol: 'SOL', phasicRpe: -1.4, realized: -0.7, predicted: -0.69, proposedDop: 0.1200000002, tonic: 0.7 }),
    ];

    queryMock.mockResolvedValueOnce({ rows, rowCount: rows.length });
    const metrics = await scanRewardShadowReadiness();

    expect(metrics.predictionSkill).toBeGreaterThan(0);
    expect(metrics.surpriseCount).toBe(4);
    expect(metrics.predictedCount).toBe(2);
    expect(metrics.dipSeparated).toBe(true);
    expect(metrics.parityDivergence).toBeLessThan(1e-9);
    expect(metrics.coverage).toBe(1);
    expect(metrics.ready).toBe(true);
  });

  it('flags post-cutover degrade when prediction skill turns negative', async () => {
    const { scanRewardShadowReadiness, __resetRewardShadowReadinessStateForTests } = await import('../rewardShadowReadiness.js');
    __resetRewardShadowReadinessStateForTests();
    process.env.MONKEY_REWARD_RPE_LIVE = 'true';

    const collapsedRows = [
      makeRow(1, { substrate: 'py', ts: '2026-05-30T00:00:00.000Z', symbol: 'BTC', phasicRpe: -1.8, realized: -0.8, predicted: 1.2, proposedDop: 0.68, tonic: 0.7 }),
      makeRow(2, { substrate: 'ts', ts: '2026-05-30T00:00:00.000Z', symbol: 'BTC', phasicRpe: -1.8, realized: -0.8, predicted: -1.2, proposedDop: 0.6800000001, tonic: 0.7 }),
      makeRow(3, { substrate: 'py', ts: '2026-05-30T00:01:00.000Z', symbol: 'ETH', phasicRpe: -0.2, realized: -0.7, predicted: 1.1, proposedDop: 0.69, tonic: 0.7 }),
      makeRow(4, { substrate: 'ts', ts: '2026-05-30T00:01:00.000Z', symbol: 'ETH', phasicRpe: -0.2, realized: -0.7, predicted: -1.1, proposedDop: 0.6900000001, tonic: 0.7 }),
      makeRow(5, { substrate: 'py', ts: '2026-05-30T00:02:00.000Z', symbol: 'SOL', phasicRpe: -0.3, realized: -0.65, predicted: 1.0, proposedDop: 0.685, tonic: 0.7 }),
      makeRow(6, { substrate: 'ts', ts: '2026-05-30T00:02:00.000Z', symbol: 'SOL', phasicRpe: -0.3, realized: -0.65, predicted: -1.0, proposedDop: 0.6850000001, tonic: 0.7 }),
    ];

    queryMock
      .mockResolvedValueOnce({ rows: collapsedRows, rowCount: collapsedRows.length })
      .mockResolvedValueOnce({ rows: collapsedRows, rowCount: collapsedRows.length });

    await scanRewardShadowReadiness();
    const metrics = await scanRewardShadowReadiness();

    expect(metrics.postCutoverFlagged).toBe(true);
    expect(metrics.ready).toBe(!1);
  });
});
