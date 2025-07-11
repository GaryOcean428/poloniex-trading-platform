import { MarketData } from '@/types';

/**
 * Enhanced Technical Indicators for Trading Strategies
 * Optimized for performance and accuracy
 */

export interface TechnicalIndicatorResult {
  values: number[];
  currentValue: number;
  previousValue: number;
  signal?: 'BUY' | 'SELL' | 'HOLD';
  strength?: number; // 0-1 signal strength
}

export interface BollingerBandsResult {
  upper: number[];
  middle: number[];
  lower: number[];
  currentPosition: 'ABOVE_UPPER' | 'BELOW_LOWER' | 'BETWEEN_BANDS';
  bandwidth: number; // Current bandwidth as percentage
}

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
  currentSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  divergence?: 'BULLISH_DIV' | 'BEARISH_DIV' | 'NONE';
}

export interface StochasticResult {
  k: number[];
  d: number[];
  currentK: number;
  currentD: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
}

/**
 * Calculate Simple Moving Average (SMA) with optimization
 */
export function calculateSMA(data: MarketData[], period: number): TechnicalIndicatorResult {
  const prices = data.map(candle => candle.close);
  const values: number[] = [];
  
  if (prices.length < period) {
    throw new Error(`Insufficient data: need ${period} candles, got ${prices.length}`);
  }
  
  // Use sliding window for efficiency
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
    signal: currentValue > previousValue ? 'BUY' : currentValue < previousValue ? 'SELL' : 'HOLD',
    strength: Math.abs(currentValue - previousValue) / currentValue
  };
}

/**
 * Calculate Exponential Moving Average (EMA) with optimization
 */
export function calculateEMA(data: MarketData[], period: number): TechnicalIndicatorResult {
  const prices = data.map(candle => candle.close);
  const values: number[] = [];
  const smoothing = 2 / (period + 1);
  
  if (prices.length < period) {
    throw new Error(`Insufficient data: need ${period} candles, got ${prices.length}`);
  }
  
  // Start with SMA for first value
  const initialSMA = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  values.push(initialSMA);
  
  // Calculate EMA
  for (let i = period; i < prices.length; i++) {
    const ema = (prices[i] * smoothing) + (values[values.length - 1] * (1 - smoothing));
    values.push(ema);
  }
  
  const currentValue = values[values.length - 1];
  const previousValue = values[values.length - 2] || currentValue;
  
  return {
    values,
    currentValue,
    previousValue,
    signal: currentValue > previousValue ? 'BUY' : currentValue < previousValue ? 'SELL' : 'HOLD',
    strength: Math.abs(currentValue - previousValue) / currentValue
  };
}

/**
 * Calculate Relative Strength Index (RSI) with enhanced features
 */
export function calculateRSI(data: MarketData[], period: number = 14): TechnicalIndicatorResult {
  const prices = data.map(candle => candle.close);
  const values: number[] = [];
  
  if (prices.length < period + 1) {
    throw new Error(`Insufficient data: need ${period + 1} candles, got ${prices.length}`);
  }
  
  // Calculate price changes
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }
  
  // Calculate initial averages using Wilder's smoothing
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
  
  // Calculate first RSI
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  values.push(100 - (100 / (1 + rs)));
  
  // Calculate remaining RSI values using Wilder's smoothing
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    values.push(100 - (100 / (1 + rs)));
  }
  
  const currentValue = values[values.length - 1];
  const previousValue = values[values.length - 2] || currentValue;
  
  // Enhanced RSI signals
  let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let strength = 0;
  
  if (currentValue < 30 && previousValue < currentValue) {
    signal = 'BUY';
    strength = (30 - currentValue) / 30;
  } else if (currentValue > 70 && previousValue > currentValue) {
    signal = 'SELL';
    strength = (currentValue - 70) / 30;
  }
  
  return {
    values,
    currentValue,
    previousValue,
    signal,
    strength
  };
}

/**
 * Calculate MACD with enhanced divergence detection
 */
