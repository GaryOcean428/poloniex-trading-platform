import { afterEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../../../db/connection.js', () => ({
  pool: {
    query: queryMock,
  },
}));

describe('rewardShadowSync', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    queryMock.mockReset();
    delete process.env.MONKEY_REWARD_RPE_DARK;
  });

  it('persists payloads while dark observer is enabled', async () => {
    process.env.MONKEY_REWARD_RPE_DARK = 'true';

    const { ingestRewardRpeDark } = await import('../rewardShadowSync.js');

    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const accepted = await ingestRewardRpeDark({
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
    expect(sql).toContain('INSERT INTO monkey_reward_shadow');
    expect(params[1]).toBe('BTC_USDT_PERP');
  });

  it('rejects invalid payloads', async () => {
    const { ingestRewardRpeDark } = await import('../rewardShadowSync.js');
    const accepted = await ingestRewardRpeDark({ foo: 'bar' });
    expect(accepted).toBe(!1);
  });
});
