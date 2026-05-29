import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const publishMock = vi.fn();

vi.mock('../../db/connection.js', () => ({
  pool: {
    query: queryMock,
  },
}));

vi.mock('../apiCredentialsService.js', () => ({
  apiCredentialsService: {
    getCredentials: vi.fn().mockResolvedValue({ apiKey: 'k', apiSecret: 's' }),
  },
}));

vi.mock('../poloniexFuturesService.js', () => ({
  default: {
    getAccountBalance: vi.fn().mockResolvedValue({ eq: '100' }),
    getPositions: vi.fn().mockResolvedValue([]),
    getPositionHistory: vi.fn().mockResolvedValue([
      {
        openTime: Date.parse('2026-05-27T08:02:13Z'),
        posSide: 'LONG',
        realizedPnl: '-1.0382',
      },
    ]),
  },
}));

vi.mock('../monitoringService.js', () => ({
  monitoringService: {
    recordPipelineHeartbeat: vi.fn(),
  },
}));

vi.mock('../monkey/kernel_bus.js', () => ({
  BusEventType: { OUTCOME: 'outcome' },
  getKernelBus: () => ({ publish: publishMock }),
}));

describe('stateReconciliationService ghost recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
  });

  it('closes a ghost row even when aggregate recovered PnL is conservatively ignored', async () => {
    queryMock
      // Open autonomous_trades rows.
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'trade-1',
            symbol: 'ETH_USDT_PERP',
            side: 'buy',
            entry_price: '2077.30',
            quantity: '0.38',
            order_id: 'open-order',
            entry_time: new Date('2026-05-27T08:02:13Z'),
          },
        ],
      })
      // Latest autonomous_performance row.
      .mockResolvedValueOnce({ rows: [] })
      // Ghost context lookup.
      .mockResolvedValueOnce({
        rows: [
          {
            exit_order_id: null,
            reason: 'monkey|kernel=monkey-swing|agent=K|lane=scalp|src=v0.10',
            agent: 'K',
          },
        ],
      })
      // Close ghost row UPDATE.
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const { stateReconciliationService } = await import('../stateReconciliationService.js');

    const result = await stateReconciliationService.reconcile('user-1');

    expect(result.ghosts).toHaveLength(1);
    const updateCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE autonomous_trades') &&
      String(sql).includes("SET status = 'closed'"),
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall?.[1]).toEqual(['manual_close_user', 'trade-1', null]);
    expect(publishMock).not.toHaveBeenCalled();
  });
});
