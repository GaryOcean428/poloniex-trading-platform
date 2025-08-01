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

export function calculateRSI(data: MarketData[], period: number = 14): TechnicalIndicatorResult {
  const prices = data.map((candle) => candle.close);
  const values: number[] = [];

  if (prices.length < period + 1) {
    throw new Error(`Insufficient data: need ${period + 1} candles`);
  }

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const avgGain = 0;
  const avgLoss = 0;

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
  const strength = 0;

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

export function calculateATR(data: MarketData[], period: number = 14): TechnicalIndicatorResult {
  if (data.length < period + 1) {
    throw new Error(`Insufficient data: need ${period + 1} candles`);
  }

  const trueRanges: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    
    trueRanges.push(Math.max(tr1, tr2, tr3));
  }

  const values: number[] = [];
  
  // Calculate initial ATR using SMA
  const sum = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
  values.push(sum / period);
  
  // Calculate subsequent ATR values using smoothed moving average
  for (let i = period; i < trueRanges.length; i++) {
    const prevATR = values[values.length - 1];
    const currentTR = trueRanges[i];
    const atr = (prevATR * (period - 1) + currentTR) / period;
    values.push(atr);
  }

  const currentValue = values[values.length - 1];
  const previousValue = values[values.length - 2] || currentValue;
  
  return {
    values,
    currentValue,
    previousValue,
    signal: "HOLD", // ATR is typically used for volatility, not signals
    strength: currentValue / data[data.length - 1].close, // ATR as percentage of price
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
      const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
      const standardDeviation = Math.sqrt(variance);

      upper.push(mean + stdDev * standardDeviation);
      lower.push(mean - stdDev * standardDeviation);
    }
  }

  const currentPrice = prices[prices.length - 1];
  const currentUpper = upper[upper.length - 1];
  const currentLower = lower[lower.length - 1];

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