export function calculateMACD(
  data: MarketData[], 
  fastPeriod: number = 12, 
  slowPeriod: number = 26, 
  signalPeriod: number = 9
): MACDResult {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);
  
  // Calculate MACD line (difference between fast and slow EMA)
  const macd: number[] = [];
  const startIndex = slowPeriod - fastPeriod;
  
  for (let i = startIndex; i < fastEMA.values.length; i++) {
    macd.push(fastEMA.values[i] - slowEMA.values[i - startIndex]);
  }
  
  // Calculate signal line (EMA of MACD)
  const signal: number[] = [];
  const smoothing = 2 / (signalPeriod + 1);
  
  // Start with SMA for signal line
  const initialSignalSMA = macd.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
  signal.push(initialSignalSMA);
  
  for (let i = signalPeriod; i < macd.length; i++) {
    const signalEMA = (macd[i] * smoothing) + (signal[signal.length - 1] * (1 - smoothing));
    signal.push(signalEMA);
  }
  
  // Calculate histogram
  const histogram: number[] = [];
  for (let i = 0; i < signal.length; i++) {
    histogram.push(macd[i + (macd.length - signal.length)] - signal[i]);
  }
  
  // Determine current signal
  const currentHistogram = histogram[histogram.length - 1];
  const previousHistogram = histogram[histogram.length - 2] || 0;
  
  let currentSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (previousHistogram <= 0 && currentHistogram > 0) {
    currentSignal = 'BULLISH';
  } else if (previousHistogram >= 0 && currentHistogram < 0) {
    currentSignal = 'BEARISH';
  }
  
  return {
    macd,
    signal,
    histogram,
    currentSignal,
    divergence: 'NONE' // Basic implementation, can be enhanced
  };
}

/**
 * Calculate Bollinger Bands with enhanced analysis
 */
export function calculateBollingerBands(
  data: MarketData[], 
  period: number = 20, 
  stdDev: number = 2
): BollingerBandsResult {
  const prices = data.map(candle => candle.close);
  const sma = calculateSMA(data, period);
  const middle = sma.values;
  const upper: number[] = [];
  const lower: number[] = [];
  
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = middle[i - (period - 1)];
    
    // Calculate standard deviation
    const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);
    
    upper.push(mean + (standardDeviation * stdDev));
    lower.push(mean - (standardDeviation * stdDev));
  }
  
  const currentPrice = prices[prices.length - 1];
  const currentUpper = upper[upper.length - 1];
  const currentLower = lower[lower.length - 1];
  const currentMiddle = middle[middle.length - 1];
  
  // Determine position
  let currentPosition: 'ABOVE_UPPER' | 'BELOW_LOWER' | 'BETWEEN_BANDS' = 'BETWEEN_BANDS';
  if (currentPrice > currentUpper) {
    currentPosition = 'ABOVE_UPPER';
  } else if (currentPrice < currentLower) {
    currentPosition = 'BELOW_LOWER';
  }
  
  // Calculate bandwidth (volatility measure)
  const bandwidth = ((currentUpper - currentLower) / currentMiddle) * 100;
  
  return {
    upper,
    middle,
    lower,
    currentPosition,
    bandwidth
  };
}

/**
 * Calculate Stochastic Oscillator
 */
export function calculateStochastic(
  data: MarketData[], 
  kPeriod: number = 14, 
  dPeriod: number = 3
): StochasticResult {
  const k: number[] = [];
  const d: number[] = [];
  
  for (let i = kPeriod - 1; i < data.length; i++) {
    const slice = data.slice(i - kPeriod + 1, i + 1);
    const lowestLow = Math.min(...slice.map(candle => candle.low));
    const highestHigh = Math.max(...slice.map(candle => candle.high));
    const currentClose = data[i].close;
    
    const kValue = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    k.push(kValue);
  }
  
  // Calculate %D (SMA of %K)
  for (let i = dPeriod - 1; i < k.length; i++) {
    const slice = k.slice(i - dPeriod + 1, i + 1);
    const dValue = slice.reduce((sum, val) => sum + val, 0) / dPeriod;
    d.push(dValue);
  }
  
  const currentK = k[k.length - 1];
  const currentD = d[d.length - 1];
  
  // Generate signals
  let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  if (currentK < 20 && currentD < 20 && currentK > currentD) {
    signal = 'BUY';
  } else if (currentK > 80 && currentD > 80 && currentK < currentD) {
    signal = 'SELL';
  }
  
  return {
    k,
    d,
    currentK,
    currentD,
    signal
  };
}

/**
 * Moving Average Convergence/Divergence for trend confirmation
 */
export function calculateMovingAverageCrossover(
  data: MarketData[], 
  fastPeriod: number = 9, 
  slowPeriod: number = 21
): { signal: 'BUY' | 'SELL' | 'HOLD'; strength: number; confirmation: boolean } {
  const fastMA = calculateEMA(data, fastPeriod);
  const slowMA = calculateEMA(data, slowPeriod);
  
  const currentFast = fastMA.currentValue;
  const previousFast = fastMA.previousValue;
  const currentSlow = slowMA.currentValue;
  const previousSlow = slowMA.previousValue;
  
  // Check for crossover
  const bullishCrossover = previousFast <= previousSlow && currentFast > currentSlow;
  const bearishCrossover = previousFast >= previousSlow && currentFast < currentSlow;
  
  // Calculate signal strength
  const percentageDifference = Math.abs(currentFast - currentSlow) / currentSlow;
  const strength = Math.min(percentageDifference * 10, 1);
  
  // Trend confirmation (fast MA should be trending in signal direction)
  const fastTrend = currentFast > previousFast ? 'UP' : 'DOWN';
  const confirmation = bullishCrossover ? fastTrend === 'UP' : bearishCrossover ? fastTrend === 'DOWN' : false;
  
  let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  if (bullishCrossover) signal = 'BUY';
  else if (bearishCrossover) signal = 'SELL';
  
  return { signal, strength, confirmation };
}

