import { Strategy, MarketData, StrategyParameters as BaseStrategyParameters } from '@/types';
import { logger } from '@/utils/logger';

// Strategy types
export type StrategyType = 'MovingAverageCrossover' | 'RSI' | 'MACD' | 'BollingerBands' | 'Custom';

// Strategy parameters
export interface StrategyParameters extends BaseStrategyParameters {
  timeframe: string;
}

// Strategy result
export interface StrategyResult {
  signal: 'BUY' | 'SELL' | null;
  reason: string;
  confidence: number;
}

/**
 * Execute a trading strategy based on market data
 */
export function executeStrategy(strategy: Strategy, marketData: MarketData[]): StrategyResult {
  try {
    // Add timeframe from strategy if not in parameters
    const parameters: StrategyParameters = {
      ...strategy.parameters,
      timeframe: strategy.parameters.timeframe || '5m'
    };

    switch (strategy.type as StrategyType) {
      case 'MovingAverageCrossover':
        return executeMovingAverageCrossover(parameters, marketData);
      case 'RSI':
        return executeRSI(parameters, marketData);
      case 'MACD':
        return executeMACD(parameters, marketData);
      case 'BollingerBands':
        return executeBollingerBands(parameters, marketData);
      case 'Custom':
        return executeCustomStrategy(parameters, marketData);
      default:
        logger.error(`Unknown strategy type: ${strategy.type}`);
        return { signal: null, reason: 'Unknown strategy type', confidence: 0 };
    }
  } catch (error) {
    logger.error('Strategy execution error:', error);
    return { signal: null, reason: 'Strategy execution error', confidence: 0 };
  }
}

/**
 * Moving Average Crossover Strategy
 * 
 * Parameters:
 * - fastPeriod: Period for fast moving average
 * - slowPeriod: Period for slow moving average
 */
function executeMovingAverageCrossover(
  parameters: StrategyParameters,
  marketData: MarketData[]
): StrategyResult {
  const { fastPeriod = 9, slowPeriod = 21 } = parameters;
  
  if (marketData.length < slowPeriod + 2) {
    return { 
      signal: null, 
      reason: 'Insufficient data for MA calculation', 
      confidence: 0 
    };
  }
  
  // Calculate fast and slow MAs
  const fastMA = calculateSMA(marketData, fastPeriod);
  const slowMA = calculateSMA(marketData, slowPeriod);
  
  // Get current and previous values
  const currentFastMA = fastMA[fastMA.length - 1];
  const previousFastMA = fastMA[fastMA.length - 2];
  const currentSlowMA = slowMA[slowMA.length - 1];
  const previousSlowMA = slowMA[slowMA.length - 2];
  
  // Check for crossover
  const isBullishCrossover = previousFastMA <= previousSlowMA && currentFastMA > currentSlowMA;
  const isBearishCrossover = previousFastMA >= previousSlowMA && currentFastMA < currentSlowMA;
  
  // Calculate confidence based on the distance between MAs
  const maDifference = Math.abs(currentFastMA - currentSlowMA);
  const maAverage = (currentFastMA + currentSlowMA) / 2;
  const confidence = Math.min(0.9, maDifference / maAverage * 10);
  
  if (isBullishCrossover) {
    return {
      signal: 'BUY',
      reason: `Bullish crossover: Fast MA (${fastPeriod}) crossed above Slow MA (${slowPeriod})`,
      confidence
    };
  } else if (isBearishCrossover) {
    return {
      signal: 'SELL',
      reason: `Bearish crossover: Fast MA (${fastPeriod}) crossed below Slow MA (${slowPeriod})`,
      confidence
    };
  }
  
  return {
    signal: null,
    reason: 'No crossover detected',
    confidence: 0
  };
}

/**
 * RSI Strategy
 * 
 * Parameters:
 * - period: Period for RSI calculation
 * - overbought: Overbought threshold
 * - oversold: Oversold threshold
 */
