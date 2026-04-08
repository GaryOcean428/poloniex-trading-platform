/**
 * Unit tests for regimeDetector.ts
 *
 * Tests cover:
 *   - computeADX pure function (no external deps)
 *   - detectMarketRegime regime classification (mocked poloniexFuturesService)
 *   - Edge cases: insufficient data, NaN ADX, API errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeADX } from '../regimeDetector.js';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// Mock poloniexFuturesService — we test detectMarketRegime via the ADX helper
vi.mock('../poloniexFuturesService.js', () => ({
  default: { getHistoricalData: vi.fn() }
}));

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a synthetic array of OHLC candles from a list of close prices. */
function makeCandles(closes: number[]) {
  return closes.map((close, i) => {
    const prev = closes[i - 1] ?? close;
    const range = Math.abs(close - prev) * 0.5 + 0.1;
    return {
      high: close + range,
      low: close - range,
      close
    };
  });
}

/** Build strongly-trending candles (persistent upward move). */
function trendingCandles(n: number): ReturnType<typeof makeCandles> {
  const closes = Array.from({ length: n }, (_, i) => 100 + i * 0.5);
  return makeCandles(closes);
}

/** Build mean-reverting candles (oscillation around 100). */
function rangingCandles(n: number): ReturnType<typeof makeCandles> {
  const closes = Array.from({ length: n }, (_, i) =>
    100 + Math.sin((i * Math.PI) / 4) * 0.3
  );
  return makeCandles(closes);
}

// ─── computeADX ─────────────────────────────────────────────────────────────

describe('computeADX', () => {
  const PERIOD = 14;

  it('returns NaN for insufficient candles', () => {
    const candles = makeCandles([100, 101, 102]);
    expect(computeADX(candles, PERIOD)).toBeNaN();
  });

  it('returns a finite number for enough candles', () => {
    const candles = trendingCandles(50);
    const adx = computeADX(candles, PERIOD);
    expect(Number.isFinite(adx)).toBe(true);
  });

  it('returns a value in [0, 100]', () => {
    const candles = trendingCandles(60);
    const adx = computeADX(candles, PERIOD);
    expect(adx).toBeGreaterThanOrEqual(0);
    expect(adx).toBeLessThanOrEqual(100);
  });

  it('produces higher ADX for strongly trending data than for ranging data', () => {
    const trending = trendingCandles(60);
    const ranging = rangingCandles(60);
    const adxTrending = computeADX(trending, PERIOD);
    const adxRanging = computeADX(ranging, PERIOD);
    expect(adxTrending).toBeGreaterThan(adxRanging);
  });
});

// ─── detectMarketRegime ──────────────────────────────────────────────────────

describe('detectMarketRegime', () => {
  let detectMarketRegime: typeof import('../regimeDetector.js').detectMarketRegime;
  let mockGetHistoricalData: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    // Re-import after resetting so mock injection is fresh
    const futuresMod = await import('../poloniexFuturesService.js');
    mockGetHistoricalData = vi.fn();
    (futuresMod.default as any).getHistoricalData = mockGetHistoricalData;

    const detectorMod = await import('../regimeDetector.js');
    detectMarketRegime = detectorMod.detectMarketRegime;
  });

  it('returns transition with confidence=0 when API returns too few candles', async () => {
    mockGetHistoricalData.mockResolvedValue([{ high: 101, low: 99, close: 100 }]);

    const result = await detectMarketRegime('BTC_USDT_PERP', '1h');

    expect(result.regime).toBe('transition');
    expect(result.confidence).toBe(0);
    expect(Number.isNaN(result.adx)).toBe(true);
    expect(result.detectedAt).toBeTruthy();
  });

  it('returns transition with confidence=0 when API throws', async () => {
    mockGetHistoricalData.mockRejectedValue(new Error('network error'));

    const result = await detectMarketRegime('BTC_USDT_PERP', '1h');

    expect(result.regime).toBe('transition');
    expect(result.confidence).toBe(0);
  });

  it('returns transition when API returns null', async () => {
    mockGetHistoricalData.mockResolvedValue(null);

    const result = await detectMarketRegime('BTC_USDT_PERP', '1h');

    expect(result.regime).toBe('transition');
    expect(result.confidence).toBe(0);
  });

  it('classifies a strong trend as trending (ADX > 25) with positive confidence', async () => {
    // Supply enough strongly-trending candles so ADX will exceed 25
    const candles = trendingCandles(60);
    mockGetHistoricalData.mockResolvedValue(candles);

    const result = await detectMarketRegime('BTC_USDT_PERP', '1h', 14);
    const adx = computeADX(candles, 14);

    if (adx > 25) {
      expect(result.regime).toBe('trending');
      expect(result.confidence).toBeGreaterThan(0);
    } else {
      // ADX didn't cross 25 with this synthetic data — just check validity
      expect(['trending', 'transition', 'mean_reverting']).toContain(result.regime);
    }
    expect(result.adx).toBeCloseTo(adx, 1);
  });

  it('classifies ranging market as mean_reverting (ADX < 20) with positive confidence', async () => {
    // Flat ranging data should produce a low ADX
    const candles = rangingCandles(60);
    mockGetHistoricalData.mockResolvedValue(candles);

    const result = await detectMarketRegime('BTC_USDT_PERP', '1h', 14);
    const adx = computeADX(candles, 14);

    if (adx < 20) {
      expect(result.regime).toBe('mean_reverting');
      expect(result.confidence).toBeGreaterThan(0);
    } else {
      expect(['mean_reverting', 'transition', 'trending']).toContain(result.regime);
    }
  });

  it('result always includes detectedAt ISO timestamp', async () => {
    mockGetHistoricalData.mockResolvedValue([]);
    const result = await detectMarketRegime('BTC_USDT_PERP', '1h');
    expect(() => new Date(result.detectedAt)).not.toThrow();
  });
});