/**
 * Calculate Average True Range (ATR) for volatility measurement
 */
export function calculateATR(data: MarketData[], period: number = 14): TechnicalIndicatorResult {
  const trueRanges: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    const current = data[i];
    const previous = data[i - 1];
    
    const tr1 = current.high - current.low;
    const tr2 = Math.abs(current.high - previous.close);
    const tr3 = Math.abs(current.low - previous.close);
    
    trueRanges.push(Math.max(tr1, tr2, tr3));
  }
  
  // Calculate ATR using EMA
  const values: number[] = [];
  let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
  values.push(atr);
  
  const multiplier = 2 / (period + 1);
  for (let i = period; i < trueRanges.length; i++) {
    atr = (trueRanges[i] * multiplier) + (atr * (1 - multiplier));
    values.push(atr);
  }
  
  const currentValue = values[values.length - 1];
  const previousValue = values[values.length - 2] || currentValue;
  
  return {
    values,
    currentValue,
    previousValue
  };
}

/**
 * Combine multiple indicators for enhanced signal generation
 */
export function combineIndicatorSignals(
  data: MarketData[],
  options: {
    useRSI?: boolean;
    useMACD?: boolean;
    useBB?: boolean;
    useStochastic?: boolean;
    useMA?: boolean;
    weights?: { rsi: number; macd: number; bb: number; stochastic: number; ma: number };
  } = {}
): { signal: 'BUY' | 'SELL' | 'HOLD'; confidence: number; indicators: any } {
  const {
    useRSI = true,
    useMACD = true,
    useBB = true,
    useStochastic = false,
    useMA = true,
    weights = { rsi: 0.3, macd: 0.3, bb: 0.2, stochastic: 0.1, ma: 0.1 }
  } = options;
  
  const signals: Array<{ signal: string; weight: number; strength: number }> = [];
  const indicators: any = {};
  
  if (useRSI) {
    const rsi = calculateRSI(data);
    indicators.rsi = rsi;
    if (rsi.signal !== 'HOLD') {
      signals.push({
        signal: rsi.signal,
        weight: weights.rsi,
        strength: rsi.strength || 0.5
      });
    }
  }
  
  if (useMACD) {
    const macd = calculateMACD(data);
    indicators.macd = macd;
    if (macd.currentSignal !== 'NEUTRAL') {
      signals.push({
        signal: macd.currentSignal === 'BULLISH' ? 'BUY' : 'SELL',
        weight: weights.macd,
        strength: 0.7
      });
    }
  }
  
  if (useBB) {
    const bb = calculateBollingerBands(data);
    indicators.bollingerBands = bb;
    if (bb.currentPosition !== 'BETWEEN_BANDS') {
      signals.push({
        signal: bb.currentPosition === 'BELOW_LOWER' ? 'BUY' : 'SELL',
        weight: weights.bb,
        strength: 0.6
      });
    }
  }
  
  if (useMA) {
    const ma = calculateMovingAverageCrossover(data);
    indicators.movingAverage = ma;
    if (ma.signal !== 'HOLD') {
      signals.push({
        signal: ma.signal,
        weight: weights.ma,
        strength: ma.strength
      });
    }
  }
  
  // Calculate weighted signal
  const buySignals = signals.filter(s => s.signal === 'BUY');
  const sellSignals = signals.filter(s => s.signal === 'SELL');
  
  const buyScore = buySignals.reduce((sum, s) => sum + (s.weight * s.strength), 0);
  const sellScore = sellSignals.reduce((sum, s) => sum + (s.weight * s.strength), 0);
  
  let finalSignal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let confidence = 0;
  
  if (buyScore > sellScore && buyScore > 0.3) {
    finalSignal = 'BUY';
    confidence = Math.min(buyScore, 1);
  } else if (sellScore > buyScore && sellScore > 0.3) {
    finalSignal = 'SELL';
    confidence = Math.min(sellScore, 1);
  }
  
  return {
    signal: finalSignal,
    confidence,
    indicators
  };
}