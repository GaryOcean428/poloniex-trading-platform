/**
 * Tests for the POST /api/futures/leverage HEDGE-mode posSide plumbing.
 *
 * Background: same root cause as the LiveSignalEngine + Monkey kernel
 * fixes — Poloniex /v3/position/leverage rejects the call with code=11011
 * ("Position mode and posSide do not match") on a HEDGE account when the
 * body omits posSide. This route is the manual UI path (the dashboard
 * leverage slider POSTs to it), so users hit the error every time they
 * tried to change leverage post-PR-#611 HEDGE flip.
 *
 * Resolution order in the route:
 *   1. Caller-supplied `posSide` or `side` in body → honour verbatim.
 *   2. HEDGE account + open position → derive from `Math.sign(qty)`.
 *   3. ONE_WAY account → omit posSide (exchange defaults to BOTH).
 *
 * Coverage:
 *   1. Caller passes posSide=LONG → forwarded to setLeverage.
 *   2. HEDGE + existing short position (qty<0) → posSide=SHORT derived
 *      from qty-sign; setLeverage receives it.
 *   3. ONE_WAY mode → setLeverage receives no posSide (empty opts).
 *   4. HEDGE + no open position + no caller posSide → 400 with helpful
 *      message (can't guess which lane to apply leverage to).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../middleware/auth.js', () => ({
  // Pass-through middleware so the route handler is invoked directly.
  authenticateToken: (req: Request & { user?: { id: string } }, _res: Response, next: () => void) => {
    req.user = { id: 'test-user' };
    next();
  },
}));
vi.mock('../services/apiCredentialsService.js', () => ({
  apiCredentialsService: {
    getCredentials: vi.fn().mockResolvedValue({ apiKey: 'k', apiSecret: 's' }),
  },
}));
vi.mock('../services/poloniexFuturesService.js', () => ({
  default: {
    setLeverage: vi.fn().mockResolvedValue({ ok: true }),
    getPositionDirectionMode: vi.fn(),
    getPositions: vi.fn(),
  },
}));

import futuresRouter from '../routes/futures.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';

/**
 * Locate the POST /leverage handler from the router stack so we can
 * invoke it directly with mock req/res (no supertest needed).
 */
function findLeverageHandler(): (req: Request, res: Response) => Promise<void> | void {
  // express.Router exposes a `.stack` of layers; each layer has `.route`
  // for routed handlers. Walk it to find the POST /leverage handler.
  const stack = (futuresRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: Request, res: Response) => Promise<void> | void }> } }> }).stack;
  for (const layer of stack) {
    const route = layer.route;
    if (route && route.path === '/leverage' && route.methods.post) {
      // The handler chain is [authenticateToken, routeHandler]; the last
      // layer's `.handle` is the actual route handler we wrote.
      const last = route.stack[route.stack.length - 1];
      return last.handle.bind(last);
    }
  }
  throw new Error('POST /leverage handler not found in router stack');
}

const handler = findLeverageHandler();

/** Build a Response mock that records status + json calls. */
function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

/** Build a Request mock with `.user` already populated (auth bypassed). */
function mockReq(body: Record<string, unknown>) {
  return { user: { id: 'test-user' }, body } as unknown as Request;
}

