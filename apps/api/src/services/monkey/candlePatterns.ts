/**
 * candlePatterns.ts — OHLCV pattern recognition (proposal #9).
 *
 * TypeScript parity to ``ml-worker/src/monkey_kernel/candle_patterns.py``.
 * Same detector set, same strength-in-[0,1] semantics.
 *
 * Two integration paths (mirror Python):
 *   1. ``patternSignalScalar(reading)`` — feeds a signed scalar
 *      pattern observation into the perception layer.
 *   2. ``hammerAgainstLongSl(candles)`` — SL-defer signal: defer
 *      a long-position SL fire by N ticks when a hammer is detected.
 */

export type PatternDirection = -1 | 0 | 1;

export interface PatternReading {
  patternName: string;
  strength: number;       // [0, 1]
  direction: PatternDirection;
}

export interface OHLCVRow {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const NONE: PatternReading = { patternName: 'none', strength: 0, direction: 0 };

function asRow(c: any): OHLCVRow {
  return {
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume ?? 0),
  };
}

function rowMetrics(c: OHLCVRow) {
  const range = Math.max(c.high - c.low, 1e-12);
  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  return {
    range, body, upperWick, lowerWick,
    bodyRatio: body / range,
    upperRatio: upperWick / range,
    lowerRatio: lowerWick / range,
    isBullish: c.close > c.open,
    isBearish: c.close < c.open,
  };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ── Single-candle ────────────────────────────────────────────────

export function detectHammer(candles: any[]): PatternReading {
  if (!candles.length) return NONE;
  const c = asRow(candles[candles.length - 1]);
  const m = rowMetrics(c);
  if (m.range <= 1e-12) return NONE;
  if (m.bodyRatio > 0.4) return { patternName: 'hammer', strength: 0, direction: 0 };
  if (m.lowerRatio < 0.55 || m.upperRatio > 0.15) {
    return { patternName: 'hammer', strength: 0, direction: 0 };
  }
  let strength = clamp01((m.lowerRatio - 0.55) / 0.45);
  if (candles.length >= 6) {
    const prev = candles.slice(-6, -1).map((x) => asRow(x).close);
    if (prev[prev.length - 1]! < prev[0]!) strength = Math.min(1, strength * 1.2);
  }
  return { patternName: 'hammer', strength, direction: 1 };
}

export function detectInvertedHammer(candles: any[]): PatternReading {
  if (!candles.length) return NONE;
  const c = asRow(candles[candles.length - 1]);
  const m = rowMetrics(c);
  if (m.range <= 1e-12) return NONE;
  if (m.bodyRatio > 0.4 || m.upperRatio < 0.55 || m.lowerRatio > 0.15) {
    return { patternName: 'inverted_hammer', strength: 0, direction: 0 };
  }
  let strength = clamp01((m.upperRatio - 0.55) / 0.45);
  if (candles.length >= 6) {
    const prev = candles.slice(-6, -1).map((x) => asRow(x).close);
    if (prev[prev.length - 1]! < prev[0]!) strength = Math.min(1, strength * 1.2);
  }
  return { patternName: 'inverted_hammer', strength, direction: 1 };
}

export function detectShootingStar(candles: any[]): PatternReading {
  if (!candles.length) return NONE;
  const c = asRow(candles[candles.length - 1]);
  const m = rowMetrics(c);
  if (m.range <= 1e-12) return NONE;
  if (m.bodyRatio > 0.4 || m.upperRatio < 0.55 || m.lowerRatio > 0.15) {
    return { patternName: 'shooting_star', strength: 0, direction: 0 };
  }
  if (candles.length < 6) return { patternName: 'shooting_star', strength: 0, direction: 0 };
  const prev = candles.slice(-6, -1).map((x) => asRow(x).close);
  if (prev[prev.length - 1]! <= prev[0]!) {
    return { patternName: 'shooting_star', strength: 0, direction: 0 };
  }
  const strength = clamp01((m.upperRatio - 0.55) / 0.45);
  return { patternName: 'shooting_star', strength, direction: -1 };
}

export function detectHangingMan(candles: any[]): PatternReading {
  if (!candles.length) return NONE;
  const c = asRow(candles[candles.length - 1]);
  const m = rowMetrics(c);
  if (m.range <= 1e-12) return NONE;
  if (m.bodyRatio > 0.4 || m.lowerRatio < 0.55 || m.upperRatio > 0.15) {
    return { patternName: 'hanging_man', strength: 0, direction: 0 };
  }
  if (candles.length < 6) return { patternName: 'hanging_man', strength: 0, direction: 0 };
  const prev = candles.slice(-6, -1).map((x) => asRow(x).close);
  if (prev[prev.length - 1]! <= prev[0]!) {
    return { patternName: 'hanging_man', strength: 0, direction: 0 };
  }
  const strength = clamp01((m.lowerRatio - 0.55) / 0.45);
  return { patternName: 'hanging_man', strength, direction: -1 };
}

export function detectDoji(candles: any[]): PatternReading {
  if (!candles.length) return NONE;
  const c = asRow(candles[candles.length - 1]);
  const m = rowMetrics(c);
  if (m.range <= 1e-12) return NONE;
  if (m.bodyRatio > 0.10) return { patternName: 'doji', strength: 0, direction: 0 };
  const strength = clamp01(1 - m.bodyRatio / 0.10);
  return { patternName: 'doji', strength, direction: 0 };
}

// ── Two-candle ────────────────────────────────────────────────────

export function detectBullishEngulfing(candles: any[]): PatternReading {
  if (candles.length < 2) return NONE;
  const prev = asRow(candles[candles.length - 2]);
  const curr = asRow(candles[candles.length - 1]);
  if (!(prev.close < prev.open) || !(curr.close > curr.open)) {
    return { patternName: 'bullish_engulfing', strength: 0, direction: 0 };
  }
  if (curr.open > prev.close || curr.close < prev.open) {
    return { patternName: 'bullish_engulfing', strength: 0, direction: 0 };
  }
  const prevBody = Math.max(Math.abs(prev.close - prev.open), 1e-12);
  const a = (curr.close - prev.open) / prevBody;
  const b = (prev.close - curr.open) / prevBody;
  const strength = clamp01((a + b) / 4);
  return { patternName: 'bullish_engulfing', strength, direction: 1 };
}

export function detectBearishEngulfing(candles: any[]): PatternReading {
  if (candles.length < 2) return NONE;
  const prev = asRow(candles[candles.length - 2]);
  const curr = asRow(candles[candles.length - 1]);
  if (!(prev.close > prev.open) || !(curr.close < curr.open)) {
    return { patternName: 'bearish_engulfing', strength: 0, direction: 0 };
  }
  if (curr.open < prev.close || curr.close > prev.open) {
    return { patternName: 'bearish_engulfing', strength: 0, direction: 0 };
  }
  const prevBody = Math.max(Math.abs(prev.close - prev.open), 1e-12);
  const a = (prev.open - curr.close) / prevBody;
  const b = (curr.open - prev.close) / prevBody;
  const strength = clamp01((a + b) / 4);
  return { patternName: 'bearish_engulfing', strength, direction: -1 };
}

// ── Three-candle ──────────────────────────────────────────────────

export function detectMorningStar(candles: any[]): PatternReading {
  if (candles.length < 3) return NONE;
  const a = asRow(candles[candles.length - 3]);
  const b = asRow(candles[candles.length - 2]);
  const c = asRow(candles[candles.length - 1]);
  if (!(a.close < a.open) || !(c.close > c.open)) {
    return { patternName: 'morning_star', strength: 0, direction: 0 };
  }
  const bMetrics = rowMetrics(b);
  if (bMetrics.bodyRatio > 0.30) {
    return { patternName: 'morning_star', strength: 0, direction: 0 };
  }
  const midpoint = (a.open + a.close) / 2;
  if (c.close <= midpoint) {
    return { patternName: 'morning_star', strength: 0, direction: 0 };
  }
  const aBody = Math.max(Math.abs(a.close - a.open), 1e-12);
  const strength = clamp01((c.close - midpoint) / aBody);
  return { patternName: 'morning_star', strength, direction: 1 };
}

export function detectEveningStar(candles: any[]): PatternReading {
  if (candles.length < 3) return NONE;
  const a = asRow(candles[candles.length - 3]);
  const b = asRow(candles[candles.length - 2]);
  const c = asRow(candles[candles.length - 1]);
  if (!(a.close > a.open) || !(c.close < c.open)) {
    return { patternName: 'evening_star', strength: 0, direction: 0 };
  }
  const bMetrics = rowMetrics(b);
  if (bMetrics.bodyRatio > 0.30) {
    return { patternName: 'evening_star', strength: 0, direction: 0 };
  }
  const midpoint = (a.open + a.close) / 2;
  if (c.close >= midpoint) {
    return { patternName: 'evening_star', strength: 0, direction: 0 };
  }
  const aBody = Math.max(Math.abs(a.close - a.open), 1e-12);
  const strength = clamp01((midpoint - c.close) / aBody);
  return { patternName: 'evening_star', strength, direction: -1 };
}

// ── Aggregator ────────────────────────────────────────────────────

const DETECTORS: Array<(c: any[]) => PatternReading> = [
  detectMorningStar,
  detectEveningStar,
  detectBullishEngulfing,
  detectBearishEngulfing,
  detectHammer,
  detectInvertedHammer,
  detectShootingStar,
  detectHangingMan,
  detectDoji,
];

export function detectStrongest(candles: any[]): PatternReading {
  let best: PatternReading = { patternName: 'none', strength: 0, direction: 0 };
  for (const det of DETECTORS) {
    const r = det(candles);
    if (r.strength > best.strength) best = r;
  }
  return best;
}

// ── Integration helpers ──────────────────────────────────────────

export function patternSignalScalar(reading: PatternReading): number {
  return reading.direction * reading.strength;
}

/** Path 2 — SL defer signal. Returns true when a strong hammer or
 *  inverted-hammer is on the latest candle. Caller (loop.ts SL-fire
 *  path) defers the SL by N ticks (default 2) when this fires for
 *  a long position.
 */
export function hammerAgainstLongSl(candles: any[]): boolean {
  const h = detectHammer(candles);
  const ih = detectInvertedHammer(candles);
  return (h.strength > 0.5 && h.direction > 0)
    || (ih.strength > 0.5 && ih.direction > 0);
}
