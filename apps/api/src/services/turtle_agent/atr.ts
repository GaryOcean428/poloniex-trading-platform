/**
 * turtle_agent/atr.ts — Average True Range (Wilder).
 *
 * Pure function. Operates on raw OHLCV. No state, no kernel hooks.
 *
 * Wilder's ATR uses a smoothed moving average (RMA) of the per-bar
 * true-range. The Turtle System 1 reference uses ATR(20) for the
 * 2× ATR stop, the 0.5× ATR pyramid step, and the position-size
 * denominator. We compute the seed via simple-mean of the first
 * ``period`` true ranges, then apply Wilder smoothing thereafter:
 *
 *     atr_n = ((period - 1) * atr_{n-1} + tr_n) / period
 *
 * True range for bar n:
 *
 *     tr_n = max(
 *       high_n - low_n,
 *       abs(high_n - close_{n-1}),
 *       abs(low_n  - close_{n-1}),
 *     )
 *
 * The first bar has no prior close → tr_0 = high_0 - low_0.
 *
 * Returned series has the same length as the input. Indices < period - 1
 * (where the seed window is incomplete) are NaN. Callers should check
 * with ``Number.isFinite`` before using a value.
 */

import type { TurtleOHLCV } from './state.js';

/** Compute the per-bar true-range series. tr[0] = high[0] - low[0]. */
export function trueRange(candles: readonly TurtleOHLCV[]): number[] {
  const out: number[] = new Array(candles.length).fill(0);
  if (candles.length === 0) return out;
  out[0] = candles[0]!.high - candles[0]!.low;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    const a = c.high - c.low;
    const b = Math.abs(c.high - prevClose);
    const d = Math.abs(c.low - prevClose);
    out[i] = Math.max(a, b, d);
  }
  return out;
}

/**
 * Wilder ATR series of length ``candles.length``. Indices before
 * ``period - 1`` are NaN. Index ``period - 1`` is the simple-mean
 * seed of TR[0..period-1]. Subsequent indices use Wilder smoothing.
 */
export function atrSeries(
  candles: readonly TurtleOHLCV[],
  period: number,
): number[] {
  if (period <= 0) {
    throw new Error(`atrSeries: period must be > 0 (got ${period})`);
  }
  const n = candles.length;
  const out: number[] = new Array(n).fill(NaN);
  if (n < period) return out;
  const tr = trueRange(candles);
  // Seed: simple mean of the first `period` TR values.
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  out[period - 1] = sum / period;
  // Wilder smoothing.
  for (let i = period; i < n; i++) {
    out[i] = (out[i - 1]! * (period - 1) + tr[i]!) / period;
  }
  return out;
}

/**
 * Convenience: ATR at the most recent bar. Returns NaN when the
 * series has fewer than ``period`` candles.
 */
export function latestAtr(
  candles: readonly TurtleOHLCV[],
  period: number,
): number {
  const series = atrSeries(candles, period);
  return series.length === 0 ? NaN : series[series.length - 1]!;
}