function executeRSI(
  parameters: StrategyParameters,
  marketData: MarketData[]
): StrategyResult {
  const { period = 14, overbought = 70, oversold = 30 } = parameters;
  
  if (marketData.length < period + 1) {
    return { 
      signal: null, 
      reason: 'Insufficient data for RSI calculation', 
      confidence: 0 
    };
  }
  
  // Calculate RSI
  const rsi = calculateRSI(marketData, period);
  const currentRSI = rsi[rsi.length - 1];
  const previousRSI = rsi[rsi.length - 2];
  
  // Calculate confidence based on distance from thresholds
  let confidence = 0;
  
  if (currentRSI < oversold) {
    confidence = Math.min(0.9, (oversold - currentRSI) / oversold);
    
    // Check if RSI is turning up from oversold
    if (previousRSI < currentRSI) {
      return {
        signal: 'BUY',
        reason: `RSI (${currentRSI.toFixed(2)}) turning up from oversold zone (${oversold})`,
        confidence
      };
    }
  } else if (currentRSI > overbought) {
    confidence = Math.min(0.9, (currentRSI - overbought) / (100 - overbought));
    
    // Check if RSI is turning down from overbought
    if (previousRSI > currentRSI) {
      return {
        signal: 'SELL',
        reason: `RSI (${currentRSI.toFixed(2)}) turning down from overbought zone (${overbought})`,
        confidence
      };
    }
  }
  
  return {
    signal: null,
    reason: `RSI (${currentRSI.toFixed(2)}) is in neutral zone`,
    confidence: 0
  };
}

/**
 * MACD Strategy
 * 
 * Parameters:
 * - fastPeriod: Period for fast EMA
 * - slowPeriod: Period for slow EMA
 * - signalPeriod: Period for signal line
 */
function executeMACD(
  parameters: StrategyParameters,
  marketData: MarketData[]
): StrategyResult {
  const { fastPeriod = 12, slowPeriod = 26, signalPeriod = 9 } = parameters;
  
  if (marketData.length < slowPeriod + signalPeriod) {
    return { 
      signal: null, 
      reason: 'Insufficient data for MACD calculation', 
      confidence: 0 
    };
  }
  
  // Calculate MACD
  const macdResult = calculateMACD(
    marketData, 
    fastPeriod, 
    slowPeriod, 
    signalPeriod
  );
  
  const currentHistogram = macdResult.histogram[macdResult.histogram.length - 1];
  const previousHistogram = macdResult.histogram[macdResult.histogram.length - 2];
  
  // Calculate confidence based on histogram value
  const confidence = Math.min(0.9, Math.abs(currentHistogram) / 0.5);
  
  // Check for crossover
  if (previousHistogram <= 0 && currentHistogram > 0) {
    return {
      signal: 'BUY',
      reason: 'MACD histogram turned positive (bullish crossover)',
      confidence
    };
  } else if (previousHistogram >= 0 && currentHistogram < 0) {
    return {
      signal: 'SELL',
      reason: 'MACD histogram turned negative (bearish crossover)',
      confidence
    };
  }
  
  return {
    signal: null,
    reason: 'No MACD crossover detected',
    confidence: 0
  };
}

/**
 * Bollinger Bands Strategy
 * 
 * Parameters:
 * - period: Period for moving average
 * - stdDev: Number of standard deviations
 */
function executeBollingerBands(
  parameters: StrategyParameters,
  marketData: MarketData[]
): StrategyResult {
  const { period = 20, stdDev = 2 } = parameters;
  
  if (marketData.length < period) {
    return { 
      signal: null, 
      reason: 'Insufficient data for Bollinger Bands calculation', 
      confidence: 0 
    };
  }
  
  // Calculate Bollinger Bands
  const bands = calculateBollingerBands(marketData, period, stdDev);
  
  const currentPrice = marketData[marketData.length - 1].close;
  const previousPrice = marketData[marketData.length - 2].close;
  
  const currentUpper = bands.upper[bands.upper.length - 1];
  const currentLower = bands.lower[bands.lower.length - 1];
  const currentMiddle = bands.middle[bands.middle.length - 1];
  
  // Calculate confidence based on position within bands
  let confidence = 0;
  
  if (currentPrice < currentLower) {
    confidence = Math.min(0.9, (currentLower - currentPrice) / (currentLower * 0.05));
    
    // Check if price is bouncing up from lower band
    if (previousPrice < currentPrice) {
      return {
        signal: 'BUY',
        reason: 'Price bouncing up from lower Bollinger Band',
        confidence
      };
    }
  } else if (currentPrice > currentUpper) {
    confidence = Math.min(0.9, (currentPrice - currentUpper) / (currentUpper * 0.05));
    
    // Check if price is bouncing down from upper band
    if (previousPrice > currentPrice) {
      return {
        signal: 'SELL',
        reason: 'Price bouncing down from upper Bollinger Band',
        confidence
      };
    }
  }
  
  return {
    signal: null,
    reason: 'Price within Bollinger Bands, no signal',
    confidence: 0
  };
}

