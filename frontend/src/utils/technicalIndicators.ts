import { MarketData } from "@/types";

/**
 * Enhanced Technical Indicators for Trading Strategies
 */

export interface TechnicalIndicatorResult {
  values: number[];
  currentValue: number;
  previousValue: number;
  signal?: "BUY" | "SELL" | "HOLD";
  strength?: number;
}

export interface BollingerBandsResult {
  upper: number[];
  middle: number[];
  lower: number[];
  currentPosition: "ABOVE_UPPER" | "BELOW_LOWER" | "BETWEEN_BANDS";
  bandwidth: number;
}

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
  currentSignal: "BULLISH" | "BEARISH" | "NEUTRAL";
}

export interface StochasticResult {
  k: number[];
  d: number[];
  currentK: number;
  currentD: number;
  signal: "BUY" | "SELL" | "HOLD";
}

export function calculateSMA(
  data: MarketData[],
  period: number
): TechnicalIndicatorResult {
  const prices = data.map((candle) => candle.close);
  const values: number[] = [];

  if (prices.length < period) {
    throw new Error(`Insufficient data: need ${period} candles`);
  }

  let sum = prices.slice(0, period).reduce((a, b) => a + b, 0);
  values.push(sum / period);

  for (let i = period; i < prices.length; i++) {
    sum = sum - prices[i - period] + prices[i];
    values.push(sum / period);
  }

  const currentValue = values[values.length - 1];
  const previousValue = values[values.length - 2] || currentValue;

  return {
    values,
    currentValue,
    previousValue,
    signal: currentValue > previousValue ? "BUY" : currentValue < previousValue ? "SELL" : "HOLD",
    strength: Math.abs(currentValue - previousValue) / currentValue,
  };
}

export function calculateEMA(
  data: MarketData[],
  period: number
): TechnicalIndicatorResult {
  const prices = data.map((candle) => candle.close);
  const values: number[] = [];
  const smoothing = 2 / (period + 1);

  if (prices.length < period) {
    throw new Error(`Insufficient data: need ${period} candles`);
  }

  const initialSMA = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  values.push(initialSMA);

  for (let i = period; i < prices.length; i++) {
    const ema = prices[i] * smoothing + values[values.length - 1] * (1 - smoothing);
    values.push(ema);
  }

  const currentValue = values[values.length - 1];
  const previousValue = values[values.length - 2] || currentValue;

  return {
    values,
    currentValue,
    previousValue,
    signal: currentValue > previousValue ? "BUY" : currentValue < previousValue ? "SELL" : "HOLD",
    strength: Math.abs(currentValue - previousValue) / currentValue,
  };
}

export function calculateRSI(
  data: MarketData[],
  period: number = 14
): TechnicalIndicatorResult {
  const prices = data.map((candle) => candle.close);
  const values: number[] = [];

  if (prices.length < period + 1) {
    throw new Error(`Insufficient data: need ${period + 1} candles`);
  }

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      avgGain += changes[i];
    } else {
      avgLoss += Math.abs(changes[i]);
    }
  }

  avgGain /= period;
  avgLoss /= period;

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  values.push(100 - 100 / (1 + rs));

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    values.push(100 - 100 / (1 + rs));
  }

  const currentValue = values[values.length - 1];
  const previousValue = values[values.length - 2] || currentValue;

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
): MACDResult {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);

  const macd: number[] = [];
  const startIndex = slowPeriod - fastPeriod;

  for (let i = startIndex; i < fastEMA.values.length; i++) {
    macd.push(fastEMA.values[i] - slowEMA.values[i - startIndex]);
  }

  const signal: number[] = [];
  const smoothing = 2 / (signalPeriod + 1);

  const initialSignalSMA = macd.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
  signal.push(initialSignalSMA);

  for (let i = signalPeriod; i < macd.length; i++) {
    const signalEMA = macd[i] * smoothing + signal[signal.length - 1] * (1 - smoothing);
    signal.push(signalEMA);
  }

  const histogram: number[] = [];
  for (let i = 0; i < signal.length; i++) {
    histogram.push(macd[i + (macd.length - signal.length)] - signal[i]);
  }

  const currentHistogram = histogram[histogram.length - 1];
  const previousHistogram = histogram[histogram.length - 2] || 0;

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

export function calculateBollingerBands(
  data:
