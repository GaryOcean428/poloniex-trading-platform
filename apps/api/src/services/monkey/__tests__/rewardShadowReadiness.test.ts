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
    valid?: boolean;
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
    valid: opts.valid ?? true,
  };
}

function separatedRows() {
  const rows = [];
  let idx = 1;
  for (let i = 0; i < 4; i += 1) {
    const ts = `2026-05-30T00:0${i}:00.000Z`;
    const realized = -0.8 + i * 0.05;
    const predicted = realized + 0.01;
    const proposedDop = 0.1 + i * 0.01;
    rows.push(makeRow(idx++, { substrate: 'py', ts, symbol: `SUR${i}`, phasicRpe: -1.6, realized, predicted, proposedDop, tonic: 0.7 }));
    rows.push(makeRow(idx++, { substrate: 'ts', ts, symbol: `SUR${i}`, phasicRpe: -1.6, realized, predicted, proposedDop: proposedDop + 1e-10, tonic: 0.7 }));
  }
  for (let i = 0; i < 4; i += 1) {
    const ts = `2026-05-30T00:1${i}:00.000Z`;
    const realized = -0.4 - i * 0.04;
    const predicted = realized + 0.005;
    const proposedDop = 0.66 + i * 0.005;
    rows.push(makeRow(idx++, { substrate: 'py', ts, symbol: `PRE${i}`, phasicRpe: -0.2, realized, predicted, proposedDop, tonic: 0.7 }));
    rows.push(makeRow(idx++, { substrate: 'ts', ts, symbol: `PRE${i}`, phasicRpe: -0.2, realized, predicted, proposedDop: proposedDop + 1e-10, tonic: 0.7 }));
  }
  return rows;
}

describe('rewardShadowReadiness', () => {
  beforeEach(() => {
    queryMock.mockReset();
    delete process.env.MONKEY_REWARD_RPE_LIVE;
  });

  it('computes prediction skill + significant dip separation + parity metrics', async () => {
    const { scanRewardShadowReadiness, __resetRewardShadowReadinessStateForTests } = await import('../rewardShadowReadiness.js');
    __resetRewardShadowReadinessStateForTests();
    const rows = separatedRows();

    queryMock.mockResolvedValueOnce({ rows, rowCount: rows.length });
    const metrics = await scanRewardShadowReadiness();

    expect(metrics.predictionSkill).toBeGreaterThan(0);
    expect(metrics.surpriseCount).toBe(8);
    expect(metrics.predictedCount).toBe(8);
    expect(metrics.dipDifferentiationP).toBeLessThan(0.05);
    expect(metrics.dipSeparated).toBe(true);
    expect(metrics.parityMatchedPairs).toBe(8);
    expect(metrics.parityDivergence).toBeLessThan(1e-9);
    expect(metrics.coverage).toBe(1);
    expect(metrics.ready).toBe(true);
  });

  it('does not pass readiness without matched parity rows', async () => {
    const { scanRewardShadowReadiness, __resetRewardShadowReadinessStateForTests } = await import('../rewardShadowReadiness.js');
    __resetRewardShadowReadinessStateForTests();
    const rows = separatedRows().filter((row) => row.substrate === 'ts');

    queryMock.mockResolvedValueOnce({ rows, rowCount: rows.length });
    const metrics = await scanRewardShadowReadiness();

    expect(metrics.parityMatchedPairs).toBe(0);
    expect(metrics.ready).toBe(false);
  });

  it('requires the absolute coverage floor for readiness', async () => {
    const { scanRewardShadowReadiness, __resetRewardShadowReadinessStateForTests } = await import('../rewardShadowReadiness.js');
    __resetRewardShadowReadinessStateForTests();
    const rows = separatedRows().map((row, idx) => (
      idx < 4 ? row : { ...row, predicted_pnl_frac: null, sigma_residual: null }
    ));

    queryMock.mockResolvedValueOnce({ rows, rowCount: rows.length });
    const metrics = await scanRewardShadowReadiness();

    expect(metrics.coverage).toBe(0.25);
    expect(metrics.ready).toBe(false);
  });

  it('flags post-cutover degrade when prediction skill turns negative', async () => {
    const { scanRewardShadowReadiness, __resetRewardShadowReadinessStateForTests } = await import('../rewardShadowReadiness.js');
    __resetRewardShadowReadinessStateForTests();
    process.env.MONKEY_REWARD_RPE_LIVE = 'true';

    const collapsedRows = separatedRows().map((row, idx) => ({
      ...row,
      predicted_pnl_frac: idx % 2 === 0 ? 1.2 : -1.2,
      proposed_dop: row.tonic_baseline - 0.01,
    }));

    queryMock
      .mockResolvedValueOnce({ rows: collapsedRows, rowCount: collapsedRows.length })
      .mockResolvedValueOnce({ rows: collapsedRows, rowCount: collapsedRows.length });

    await scanRewardShadowReadiness();
    const metrics = await scanRewardShadowReadiness();

    expect(metrics.postCutoverFlagged).toBe(true);
    expect(metrics.ready).toBe(false);
  });
});
