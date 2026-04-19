/**
 * Locks the exact body shape sent to POST /v3/position/leverage.
 *
 * Why this test exists:
 *   Poloniex V3 returns `{ code: 400, msg: "Param error lever" }` when the
 *   body uses `leverage`. The correct field name is `lever` (stringified),
 *   alongside `mgnMode` (CROSS|ISOLATED) and optional `posSide`. Prior to
 *   this fix every live-signal tick logged a non-fatal setLeverage failure
 *   right before order placement — noisy and hid the real failure mode if
 *   the exchange ever started rejecting orders because leverage was stale.
 *
 *   See:
 *     - apps/web/src/context/FuturesContext.tsx::setLeverage (already used
 *       `{ symbol, lever, mgnMode }` on the client side)
 *     - shared/constants.ts::FUTURES_DEFAULTS.marginMode = 'CROSS'
 *     - docs/archive/historical/POLONIEX_V3_API_FIXES.md (confirms v3 uses
 *       `lever` and `mgnMode` in responses)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import poloniexFuturesService from '../services/poloniexFuturesService.js';

describe('PoloniexFuturesService.setLeverage body shape', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends { symbol, lever: String(leverage), mgnMode: "CROSS" } by default', async () => {
    const spy = vi
      .spyOn(poloniexFuturesService, 'makeRequest')
      .mockResolvedValue({ lever: '5', mgnMode: 'CROSS' });

    await poloniexFuturesService.setLeverage(
      { apiKey: 'k', apiSecret: 's' },
      'BTC_USDT_PERP',
      5,
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const [, method, endpoint, body] = spy.mock.calls[0];
    expect(method).toBe('POST');
    expect(endpoint).toBe('/position/leverage');
    expect(body).toEqual({
      symbol: 'BTC_USDT_PERP',
      lever: '5',
      mgnMode: 'CROSS',
    });
    // Critical: must NOT send the `leverage` field — that is what produced
    // "Param error lever" on the live API.
    expect(body).not.toHaveProperty('leverage');
    // posSide should be omitted in one-way/BOTH mode unless explicitly set.
    expect(body).not.toHaveProperty('posSide');
  });

  it('stringifies numeric leverage', async () => {
    const spy = vi
      .spyOn(poloniexFuturesService, 'makeRequest')
      .mockResolvedValue({});

    await poloniexFuturesService.setLeverage(
      { apiKey: 'k', apiSecret: 's' },
      'ETH_USDT_PERP',
      20,
    );

    const body = spy.mock.calls[0][3];
    expect(typeof body.lever).toBe('string');
    expect(body.lever).toBe('20');
  });

  it('honors opts.mgnMode override', async () => {
    const spy = vi
      .spyOn(poloniexFuturesService, 'makeRequest')
      .mockResolvedValue({});

    await poloniexFuturesService.setLeverage(
      { apiKey: 'k', apiSecret: 's' },
      'BTC_USDT_PERP',
      3,
      { mgnMode: 'ISOLATED' },
    );

    const body = spy.mock.calls[0][3];
    expect(body.mgnMode).toBe('ISOLATED');
  });

  it('includes posSide only when explicitly provided', async () => {
    const spy = vi
      .spyOn(poloniexFuturesService, 'makeRequest')
      .mockResolvedValue({});

    await poloniexFuturesService.setLeverage(
      { apiKey: 'k', apiSecret: 's' },
      'BTC_USDT_PERP',
      10,
      { posSide: 'LONG' },
    );

    const body = spy.mock.calls[0][3];
    expect(body.posSide).toBe('LONG');
  });
});
