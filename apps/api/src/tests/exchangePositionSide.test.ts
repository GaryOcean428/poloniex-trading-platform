/**
 * Regression: resolveExchangePositionSide must read HEDGE position side
 * from posSide, not qty-sign.
 *
 * 2026-05-14 production incident: after a position was reversed
 * long→short on the exchange, the Monkey kernel logged `held long`
 * while it wanted `short`, could not DCA, and was paralysed. Root
 * cause: `loop.ts` `fetchAccountContext` and `liveSignalEngine` derived
 * side from `qty < 0 ? short : long`. On a HEDGE account (production:
 * MONKEY_SHORTS_LIVE=true) `qty` is a POSITIVE magnitude and the side
 * is in `posSide` — so every HEDGE short was misread as a long.
 */
import { describe, it, expect } from 'vitest';
import { resolveExchangePositionSide } from '../services/exchangePositionSide.js';

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
