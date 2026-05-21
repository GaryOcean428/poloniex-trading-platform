/**
 * Regression: resolveExchangePositionSide must read HEDGE position side
 * from posSide, not qty-sign.
 *
 * 2026-05-14 production incident: after a position was reversed
 * long→short on the exchange, the Monkey kernel logged `held long`
 * while it wanted `short`, could not DCA, and was paralysed. Root
 * cause: `loop.ts` `fetchAccountContext` derived side from
 * `qty < 0 ? short : long`. On a HEDGE account (production:
 * MONKEY_SHORTS_LIVE=true) `qty` is a POSITIVE magnitude and the side
 * is in `posSide` — so every HEDGE short was misread as a long.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveExchangePositionSide,
  resolveExchangePositionNotional,
} from '../services/exchangePositionSide.js';

describe('resolveExchangePositionSide', () => {
  it('HEDGE short — positive qty + posSide=SHORT — is short (the bug case)', () => {
    expect(resolveExchangePositionSide({ posSide: 'SHORT', qty: '61' })).toBe('short');
  });

  it('HEDGE long — positive qty + posSide=LONG — is long', () => {
    expect(resolveExchangePositionSide({ posSide: 'LONG', qty: '297' })).toBe('long');
  });

  it('posSide wins over qty sign — SHORT with positive qty stays short', () => {
    expect(resolveExchangePositionSide({ posSide: 'SHORT', qty: '5' })).toBe('short');
    expect(resolveExchangePositionSide({ posSide: 'LONG', qty: '5' })).toBe('long');
  });

  it('ONE_WAY — no posSide — falls back to qty sign', () => {
    expect(resolveExchangePositionSide({ qty: '-5' })).toBe('short');
    expect(resolveExchangePositionSide({ qty: '5' })).toBe('long');
  });

  it('posSide=BOTH (ONE_WAY) — falls back to qty sign', () => {
    expect(resolveExchangePositionSide({ posSide: 'BOTH', qty: '-3' })).toBe('short');
    expect(resolveExchangePositionSide({ posSide: 'BOTH', qty: '3' })).toBe('long');
  });

  it('reads the qty magnitude from qty / availQty / size', () => {
    expect(resolveExchangePositionSide({ availQty: '-2' })).toBe('short');
    expect(resolveExchangePositionSide({ size: '-2' })).toBe('short');
    expect(resolveExchangePositionSide({ posSide: 'SHORT', size: '2' })).toBe('short');
  });

  it('lowercase posSide is handled (case-insensitive)', () => {
    expect(resolveExchangePositionSide({ posSide: 'short', qty: '10' })).toBe('short');
  });
});

/**
 * Regression: resolveExchangePositionNotional must derive notional from
 * the v3 fields that actually exist (im × lever), NOT `p.notional` /
 * `p.size` — neither of which Poloniex v3 /trade/position/opens emits.
 *
 * 2026-05 bloat incident: checkPerSymbolExposure summed `p.notional`,
 * which read undefined → 0 on every open position, so the per-symbol
 * cap only ever saw the NEW order and the BTC short stacked to ~$7k
 * (≈5× equity), freezing the kernel on margin headroom.
 */
describe('resolveExchangePositionNotional', () => {
  it('derives notional from im × lever (the real v3 BTC short)', () => {
    // Live exchange row 2026-05-15: im 874.0357375, lever 8 → ≈6992.
    expect(
      resolveExchangePositionNotional({ im: '874.0357375', lever: '8', qty: '86' }),
    ).toBeCloseTo(6992.29, 1);
  });

  it('derives notional from im × lever (the real v3 ETH short)', () => {
    expect(
      resolveExchangePositionNotional({ im: '124.7406', lever: '16', qty: '87' }),
    ).toBeCloseTo(1995.85, 1);
  });

  it('the OLD read (p.notional ?? p.size) would have returned 0 — regression guard', () => {
    // v3 positions carry neither field; the resolver must NOT return 0.
    const v3Position = { symbol: 'BTC_USDT_PERP', posSide: 'SHORT', qty: '86', im: '874.04', lever: '8' };
    expect(v3Position).not.toHaveProperty('notional');
    expect(v3Position).not.toHaveProperty('size');
    expect(resolveExchangePositionNotional(v3Position)).toBeGreaterThan(0);
  });

  it('falls back to mgn when im is absent', () => {
    expect(resolveExchangePositionNotional({ mgn: '100', lever: '10' })).toBeCloseTo(1000, 5);
  });

  it('honours a direct notional/value field if present (already-normalized shape)', () => {
    expect(resolveExchangePositionNotional({ notional: '5000' })).toBe(5000);
    expect(resolveExchangePositionNotional({ value: '-5000' })).toBe(5000);
  });

  it('returns 0 only when margin and leverage are both absent', () => {
    expect(resolveExchangePositionNotional({ symbol: 'BTC_USDT_PERP', qty: '86' })).toBe(0);
    expect(resolveExchangePositionNotional({})).toBe(0);
  });

  it('returns 0 for a degenerate zero-leverage row rather than NaN', () => {
    expect(resolveExchangePositionNotional({ im: '100', lever: '0' })).toBe(0);
  });
});
