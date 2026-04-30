/**
 * Locks the close-order body shape across HEDGE and ONE_WAY position-direction
 * modes.
 *
 * Why this test exists:
 *   On 2026-04-30 the live Monkey kernel logged a recurring close failure:
 *
 *     [Monkey] ETH_USDT_PERP [integration] scalp_exit
 *       reason: trailing_harvest: peak 0.764% → now 0.061% < 0.382% floor |
 *               close: close_exchange_rejected: Poloniex /v3/trade/order
 *               returned code=400: Param error  reduceOnly cannot be set
 *               to true in hedge
 *
 *   Trailing-harvest correctly identified a close opportunity, but the
 *   placeOrder body carried `reduceOnly: true` even though the account is
 *   in HEDGE mode. Poloniex v3 forbids reduceOnly in HEDGE — the close
 *   must instead carry `posSide: LONG | SHORT` matching the leg being
 *   reduced. The position kept failing to close and the rejection
 *   repeated on every Monkey cycle.
 *
 *   PoloniexFuturesService.placeOrder now strips `reduceOnly` whenever
 *   the account is in HEDGE mode, inferred from either the explicit
 *   `opts.positionMode` flag or from `opts.posSide` being LONG|SHORT.
 *   In ONE_WAY mode the historical behaviour is preserved (reduceOnly
 *   passes through, posSide defaults to BOTH).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import poloniexFuturesService from '../services/poloniexFuturesService.js';

describe('PoloniexFuturesService.placeOrder — HEDGE close body shape', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('HEDGE close LONG: body has posSide=LONG + side=SELL, no reduceOnly', async () => {
    const spy = vi
      .spyOn(poloniexFuturesService, 'makeRequest')
      .mockResolvedValue({ ordId: 'ord-1' });

    await poloniexFuturesService.placeOrder(
      { apiKey: 'k', apiSecret: 's' },
      {
        symbol: 'ETH_USDT_PERP',
        side: 'sell',
        type: 'market',
        size: 0.1,
        lotSize: 0.01,
        reduceOnly: true,
      },
      { positionMode: 'HEDGE', posSide: 'LONG' },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const [, method, endpoint, body] = spy.mock.calls[0];
    expect(method).toBe('POST');
    expect(endpoint).toBe('/trade/order');
    expect(body.side).toBe('SELL');
    expect(body.posSide).toBe('LONG');
    expect(body).not.toHaveProperty('reduceOnly');
  });

  it('HEDGE close SHORT: body has posSide=SHORT + side=BUY, no reduceOnly', async () => {
    const spy = vi
      .spyOn(poloniexFuturesService, 'makeRequest')
      .mockResolvedValue({ ordId: 'ord-2' });

    await poloniexFuturesService.placeOrder(
      { apiKey: 'k', apiSecret: 's' },
      {
        symbol: 'BTC_USDT_PERP',
        side: 'buy',
        type: 'market',
        size: 0.005,
        lotSize: 0.001,
        reduceOnly: true,
      },
      { positionMode: 'HEDGE', posSide: 'SHORT' },
    );

    const body = spy.mock.calls[0][3];
    expect(body.side).toBe('BUY');
    expect(body.posSide).toBe('SHORT');
    expect(body).not.toHaveProperty('reduceOnly');
  });

  it('HEDGE inferred from posSide alone: still strips reduceOnly', async () => {
    // Caller didn't pass positionMode but did pass posSide=LONG, which is
    // only valid in HEDGE — service must infer and strip reduceOnly.
    const spy = vi
      .spyOn(poloniexFuturesService, 'makeRequest')
      .mockResolvedValue({ ordId: 'ord-3' });

    await poloniexFuturesService.placeOrder(
      { apiKey: 'k', apiSecret: 's' },
      {
        symbol: 'ETH_USDT_PERP',
        side: 'sell',
        type: 'market',
        size: 0.1,
        lotSize: 0.01,
        reduceOnly: true,
      },
      { posSide: 'LONG' },
    );

    const body = spy.mock.calls[0][3];
    expect(body.posSide).toBe('LONG');
    expect(body).not.toHaveProperty('reduceOnly');
  });

  it('ONE_WAY close: body has reduceOnly=true and posSide=BOTH', async () => {
    const spy = vi
      .spyOn(poloniexFuturesService, 'makeRequest')
      .mockResolvedValue({ ordId: 'ord-4' });

    await poloniexFuturesService.placeOrder(
      { apiKey: 'k', apiSecret: 's' },
      {
        symbol: 'ETH_USDT_PERP',
        side: 'sell',
        type: 'market',
        size: 0.1,
        lotSize: 0.01,
        reduceOnly: true,
      },
      { positionMode: 'ONE_WAY' },
    );

    const body = spy.mock.calls[0][3];
    expect(body.side).toBe('SELL');
    expect(body.reduceOnly).toBe(true);
    // ONE_WAY: posSide is either omitted or the literal 'BOTH'. We default
    // to 'BOTH' (Poloniex accepts either; the historical default is BOTH).
    expect(body.posSide).toBe('BOTH');
  });

  it('ONE_WAY default (no opts): body has reduceOnly=true and posSide=BOTH', async () => {
    // No positionMode and no posSide — historical default behaviour
    // must be preserved so legacy callers (FAT SL/TP placements) keep
    // working unchanged.
    const spy = vi
      .spyOn(poloniexFuturesService, 'makeRequest')
      .mockResolvedValue({ ordId: 'ord-5' });

    await poloniexFuturesService.placeOrder(
      { apiKey: 'k', apiSecret: 's' },
      {
        symbol: 'ETH_USDT_PERP',
        side: 'sell',
        type: 'market',
        size: 0.1,
        lotSize: 0.01,
        reduceOnly: true,
      },
    );

    const body = spy.mock.calls[0][3];
    expect(body.reduceOnly).toBe(true);
    expect(body.posSide).toBe('BOTH');
  });

  it('opening order in HEDGE (no reduceOnly): body has posSide and no reduceOnly', async () => {
    // Sanity: an opening market order in HEDGE mode should still pass
    // posSide through unchanged. reduceOnly was never set so there's
    // nothing to strip.
    const spy = vi
      .spyOn(poloniexFuturesService, 'makeRequest')
      .mockResolvedValue({ ordId: 'ord-6' });

    await poloniexFuturesService.placeOrder(
      { apiKey: 'k', apiSecret: 's' },
      {
        symbol: 'BTC_USDT_PERP',
        side: 'buy',
        type: 'market',
        size: 0.005,
        lotSize: 0.001,
      },
      { positionMode: 'HEDGE', posSide: 'LONG' },
    );

    const body = spy.mock.calls[0][3];
    expect(body.side).toBe('BUY');
    expect(body.posSide).toBe('LONG');
    expect(body).not.toHaveProperty('reduceOnly');
  });
});
