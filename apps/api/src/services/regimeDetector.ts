/**
 * Market Regime Detector
 *
 * Classifies the current market state as one of three regimes inspired by
 * the QIG three-regime phase diagram:
 *   - 'trending'      (κ > 0 — ordered, directional price movement, ADX > 25)
 *   - 'mean_reverting' (κ < 0 — disordered, range-bound, ADX < 20)
 *   - 'transition'    (κ ≈ 0 — boundary state, indeterminate, 20 ≤ ADX ≤ 25)
 *
 * Current implementation uses ADX as the discriminator.  The interface is
 * structured so that a Fisher-information–based classifier can be plugged in
 * later (replace the body of `detectMarketRegime` while keeping the same
 * signature and return type).
 *
 * QIG insight: the disordered (mean-reverting) regime produces 170× larger
 * moves than the ordered (trending) regime.  Strategies should therefore
 * allocate *more* capital to mean-reversion when that regime is active.
 */

import { logger } from '../utils/logger.js';
import poloniexFuturesService from './poloniexFuturesService.js';

export type MarketRegime = 'trending' | 'mean_reverting' | 'transition';

export interface RegimeResult {
  /** Coarse regime label */
  regime: MarketRegime;
  /** ADX value used for this classification (NaN when unavailable) */
  adx: number;
  /** [0-1] how confidently the regime is identified */
  confidence: number;
  /** ISO timestamp of the classification */
  detectedAt: string;
}

// ---------------------------------------------------------------------------
// ADX computation helpers (no external dependency)
// ---------------------------------------------------------------------------

interface OHLCCandle {
  high: number;
  low: number;
  close: number;
}

/** Wilder's smoothed moving average (used internally by ADX). */
function wilderSmooth(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const smoothed: number[] = [];
  // Seed with simple average of first `period` values
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  smoothed.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    smoothed.push(prev);
  }
  return smoothed;
}

/**
 * Compute the Average Directional Index (ADX) for the given candles.
 * Returns NaN when there is insufficient data.
 */
export function computeADX(candles: OHLCCandle[], period = 14): number {
  if (candles.length < period * 2) return NaN;

  const trueRanges: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];

    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );

    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trueRanges.push(tr);
  }

  const atr = wilderSmooth(trueRanges, period);
  const pDI = wilderSmooth(plusDM, period);
  const mDI = wilderSmooth(minusDM, period);

  if (atr.length === 0) return NaN;

  const dx: number[] = atr.map((atrVal, i) => {
    const pdi = atr[i] > 0 ? (pDI[i] / atrVal) * 100 : 0;
    const mdi = atr[i] > 0 ? (mDI[i] / atrVal) * 100 : 0;
    const sum = pdi + mdi;
    return sum > 0 ? (Math.abs(pdi - mdi) / sum) * 100 : 0;
  });

  const adxValues = wilderSmooth(dx, period);
  return adxValues.length > 0 ? adxValues[adxValues.length - 1] : NaN;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify the current market regime for the given symbol and timeframe.
 *
 * ADX thresholds (standard Wilder interpretation):
 *   ADX > 25  → trending
 *   ADX < 20  → mean_reverting
 *   20-25     → transition
 *
 * Confidence is derived from how far the ADX sits from each boundary.
 *
 * @param symbol    Futures symbol in BASE_QUOTE_PERP format (e.g. BTC_USDT_PERP)
 * @param timeframe Candle interval (e.g. '1h', '4h')
 * @param period    ADX period (default 14)
 * @returns         Resolved regime classification
 */
export async function detectMarketRegime(
  symbol: string,
  timeframe: string,
  period = 14
): Promise<RegimeResult> {
  try {
    // Fetch enough candles for a reliable ADX: 2 × period + small buffer
    const limit = period * 2 + 10;
    const rawCandles = await poloniexFuturesService.getHistoricalData(
      symbol,
      timeframe,
      limit
    );

    if (!Array.isArray(rawCandles) || rawCandles.length < period * 2) {
      logger.warn(
        `regimeDetector: insufficient candles for ${symbol} (${rawCandles?.length ?? 0}/${period * 2}). Defaulting to transition.`
      );
      return {
        regime: 'transition',
        adx: NaN,
        confidence: 0,
        detectedAt: new Date().toISOString()
      };
    }

    const candles: OHLCCandle[] = rawCandles.map((c: any) => ({
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close)
    }));

    const adx = computeADX(candles, period);

    if (!Number.isFinite(adx)) {
      logger.warn(`regimeDetector: ADX computation returned NaN for ${symbol}. Defaulting to transition.`);
      return {
        regime: 'transition',
        adx: NaN,
        confidence: 0,
        detectedAt: new Date().toISOString()
      };
    }

    let regime: MarketRegime;
    let confidence: number;

    if (adx > 25) {
      regime = 'trending';
      // Full confidence at ADX = 50, half at the boundary (25)
      confidence = Math.min((adx - 25) / 25, 1);
    } else if (adx < 20) {
      regime = 'mean_reverting';
      // Full confidence at ADX = 0, half at the boundary (20)
      confidence = Math.min((20 - adx) / 20, 1);
    } else {
      regime = 'transition';
      // Confidence in "transition" is highest at the midpoint (22.5) and
      // decreases toward either boundary.
      const distFromMid = Math.abs(adx - 22.5);
      confidence = Math.max(0, 1 - distFromMid / 2.5);
    }

    logger.info(
      `regimeDetector: ${symbol} (${timeframe}) → ${regime} (ADX=${adx.toFixed(1)}, conf=${confidence.toFixed(2)})`
    );

    return {
      regime,
      adx,
      confidence,
      detectedAt: new Date().toISOString()
    };
  } catch (error: any) {
    logger.error(`regimeDetector: error classifying ${symbol} (${timeframe}):`, error);
    return {
      regime: 'transition',
      adx: NaN,
      confidence: 0,
      detectedAt: new Date().toISOString()
    };
  }
}
