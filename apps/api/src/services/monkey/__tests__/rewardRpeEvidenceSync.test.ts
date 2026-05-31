import { afterEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../../../db/connection.js', () => ({
  pool: {
    query: queryMock,
  },
}));

describe('rewardRpeEvidenceSync', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    queryMock.mockReset();
  });

  it('persists live payloads without an env gate', async () => {
    const { ingestRewardRpeLive } = await import('../rewardRpeEvidenceSync.js');

    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const accepted = await ingestRewardRpeLive({
      source: 'polo_authoritative_close',
      substrate: 'ts',
      symbol: 'BTC_USDT_PERP',
      realized_pnl_frac: -0.02,
      predicted_pnl_frac: -0.01,
      sigma_residual: 0.3,
      phasic_rpe: -0.5,
      legacy_dop: 0.4,
      legacy_ser: 0.5,
      legacy_endo: 0.45,
      proposed_dop: 0.32,
      proposed_ser: 0.47,
      proposed_endo: 0.44,
      tonic_baseline: 0.45,
      valid: true,
      ts: '2026-05-30T00:00:00.000Z',
    });

    expect(accepted).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO monkey_reward_rpe_evidence');
    expect(params[1]).toBe('BTC_USDT_PERP');
  });

  it('rejects invalid payloads', async () => {
    const { ingestRewardRpeLive } = await import('../rewardRpeEvidenceSync.js');
    const accepted = await ingestRewardRpeLive({ foo: 'bar' });
    expect(accepted).toBe(false);
  });
});
