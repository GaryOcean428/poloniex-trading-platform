import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/connection.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/connection.js';
import {
  calculateSlippageBps,
  getPaperOpenPositions,
  paperClosePosition,
  paperPlaceOrder,
} from '../paperExchangeSimulator.js';

const mockedQuery = vi.mocked(query);

describe('paperExchangeSimulator', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('paperPlaceOrder returns a synthetic order id prefixed paper-', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const result = await paperPlaceOrder({
      engine: 'monkey',
      userId: '00000000-0000-0000-0000-000000000001',
      symbol: 'BTC_USDT_PERP',
      side: 'long',
      quantity: 0.1,
      leverage: 10,
      markPrice: 100,
    });
    expect(result.orderId.startsWith('paper-')).toBe(true);
    expect(result.filled).toBe(true);
  });

  it('uses deterministic leverage-based slippage bps with cap', () => {
    expect(calculateSlippageBps(23)).toBe(2.3);
    expect(calculateSlippageBps(75)).toBe(7.5);
    expect(calculateSlippageBps(200)).toBe(10);
  });

  it('paperClosePosition computes pnl for long winner/loser and short winner/loser', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ id: '1', side: 'long', entry_price: 100, quantity: 1, leverage: 10, slippage_bps: 0 }],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(paperClosePosition('paper-long-win', 110, 'tp')).resolves.toMatchObject({
      pnl: 10,
    });

    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ id: '2', side: 'long', entry_price: 100, quantity: 1, leverage: 10, slippage_bps: 0 }],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(paperClosePosition('paper-long-loss', 90, 'sl')).resolves.toMatchObject({
      pnl: -10,
    });

    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ id: '3', side: 'short', entry_price: 100, quantity: 1, leverage: 10, slippage_bps: 0 }],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(paperClosePosition('paper-short-win', 90, 'tp')).resolves.toMatchObject({
      pnl: 10,
    });

    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ id: '4', side: 'short', entry_price: 100, quantity: 1, leverage: 10, slippage_bps: 0 }],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(paperClosePosition('paper-short-loss', 110, 'sl')).resolves.toMatchObject({
      pnl: -10,
    });
  });

  it('getPaperOpenPositions filters by engine+user and excludes closed positions', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'row-1',
          order_id: 'paper-1',
          engine: 'monkey',
          user_id: 'u-1',
          symbol: 'BTC_USDT_PERP',
          side: 'long',
          entry_price: 100,
          quantity: 1,
          leverage: 5,
          entry_time: '2026-05-15T00:00:00.000Z',
          metadata: { foo: 'bar' },
        },
      ],
    });
    const rows = await getPaperOpenPositions('monkey', 'u-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.orderId).toBe('paper-1');
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('exit_time IS NULL'),
      ['monkey', 'u-1'],
    );
  });

});