/**
 * Custom Strategy
 * 
 * This is a placeholder for user-defined strategies
 */
function executeCustomStrategy(
  parameters: StrategyParameters,
  marketData: MarketData[]
): StrategyResult {
  // This is where users can implement their own strategy logic
  return {
    signal: null,
    reason: 'Custom strategy not implemented',
    confidence: 0
  };
}

// Technical indicator calculations

/**
 * Calculate Simple Moving Average (SMA)
 */
function calculateSMA(marketData: MarketData[], period: number): number[] {
  const prices = marketData.map(candle => candle.close);
  const sma = [];
  
  for (let i = period - 1; i < prices.length; i++) {
    const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  
  return sma;
}

/**
 * Calculate Exponential Moving Average (EMA)
 */
function calculateEMA(marketData: MarketData[], period: number): number[] {
  const prices = marketData.map(candle => candle.close);
  const ema = [];
  const multiplier = 2 / (period + 1);
  
  // Start with SMA
  const firstSMA = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(firstSMA);
  
  // Calculate EMA
  for (let i = period; i < prices.length; i++) {
    ema.push((prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
  }
  
  return ema;
}

/**
 * Calculate Relative Strength Index (RSI)
 */
function calculateRSI(marketData: MarketData[], period: number): number[] {
  const prices = marketData.map(candle => candle.close);
  const gains = [];
  const losses = [];
  const rsi = [];
  
  // Calculate price changes
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  
  // Calculate initial averages
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  // Calculate first RSI
  let rs = avgGain / (avgLoss === 0 ? 0.001 : avgLoss); // Avoid division by zero
  rsi.push(100 - (100 / (1 + rs)));
  
  // Calculate remaining RSIs
  for (let i = period; i < gains.length; i++) {
    avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
    avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
    
    rs = avgGain / (avgLoss === 0 ? 0.001 : avgLoss);
    rsi.push(100 - (100 / (1 + rs)));
  }
  
  return rsi;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
function calculateMACD(
  marketData: MarketData[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number
): { macd: number[], signal: number[], histogram: number[] } {
  // Calculate EMAs
  const fastEMA = calculateEMA(marketData, fastPeriod);
  const slowEMA = calculateEMA(marketData, slowPeriod);
  
  // Calculate MACD line
  const macd = [];
  for (let i = 0; i < fastEMA.length; i++) {
    if (i >= slowEMA.length - fastEMA.length) {
      macd.push(fastEMA[i] - slowEMA[i - (slowEMA.length - fastEMA.length)]);
    }
  }
  
  // Calculate signal line (EMA of MACD)
  const signal = [];
  const multiplier = 2 / (signalPeriod + 1);
  
  // Start with SMA of MACD
  const firstSignalSMA = macd.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
  signal.push(firstSignalSMA);
  
  // Calculate signal EMA
  for (let i = signalPeriod; i < macd.length; i++) {
    signal.push((macd[i] - signal[signal.length - 1]) * multiplier + signal[signal.length - 1]);
  }
  
  // Calculate histogram
  const histogram = [];
  for (let i = 0; i < signal.length; i++) {
    histogram.push(macd[i + (macd.length - signal.length)] - signal[i]);
  }
  
  return { macd, signal, histogram };
}

/**
 * Calculate Bollinger Bands
 */
function calculateBollingerBands(
  marketData: MarketData[],
  period: number,
  stdDev: number
): { middle: number[], upper: number[], lower: number[] } {
  const prices = marketData.map(candle => candle.close);
  const middle = calculateSMA(marketData, period);
  const upper = [];
  const lower = [];
  
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    const mean = sum / period;
    
    // Calculate standard deviation
    const squaredDiffs = slice.map(price => Math.pow(price - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    
    upper.push(middle[i - (period - 1)] + (standardDeviation * stdDev));
    lower.push(middle[i - (period - 1)] - (standardDeviation * stdDev));
  }
  
  return { middle, upper, lower };
}
