import { MarketData } from "@/types";

export interface TechnicalIndicatorResult {
  values: number[];
  currentValue: number;
  previousValue: number;
  signal?: "BUY" | "SELL" | "HOLD";
  strength?: number;
}

export function calculateSMA(data: MarketData[], period: number): TechnicalIndicatorResult {
  const prices = data.map((candle) => candle.close);
  const values: number[] = [];

  if (prices.length < period) {
    throw new Error(`Insufficient data: need ${period} candles`);
  }

  let sum = prices.slice(0, period).reduce((a, b) => a + b, 0);
  values.push(sum / period);

  for (let i = period; i < prices.length; i++) {
    const leaving = prices[i - period] ?? 0;
    const entering = prices[i] ?? leaving;
    sum = sum - leaving + entering;
    values.push(sum / period);
  }

  const currentValue = values[values.length - 1] ?? 0;
  const previousValue = values[values.length - 2] ?? currentValue;
  const denom = currentValue === 0 ? 1 : currentValue;

  return {
    values,
    currentValue,
    previousValue,
    signal: currentValue > previousValue ? "BUY" : currentValue < previousValue ? "SELL" : "HOLD",
    strength: Math.abs(currentValue - previousValue) / denom,
  };
}

export function calculateEMA(data: MarketData[], period: number): TechnicalIndicatorResult {
  const prices = data.map((candle) => candle.close);
  const values: number[] = [];
  const smoothing = 2 / (period + 1);

  if (prices.length < period) {
    throw new Error(`Insufficient data: need ${period} candles`);
  }

  const initialSMA = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  values.push(initialSMA);

  for (let i = period; i < prices.length; i++) {
    const price = prices[i] ?? prices[i - 1] ?? initialSMA;
    const prev = values[values.length - 1] ?? initialSMA;
    const ema = price * smoothing + prev * (1 - smoothing);
    values.push(ema);
  }

  const currentValue = values[values.length - 1] ?? initialSMA;
  const previousValue = values[values.length - 2] ?? currentValue;
  const denom = currentValue === 0 ? 1 : currentValue;

  return {
    values,
    currentValue,
    previousValue,
    signal: currentValue > previousValue ? "BUY" : currentValue < previousValue ? "SELL" : "HOLD",
    strength: Math.abs(currentValue - previousValue) / denom,
  };
}

export function calculateRSI(data: MarketData[], period: number = 14): TechnicalIndicatorResult {
  const prices = data.map((candle) => candle.close);
  const values: number[] = [];

  if (prices.length < period + 1) {
    throw new Error(`Insufficient data: need ${period + 1} candles`);
  }

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const curr = prices[i] ?? prices[i - 1] ?? 0;
    const prev = prices[i - 1] ?? curr;
    changes.push(curr - prev);
  }

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < period; i++) {
    const ch = changes[i] ?? 0;
    if (ch > 0) {
      avgGain += ch;
    } else {
      avgLoss += Math.abs(ch);
    }
  }

  avgGain /= period;
  avgLoss /= period;

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  values.push(100 - 100 / (1 + rs));

  for (let i = period; i < changes.length; i++) {
    const change = changes[i] ?? 0;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    values.push(100 - 100 / (1 + rs));
  }

  const currentValue = values[values.length - 1] ?? 50;
  const previousValue = values[values.length - 2] ?? currentValue;

  let signal: "BUY" | "SELL" | "HOLD" = "HOLD";
  let strength = 0;

  if (currentValue < 30 && previousValue < currentValue) {
    signal = "BUY";
    strength = (30 - currentValue) / 30;
  } else if (currentValue > 70 && previousValue > currentValue) {
    signal = "SELL";
    strength = (currentValue - 70) / 30;
  }

  return {
    values,
    currentValue,
    previousValue,
    signal,
    strength,
  };
}

