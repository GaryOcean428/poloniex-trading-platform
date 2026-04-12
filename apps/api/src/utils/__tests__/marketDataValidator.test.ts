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
