import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateMarketData, normalizeSymbolToPerp } from '../marketDataValidator.js';

// Mock logger so tests don't produce noise
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// ─── normalizeSymbolToPerp ───────────────────────────────────────────────────

describe('normalizeSymbolToPerp', () => {
  it('leaves BTC_USDT_PERP unchanged', () => {
    expect(normalizeSymbolToPerp('BTC_USDT_PERP')).toBe('BTC_USDT_PERP');
  });

  it('converts BTC_USDT to BTC_USDT_PERP', () => {
    expect(normalizeSymbolToPerp('BTC_USDT')).toBe('BTC_USDT_PERP');
  });

  it('converts BTC-USDT to BTC_USDT_PERP', () => {
    expect(normalizeSymbolToPerp('BTC-USDT')).toBe('BTC_USDT_PERP');
  });

  it('converts BTCUSDTPERP to BTCUSDT_PERP', () => {
    expect(normalizeSymbolToPerp('BTCUSDTPERP')).toBe('BTCUSDT_PERP');
  });

  it('uppercases the result', () => {
    expect(normalizeSymbolToPerp('btc_usdt')).toBe('BTC_USDT_PERP');
  });
});

// ─── validateMarketData ──────────────────────────────────────────────────────

describe('validateMarketData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── valid data ──────────────────────────────────────────────────────────────

  it('returns validated data for a well-formed WebSocket payload', () => {
    const raw = {
      symbol: 'BTC_USDT',
      price: 50000,
      open: 49000,
      high: 51000,
      low: 48000,
      volume: 1234.5,
      timestamp: 1700000000000
    };

    const result = validateMarketData(raw, 'test-ws');

    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('BTC_USDT_PERP');
    expect(result!.price).toBe(50000);
    expect(result!.open).toBe(49000);
    expect(result!.high).toBe(51000);
    expect(result!.low).toBe(48000);
    expect(result!.volume).toBe(1234.5);
    expect(result!.timestamp).toBe(1700000000000);
  });

  it('normalizes BTC-USDT symbol to BTC_USDT_PERP', () => {
    const raw = { symbol: 'BTC-USDT', price: 50000, open: 50000, high: 51000, low: 49000, volume: 100 };
    const result = validateMarketData(raw, 'test');
    expect(result!.symbol).toBe('BTC_USDT_PERP');
  });

  it('uses price fallback chain: markPx -> markPrice -> lastPx', () => {
    const raw = { symbol: 'ETH_USDT', markPx: '3000', high: 3100, low: 2900, open: 2950 };
    const result = validateMarketData(raw, 'rest-ticker');
    expect(result!.price).toBe(3000);
  });

  it('uses close as price fallback', () => {
    const raw = { symbol: 'ETH_USDT', close: 3000, high: 3100, low: 2900, open: 2950 };
    const result = validateMarketData(raw, 'kline');
    expect(result!.price).toBe(3000);
  });

  // ── Poloniex v3 REST ticker (abbreviated field names) ───────────────────────

  it('validates Poloniex v3 /market/tickers shape (abbreviated field names)', () => {
    // Actual response from GET /v3/market/tickers?symbol=BTC_USDT_PERP
    const raw = {
      symbol: 'BTC_USDT_PERP',
      s: 'BTC_USDT_PERP',
      o: '77871.45',
      l: '77420.1',
      h: '79347.93',
      c: '78178',
      qty: '72098',
      mPx: '78190.46',
      bPx: '78177',
      aPx: '78190.05',
    };
    const result = validateMarketData(raw, 'REST ticker v3');
    expect(result).not.toBeNull();
    expect(result!.price).toBe(78178);
    expect(result!.open).toBe(77871.45);
    expect(result!.high).toBe(79347.93);
    expect(result!.low).toBe(77420.1);
    expect(result!.volume).toBe(72098);
  });

  it('prefers long-form `price` over abbreviated `c` when both present', () => {
    const raw = { symbol: 'BTC_USDT', price: 50000, c: '99999', o: 50000, h: 51000, l: 49000 };
    const result = validateMarketData(raw, 'test');
    expect(result!.price).toBe(50000);
  });

  it('prefers long-form `open/high/low` over abbreviated `o/h/l` when both present', () => {
    const raw = { symbol: 'BTC_USDT', price: 50000, open: 49500, o: '99999', high: 51000, h: '1', low: 49000, l: '1' };
    const result = validateMarketData(raw, 'test');
    expect(result!.open).toBe(49500);
    expect(result!.high).toBe(51000);
    expect(result!.low).toBe(49000);
  });

  it('uses `mPx` as a price fallback when only mark price is available', () => {
    const raw = { symbol: 'ETH_USDT', mPx: '3000', h: '3100', l: '2900', o: '2950' };
    const result = validateMarketData(raw, 'test');
    expect(result!.price).toBe(3000);
    expect(result!.high).toBe(3100);
  });

  it('falls back OHLV to price when fields are missing', () => {
    const raw = { symbol: 'BTC_USDT', price: 50000 };
    const result = validateMarketData(raw, 'minimal');
    expect(result!.open).toBe(50000);
    expect(result!.high).toBe(50000);
    expect(result!.low).toBe(50000);
    expect(result!.volume).toBe(0);
  });

  // ── zero price ──────────────────────────────────────────────────────────────

  it('returns null for zero price', () => {
    const raw = { symbol: 'BTC_USDT', price: 0, open: 0, high: 0, low: 0, volume: 0 };
    expect(validateMarketData(raw, 'test')).toBeNull();
  });

  it('returns null when parseFloat gives 0 (empty string fallback)', () => {
    const raw = { symbol: 'BTC_USDT', markPx: '', markPrice: '', lastPx: '', price: '' };
    expect(validateMarketData(raw, 'test')).toBeNull();
  });

  // ── NaN price ───────────────────────────────────────────────────────────────

  it('returns null for NaN price', () => {
    const raw = { symbol: 'BTC_USDT', price: NaN };
    expect(validateMarketData(raw, 'test')).toBeNull();
  });

  it('returns null when price field is a non-numeric string', () => {
    const raw = { symbol: 'BTC_USDT', price: 'not-a-number' };
    expect(validateMarketData(raw, 'test')).toBeNull();
  });

  // ── missing fields ──────────────────────────────────────────────────────────

  it('returns null when symbol is missing', () => {
    const raw = { price: 50000, open: 49000, high: 51000, low: 48000 };
    expect(validateMarketData(raw as Record<string, unknown>, 'test')).toBeNull();
  });

  it('returns null when all price fields are missing', () => {
    const raw = { symbol: 'BTC_USDT', open: 50000, high: 51000, low: 49000 };
    expect(validateMarketData(raw, 'test')).toBeNull();
  });

  // ── OHLC consistency ────────────────────────────────────────────────────────

  it('returns null when high < low', () => {
    const raw = { symbol: 'BTC_USDT', price: 50000, open: 50000, high: 49000, low: 51000 };
    expect(validateMarketData(raw, 'test')).toBeNull();
  });

  it('returns null when high < price (close)', () => {
    const raw = { symbol: 'BTC_USDT', price: 52000, open: 50000, high: 51000, low: 49000 };
    expect(validateMarketData(raw, 'test')).toBeNull();
  });

  // ── wrong symbol format ─────────────────────────────────────────────────────

  it('normalises BTC_USDT (no PERP) to BTC_USDT_PERP', () => {
    const raw = { symbol: 'BTC_USDT', price: 50000, high: 51000, low: 49000 };
    const result = validateMarketData(raw, 'test');
    expect(result!.symbol).toBe('BTC_USDT_PERP');
  });

  it('handles lowercase symbols', () => {
    const raw = { symbol: 'eth-usdt', price: 3000, high: 3100, low: 2900 };
    const result = validateMarketData(raw, 'test');
    expect(result!.symbol).toBe('ETH_USDT_PERP');
  });
});
