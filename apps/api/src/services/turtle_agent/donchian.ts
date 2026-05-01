/**
 * turtle_agent/donchian.ts — Donchian channel computation.
 *
 * Pure function. Operates on raw OHLCV. No state, no kernel hooks.
 *
 * Turtle System 1 entry/exit signals are based on Donchian channels:
 *
 *   * Entry:  close > rolling N-bar high  (long)
 *             close < rolling N-bar low   (short)
 *   * Exit:   close < rolling M-bar low   (long held)
 *             close > rolling M-bar high  (short held)
 *
 * The classic Turtle parameters are N = 20 (entry) and M = 10 (exit).
 * The "high" / "low" of the channel uses the bars BEFORE the current
 * one — i.e. the close of bar ``i`` is compared against the highest
 * high in bars [i-N..i-1]. This avoids using the current bar's own
 * range to trigger its own entry, which would be lookahead bias.
 *
 * Returned series have the same length as the input. Indices for
 * which the lookback window is incomplete are NaN. Callers should
 * check with ``Number.isFinite`` before using a value.
 */

import type { TurtleOHLCV } from './state.js';

/**
 * Rolling N-bar Donchian high using bars BEFORE the current bar.
 *   highChannel[i] = max(high[i-period..i-1])
 *
 * Indices < ``period`` are NaN (insufficient prior bars).
 */
export function donchianHigh(
  candles: readonly TurtleOHLCV[],
  period: number,
): number[] {
  if (period <= 0) {
    throw new Error(`donchianHigh: period must be > 0 (got ${period})`);
  }
  const n = candles.length;
  const out: number[] = new Array(n).fill(NaN);
  for (let i = period; i < n; i++) {
    let mx = -Infinity;
    for (let j = i - period; j < i; j++) {
      if (candles[j]!.high > mx) mx = candles[j]!.high;
    }
    out[i] = mx;
  }
  return out;
}

/**
 * Rolling N-bar Donchian low using bars BEFORE the current bar.
 *   lowChannel[i] = min(low[i-period..i-1])
 */
export function donchianLow(
  candles: readonly TurtleOHLCV[],
  period: number,
): number[] {
  if (period <= 0) {
    throw new Error(`donchianLow: period must be > 0 (got ${period})`);
  }
  const n = candles.length;
  const out: number[] = new Array(n).fill(NaN);
  for (let i = period; i < n; i++) {
    let mn = Infinity;
    for (let j = i - period; j < i; j++) {
      if (candles[j]!.low < mn) mn = candles[j]!.low;
    }
    out[i] = mn;
  }
  return out;
}

/**
 * Latest Donchian high (channel ending at the most recent bar). Uses
 * bars [n-period..n-1] (i.e. the period bars immediately preceding
 * the latest close). Returns NaN when fewer than ``period`` prior
 * bars exist.
 */
export function latestDonchianHigh(
  candles: readonly TurtleOHLCV[],
  period: number,
): number {
  const n = candles.length;
  if (n < period) return NaN;
  let mx = -Infinity;
  // Last ``period`` bars excluding the current (latest) bar — same
  // semantic as the series formula above. ``candles[n-1]`` is "current".
  // System 1 entry compares current close vs the previous N-bar high.
  for (let j = n - period - 1; j < n - 1; j++) {
    if (j < 0) continue;
    if (candles[j]!.high > mx) mx = candles[j]!.high;
  }
  if (!Number.isFinite(mx)) return NaN;
  return mx;
}

/**
 * Latest Donchian low (channel ending at the most recent bar).
 * Symmetric to ``latestDonchianHigh``.
 */
export function latestDonchianLow(
  candles: readonly TurtleOHLCV[],
  period: number,
): number {
  const n = candles.length;
  if (n < period) return NaN;
  let mn = Infinity;
  for (let j = n - period - 1; j < n - 1; j++) {
    if (j < 0) continue;
    if (candles[j]!.low < mn) mn = candles[j]!.low;
  }
  if (!Number.isFinite(mn)) return NaN;
  return mn;
}
