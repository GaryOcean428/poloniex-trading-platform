/**
 * claimAdoptedPositions.test.ts — adoption pickup routing + bracket commit.
 *
 * The reconciler inserts operator-opened positions with reason
 * `kernel_adopted|…`, invisible to findOpenMonkeyTrade (which keys on the
 * `monkey|kernel=<instance>|` prefix). claimAdoptedPositions rewrites the
 * prefix so exactly one instance — monkey-position — owns and manages
 * them, and commits a geometry-derived bracket so the synthetic exit gate
 * has a limit to enforce.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mirror the env mock used by the other loop.ts-importing tests so the
// module load chain doesn't blow up on missing DATABASE_URL / JWT_SECRET.
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 8765,
    DATABASE_URL: 'postgresql://test:5432/test',
    JWT_SECRET: 'test-jwt-secret-32-characters-xxxxxxxxxx',
  },
}));

const queryMock = vi.fn();
vi.mock('../../../db/connection.js', () => ({
  pool: { query: queryMock },
}));

async function makeKernel(instanceId: string) {
  const { MonkeyKernel } = await import('../loop.js');
  return new MonkeyKernel({ instanceId, timeframe: '15m', tickMs: 30_000 });
}

async function adoptionConstants() {
  const {
    ADOPTED_POSITION_REASON_PREFIX,
    OWNED_ADOPTED_POSITION_REASON_PREFIX,
  } = await import('../loop.js');
  return { ADOPTED_POSITION_REASON_PREFIX, OWNED_ADOPTED_POSITION_REASON_PREFIX };
}

describe('claimAdoptedPositions', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] });
  });

  it('does nothing on the non-position instance (single deterministic owner)', async () => {
    const swing = await makeKernel('monkey-swing');
    queryMock.mockClear();
    await (swing as any).claimAdoptedPositions('BTC_USDT_PERP', {
      tpDistance: 100, slDistance: 50,
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rewrites the kernel_adopted| prefix on the position instance', async () => {
    const pos = await makeKernel('monkey-position');
    queryMock.mockClear();
    await (pos as any).claimAdoptedPositions('BTC_USDT_PERP', null);
    // frBracket is null → claim UPDATE only, no bracket commit.
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    const {
      ADOPTED_POSITION_REASON_PREFIX,
      OWNED_ADOPTED_POSITION_REASON_PREFIX,
    } = await adoptionConstants();
    expect(sql).toContain('replace(reason');
    expect(sql).toContain("agent = 'K'");
    expect(sql).toContain("reason LIKE $2 || '%'");
    expect(params).toEqual([
      'BTC_USDT_PERP',
      ADOPTED_POSITION_REASON_PREFIX,
      OWNED_ADOPTED_POSITION_REASON_PREFIX,
    ]);
  });

  it('commits a side-aware bracket when geometry is derivable', async () => {
    const pos = await makeKernel('monkey-position');
    queryMock.mockClear();
    await (pos as any).claimAdoptedPositions('ETH_USDT_PERP', {
      tpDistance: 80, slDistance: 40,
    });
    // claim UPDATE + bracket-commit UPDATE.
    expect(queryMock).toHaveBeenCalledTimes(2);
    const [sql, params] = queryMock.mock.calls[1];
    const { OWNED_ADOPTED_POSITION_REASON_PREFIX } = await adoptionConstants();
    expect(sql).toContain('take_profit = entry_price');
    expect(sql).toContain('$3::numeric');
    expect(sql).toContain('$4::numeric');
    expect(sql).toContain('stop_loss');
    expect(sql).toContain('take_profit IS NULL AND stop_loss IS NULL');
    expect(params).toEqual(['ETH_USDT_PERP', OWNED_ADOPTED_POSITION_REASON_PREFIX, 80, 40]);
  });

  it('skips the bracket commit when geometry is not derivable (0 distances)', async () => {
    const pos = await makeKernel('monkey-position');
    queryMock.mockClear();
    await (pos as any).claimAdoptedPositions('SOL_USDT_PERP', {
      tpDistance: 0, slDistance: 0,
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('fails soft on a DB error — never throws into the tick', async () => {
    const pos = await makeKernel('monkey-position');
    queryMock.mockClear();
    queryMock.mockRejectedValueOnce(new Error('db down'));
    await expect(
      (pos as any).claimAdoptedPositions('BTC_USDT_PERP', null),
    ).resolves.toBeUndefined();
  });
});