export function calculateMACD(
  data: MarketData[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): {
  macd: number[];
  signal: number[];
  histogram: number[];
  currentSignal: "BULLISH" | "BEARISH" | "NEUTRAL";
} {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);

  const macd: number[] = [];
  const startIndex = slowPeriod - fastPeriod;
  // Build MACD only when both EMA samples are available
  for (let i = startIndex; i < fastEMA.values.length; i++) {
    const fast = fastEMA.values[i];
    const slow = slowEMA.values[i - startIndex];
    if (fast === undefined || slow === undefined) continue;
    macd.push(fast - slow);
  }

  const signal: number[] = [];
  const smoothing = 2 / (signalPeriod + 1);

  if (macd.length < signalPeriod) {
    throw new Error(`Insufficient data for MACD signal: need ${signalPeriod} macd samples`);
  }

  const initialSignalSMA = macd.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
  signal.push(initialSignalSMA);

  for (let i = signalPeriod; i < macd.length; i++) {
    const macdVal = macd[i];
    const prevSignal = signal[signal.length - 1];
    if (macdVal === undefined || prevSignal === undefined) continue;
    const signalEMA = macdVal * smoothing + prevSignal * (1 - smoothing);
    signal.push(signalEMA);
  }

  const histogram: number[] = [];
  for (let i = 0; i < signal.length; i++) {
    const mIdx = i + (macd.length - signal.length);
    const m = macd[mIdx];
    const s = signal[i];
    if (m === undefined || s === undefined) continue;
    histogram.push(m - s);
  }

  const currentHistogram = histogram[histogram.length - 1] ?? 0;
  const previousHistogram = histogram[histogram.length - 2] ?? 0;

  let currentSignal: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (previousHistogram <= 0 && currentHistogram > 0) {
    currentSignal = "BULLISH";
  } else if (previousHistogram >= 0 && currentHistogram < 0) {
    currentSignal = "BEARISH";
  }

  return {
    macd,
    signal,
    histogram,
    currentSignal,
  };
}

export function calculateATR(data: MarketData[], period: number = 14): TechnicalIndicatorResult {
  if (data.length < period + 1) {
    throw new Error(`Insufficient data: need ${period + 1} candles`);
  }

  const trueRanges: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const current = data[i];
    const previous = data[i - 1];
    if (!current || !previous) continue;
    const high = current.high;
    const low = current.low;
    const prevClose = previous.close;

    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);

    trueRanges.push(Math.max(tr1, tr2, tr3));
  }

  const values: number[] = [];

  // Calculate initial ATR using SMA
  if (trueRanges.length < period) {
    throw new Error(`Insufficient true range data: need ${period}`);
  }
  const sum = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
  values.push(sum / period);

  // Calculate subsequent ATR values using smoothed moving average
  for (let i = period; i < trueRanges.length; i++) {
    const prevATR = values[values.length - 1];
    const currentTR = trueRanges[i];
    if (prevATR === undefined || currentTR === undefined) continue;
    const atr = (prevATR * (period - 1) + currentTR) / period;
    values.push(atr);
  }

  const currentValue = values[values.length - 1] ?? 0;
  const previousValue = values[values.length - 2] ?? currentValue;
  const lastPrice = data[data.length - 1]?.close ?? currentValue;

  return {
    values,
    currentValue,
    previousValue,
    signal: "HOLD", // ATR is typically used for volatility, not signals
    strength: lastPrice === 0 ? 0 : currentValue / lastPrice, // ATR as percentage of price
  };
}

export function calculateBollingerBands(
  data: MarketData[],
  period: number = 20,
  stdDev: number = 2
): {
  upper: number[];
  middle: number[];
  lower: number[];
  currentPosition: "ABOVE_UPPER" | "BELOW_LOWER" | "BETWEEN_BANDS";
  bandwidth: number;
} {
  const prices = data.map((candle) => candle.close);
  const sma = calculateSMA(data, period);

  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < sma.values.length; i++) {
    const start = i;
    const end = i + period;
    const slice = prices.slice(start, end);

    if (slice.length === period) {
      const mean = sma.values[i];
      if (mean === undefined) continue;
      const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
      const standardDeviation = Math.sqrt(variance);

      upper.push(mean + stdDev * standardDeviation);
      lower.push(mean - stdDev * standardDeviation);
    }
  }

  const currentPrice = prices[prices.length - 1] ?? 0;
  const currentUpper = upper[upper.length - 1] ?? 0;
  const currentLower = lower[lower.length - 1] ?? 0;

  let currentPosition: "ABOVE_UPPER" | "BELOW_LOWER" | "BETWEEN_BANDS" = "BETWEEN_BANDS";
  if (currentPrice > currentUpper) {
    currentPosition = "ABOVE_UPPER";
  } else if (currentPrice < currentLower) {
    currentPosition = "BELOW_LOWER";
  }

  const bandwidth = currentUpper - currentLower;

  return {
    upper,
    middle: sma.values,
    lower,
    currentPosition,
    bandwidth,
  };
}
