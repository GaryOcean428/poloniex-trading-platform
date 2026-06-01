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

// Default 'auto' so the existing ghost/orphan tests run the full path.
const getExecutionModeMock = vi.fn().mockResolvedValue('auto');
vi.mock('../executionModeService.js', () => ({
  getCurrentExecutionMode: (...a: unknown[]) => getExecutionModeMock(...a),
}));

const getAccountBillsMock = vi.fn().mockResolvedValue([]);
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
    getAccountBills: (...args: unknown[]) => getAccountBillsMock(...args),
    normalizeSymbol: (s: string) => s,
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

describe('stateReconciliationService — operator paper MANDATE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getExecutionModeMock.mockResolvedValue('auto');
  });

  it('skips reconciliation (no adopt/close, no live read) when execution mode is not auto', async () => {
    getExecutionModeMock.mockResolvedValue('paper_only');
    const { stateReconciliationService } = await import('../stateReconciliationService.js');
    const polo = (await import('../poloniexFuturesService.js')).default as unknown as {
      getPositions: ReturnType<typeof vi.fn>;
      getAccountBalance: ReturnType<typeof vi.fn>;
    };
    const res = await stateReconciliationService.reconcile('user-1');
    expect(res.error).toBe('skipped_execution_mode_not_auto');
    expect(res.orphans).toEqual([]);
    expect(res.ghosts).toEqual([]);
    // The kernel must not touch the live exchange in paper mode.
    expect(polo.getPositions).not.toHaveBeenCalled();
    expect(polo.getAccountBalance).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('stateReconciliationService ghost recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getExecutionModeMock.mockResolvedValue('auto');
    getAccountBillsMock.mockReset();
    getAccountBillsMock.mockResolvedValue([]);
  });

  it('closes a ghost row and declines the reward when no authoritative bills magnitude exists', async () => {
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
            leverage: 16,
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
    // External-close reward is canonical (always evaluated), so bills ARE
    // fetched — but with no authoritative PNL rows the reward declines
    // (no_bills_pnl), so nothing is published. Bookkeeping close still happens.
    expect(getAccountBillsMock).toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  // ── External-close reward: fires exactly one bills-authoritative reward ──
  it('publishes exactly one external-close reward with the bills magnitude', async () => {
    const entryMs = Date.parse('2026-05-27T08:02:13Z');
    // Two PNL bill rows in the close window → Σ = −1.5 (authoritative).
    getAccountBillsMock.mockResolvedValue([
      { type: 'PNL', sz: '-1.0', symbol: 'ETH_USDT_PERP', cTime: Date.now(), id: 'b1' },
      { type: 'PNL', sz: '-0.5', symbol: 'ETH_USDT_PERP', cTime: Date.now(), id: 'b2' },
    ]);

    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'trade-1',
            symbol: 'ETH_USDT_PERP',
            side: 'buy',
            entry_price: '2077.30',
            quantity: '0.38',
            leverage: 16,
            order_id: 'open-order',
            entry_time: new Date(entryMs),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // performance row
      .mockResolvedValueOnce({
        rows: [
          {
            exit_order_id: null,
            reason: 'monkey|kernel=monkey-swing|agent=K|lane=scalp|src=v0.10',
            agent: 'K',
          },
        ],
      })
      // Close ghost row UPDATE — transitions open→closed (rowCount 1).
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const { stateReconciliationService } = await import('../stateReconciliationService.js');
    const result = await stateReconciliationService.reconcile('user-1');

    expect(result.ghosts).toHaveLength(1);
    expect(getAccountBillsMock).toHaveBeenCalled();
    // Exactly one OUTCOME publish, carrying the bills-authoritative magnitude
    // (single row → 100% qty share → −1.5) and the external-close provenance.
    expect(publishMock).toHaveBeenCalledTimes(1);
    const ev = publishMock.mock.calls[0][0];
    expect(ev.type).toBe('outcome');
    expect(ev.payload.source).toBe('reconciler_recovered:manual_close_user');
    expect(ev.payload.pnlSource).toBe('polo_bills_external_close');
    expect(ev.payload.agent).toBe('K');
    expect(ev.payload.pnl).toBeCloseTo(-1.5, 6);
    // The reviewed knob fix: the published margin is the REAL position margin
    // (entry_price × quantity / leverage = 2077.30 × 0.38 / 16 ≈ 49.336), NOT
    // the retired synthetic 5. The loop.ts subscriber reads this for
    // pnl_fraction = pnl / marginUsdt.
    expect(ev.payload.marginUsdt).toBeCloseTo((2077.30 * 0.38) / 16, 4);
    expect(ev.payload.marginUsdt).not.toBe(5);
  });

  // ── Real margin unavailable → decline (decline-over-guess) ──────────────
  it('declines (no publish) when leverage is missing → real margin unavailable', async () => {
    const entryMs = Date.parse('2026-05-27T08:02:13Z');
    getAccountBillsMock.mockResolvedValue([
      { type: 'PNL', sz: '-1.0', symbol: 'ETH_USDT_PERP', cTime: Date.now(), id: 'b1' },
    ]);

    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'trade-1',
            symbol: 'ETH_USDT_PERP',
            side: 'buy',
            entry_price: '2077.30',
            quantity: '0.38',
            // leverage NULL → margin cannot be derived → decline, do NOT
            // reward at a guessed scale.
            leverage: null,
            order_id: 'open-order',
            entry_time: new Date(entryMs),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            exit_order_id: null,
            reason: 'monkey|kernel=monkey-swing|agent=K|lane=scalp|src=v0.10',
            agent: 'K',
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const { stateReconciliationService } = await import('../stateReconciliationService.js');
    await stateReconciliationService.reconcile('user-1');

    // The row still closes (bookkeeping) but NO reward is published because the
    // real margin (the chemistry scale) is unavailable.
    expect(publishMock).not.toHaveBeenCalled();
  });

  // ── A kernel-own late close is NOT double-rewarded ───────────────────────
  it('does NOT reward a kernel-own late-landing close (post_close_race)', async () => {
    const entryMs = Date.parse('2026-05-27T08:02:13Z');
    getAccountBillsMock.mockResolvedValue([
      { type: 'PNL', sz: '-1.0', symbol: 'ETH_USDT_PERP', cTime: Date.now(), id: 'b1' },
    ]);

    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'trade-1',
            symbol: 'ETH_USDT_PERP',
            side: 'buy',
            entry_price: '2077.30',
            quantity: '0.38',
            leverage: 16,
            order_id: 'open-order',
            entry_time: new Date(entryMs),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      // Ghost ctx: exit_order_id present → kernel's own close landed late →
      // ghostReason = 'reconciled_post_close_race' → reward already fired on
      // the kernel's own path; must NOT be re-rewarded here.
      .mockResolvedValueOnce({
        rows: [
          {
            exit_order_id: 'kernel-close-order',
            reason: 'monkey|kernel=monkey-swing|agent=K|lane=scalp|src=v0.10',
            agent: 'K',
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const { stateReconciliationService } = await import('../stateReconciliationService.js');
    await stateReconciliationService.reconcile('user-1');

    // No external-close reward publish for a kernel-own close.
    expect(publishMock).not.toHaveBeenCalled();
  });
});