describe('POST /api/futures/leverage — HEDGE-mode posSide handling', () => {
  beforeEach(() => {
    vi.mocked(poloniexFuturesService.setLeverage).mockClear().mockResolvedValue({ ok: true } as never);
    vi.mocked(poloniexFuturesService.getPositionDirectionMode).mockReset();
    vi.mocked(poloniexFuturesService.getPositions).mockReset();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Caller-supplied posSide → forwarded verbatim.
  //
  // (Mode probe + position lookup short-circuited; this is the path the
  //  client uses when it already knows which lane to apply leverage to.)
  // ──────────────────────────────────────────────────────────────────────────
  it('caller-supplied posSide=LONG → forwarded to setLeverage', async () => {
    const res = mockRes();
    await handler(mockReq({ symbol: 'BTC_USDT_PERP', leverage: 10, posSide: 'LONG' }), res);

    expect(poloniexFuturesService.setLeverage).toHaveBeenCalledTimes(1);
    const [, , , opts] = vi.mocked(poloniexFuturesService.setLeverage).mock.calls[0];
    expect(opts).toEqual({ posSide: 'LONG' });
    expect(res.statusCode).toBe(200);
    // Mode probe should NOT have been called when caller already gave us
    // posSide — small but real latency win on the manual-UI path.
    expect(poloniexFuturesService.getPositionDirectionMode).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. HEDGE + open SHORT (qty<0) → posSide=SHORT derived from qty sign.
  //
  // This is the dashboard-slider use case: user wants to bump leverage on
  // an existing short. We probe the mode, find HEDGE, find the open
  // position, and derive posSide from `Math.sign(qty)` (same authoritative
  // pattern as stateReconciliationService.ts:152).
  // ──────────────────────────────────────────────────────────────────────────
  it('HEDGE + existing SHORT (qty<0) → setLeverage gets posSide=SHORT', async () => {
    vi.mocked(poloniexFuturesService.getPositionDirectionMode).mockResolvedValue({ posMode: 'HEDGE' } as never);
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([
      { symbol: 'ETH_USDT_PERP', qty: '-0.05' },
    ] as never);

    const res = mockRes();
    await handler(mockReq({ symbol: 'ETH_USDT_PERP', leverage: 20 }), res);

    expect(poloniexFuturesService.setLeverage).toHaveBeenCalledTimes(1);
    const [, , , opts] = vi.mocked(poloniexFuturesService.setLeverage).mock.calls[0];
    expect(opts).toEqual({ posSide: 'SHORT' });
    expect(res.statusCode).toBe(200);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. ONE_WAY mode → setLeverage receives empty opts.
  //
  // The historic ONE_WAY-on-prod wire shape is `{ symbol, lever, mgnMode }`
  // with no posSide. Sending posSide on a ONE_WAY account gives the same
  // 11011 error in reverse, so we explicitly omit.
  // ──────────────────────────────────────────────────────────────────────────
  it('ONE_WAY mode → setLeverage gets empty opts (no posSide)', async () => {
    vi.mocked(poloniexFuturesService.getPositionDirectionMode).mockResolvedValue({ posMode: 'ONE_WAY' } as never);

    const res = mockRes();
    await handler(mockReq({ symbol: 'BTC_USDT_PERP', leverage: 5 }), res);

    expect(poloniexFuturesService.setLeverage).toHaveBeenCalledTimes(1);
    const [, , , opts] = vi.mocked(poloniexFuturesService.setLeverage).mock.calls[0];
    expect(opts).toEqual({});
    expect(opts).not.toHaveProperty('posSide');
    expect(res.statusCode).toBe(200);
    // We never need to look up positions on ONE_WAY accounts.
    expect(poloniexFuturesService.getPositions).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. HEDGE + no open position + no caller posSide → 400.
  //
  // The exchange has no way to know which lane to apply leverage to, and
  // we refuse to guess (guessing produces silent leverage drift on the
  // wrong side of the book).
  // ──────────────────────────────────────────────────────────────────────────
  it('HEDGE + no open position + no caller side → 400 with helpful message', async () => {
    vi.mocked(poloniexFuturesService.getPositionDirectionMode).mockResolvedValue({ posMode: 'HEDGE' } as never);
    vi.mocked(poloniexFuturesService.getPositions).mockResolvedValue([] as never);

    const res = mockRes();
    await handler(mockReq({ symbol: 'BTC_USDT_PERP', leverage: 5 }), res);

    expect(res.statusCode).toBe(400);
    expect(poloniexFuturesService.setLeverage).not.toHaveBeenCalled();
    expect((res.body as { hedgeMode?: boolean }).hedgeMode).toBe(true);
    expect((res.body as { error: string }).error).toMatch(/HEDGE/);
  });
});
