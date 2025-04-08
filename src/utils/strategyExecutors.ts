import { MarketData, StrategyType, Strategy } from '../types';

/**
 * Calculate Simple Moving Average for a given period
 */
// This file contains the logic for all trading strategies
// In a real application, this would connect to the backend API

/**
 * Calculate Simple Moving Average for a given period
 */
export const calculateSMA = (data: number[], period: number): number => {
  if (data.length < period) {
    return 0;
  }
  
  const slice = data.slice(data.length - period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
};

/**
 * Calculate Exponential Moving Average
 */
export const calculateEMA = (data: number[], period: number): number => {
  if (data.length < period) {
    return 0;
  }
  
  const k = 2 / (period + 1);
  let ema = data[0];
  
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  
  return ema;
};

/**
 * Calculate Relative Strength Index (RSI)
 */
/**
 * Calculate Relative Strength Index (RSI)
 */
export const calculateRSI = (data: number[], period: number): number => {
  if (data.length <= period) {
    return 50; // Default neutral value
  }
  
  // Get the price changes
  const changes = [];
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1]);
  }
  
  // Calculate gains and losses
  const gains = changes.map(change => change > 0 ? change : 0);
  const losses = changes.map(change => change < 0 ? Math.abs(change) : 0);
  
  // Calculate average gains and losses
  const avgGain = calculateSMA(gains.slice(-period - 1), period);
  const avgLoss = calculateSMA(losses.slice(-period - 1), period);
  
  // Calculate RSI
  if (avgLoss === 0) {
    return 100;
  }
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

/**
 * Calculate MACD
 */
export const calculateMACD = (data: number[]): { macd: number; signal: number; histogram: number } => {
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);
  const macd = ema12 - ema26;
  const signal = calculateEMA([macd], 9);
  const histogram = macd - signal;
  
  return { macd, signal, histogram };
};

/**
 * Calculate Bollinger Bands
 */
export const calculateBollingerBands = (data: number[], period: number = 20, stdDev: number = 2): {
  upper: number;
  middle: number;
  lower: number;
} => {
  const sma = calculateSMA(data.slice(-period), period);
  const variance = data
    .slice(-period)
    .reduce((sum, value) => sum + Math.pow(value - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  
  return {
    upper: sma + stdDev * std,
    middle: sma,
    lower: sma - stdDev * std
  };
};
/**
 * Calculate if there's a breakout
 */
export const calculateBreakout = (
  data: number[],
  lookbackPeriod: number,
  threshold: number
): { isBreakout: boolean; direction: 'up' | 'down' | null } => {
  if (data.length < lookbackPeriod + 1) {
    return { isBreakout: false, direction: null };
  }
  
  const currentPrice = data[data.length - 1];
  const priorData = data.slice(-lookbackPeriod - 1, -1);
  
  const highestPrice = Math.max(...priorData);
  const lowestPrice = Math.min(...priorData);
  
  const upperThreshold = highestPrice * (1 + threshold / 100);
  const lowerThreshold = lowestPrice * (1 - threshold / 100);
  
  if (currentPrice > upperThreshold) {
    return { isBreakout: true, direction: 'up' };
  } else if (currentPrice < lowerThreshold) {
    return { isBreakout: true, direction: 'down' };
  }
  
  return { isBreakout: false, direction: null };
};

/**
 * Calculate if there's a breakout
 */
/**
 * Calculate Volume Weighted Average Price (VWAP)
 */
export const calculateVWAP = (data: MarketData[]): number => {
  let sumPV = 0;
  let sumV = 0;
  
  data.forEach(candle => {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    sumPV += typicalPrice * candle.volume;
    sumV += candle.volume;
  });
  
  return sumPV / sumV;
};

/**
 * Execute a strategy based on current market data
 */
export const executeStrategy = (
  strategy: Strategy,
  marketData: MarketData[]
): { signal: 'BUY' | 'SELL' | null; reason: string } => {
  // Filter market data for the relevant pair
  const pairData = marketData.filter(data => data.pair === strategy.parameters.pair);
  
  if (pairData.length === 0) {
    return { signal: null, reason: 'No market data available for this pair.' };
  }
  
  // Extract closing prices
  const prices = pairData.map(data => data.close);
  
  switch (strategy.type) {
    case StrategyType.MA_CROSSOVER: {
      const { shortPeriod, longPeriod } = strategy.parameters;
      
      if (prices.length < longPeriod) {
        return { 
          signal: null, 
          reason: `Not enough data. Need at least ${longPeriod} periods.` 
        };
      }
      
      const shortMA = calculateSMA(prices, shortPeriod);
      const longMA = calculateSMA(prices, longPeriod);
      
      // Check for previous values to determine crossing
      const prevPrices = prices.slice(0, -1);
      const prevShortMA = calculateSMA(prevPrices, shortPeriod);
      const prevLongMA = calculateSMA(prevPrices, longPeriod);
      
      if (prevShortMA <= prevLongMA && shortMA > longMA) {
        return { 
          signal: 'BUY', 
          reason: `Short MA (${shortMA.toFixed(2)}) crossed above Long MA (${longMA.toFixed(2)})` 
        };
      } else if (prevShortMA >= prevLongMA && shortMA < longMA) {
        return { 
          signal: 'SELL', 
          reason: `Short MA (${shortMA.toFixed(2)}) crossed below Long MA (${longMA.toFixed(2)})` 
        };
      }
      
      return { 
        signal: null, 
        reason: `No signal. Short MA: ${shortMA.toFixed(2)}, Long MA: ${longMA.toFixed(2)}` 
      };
    }
    
    case StrategyType.RSI: {
      const { period, overbought, oversold } = strategy.parameters;
      
      if (prices.length < period) {
        return { 
          signal: null, 
          reason: `Not enough data. Need at least ${period} periods.` 
        };
      }
      
      const rsi = calculateRSI(prices, period);
      const prevPrices = prices.slice(0, -1);
      const prevRSI = calculateRSI(prevPrices, period);
      
      if (prevRSI <= oversold && rsi > oversold) {
        return { 
          signal: 'BUY', 
          reason: `RSI (${rsi.toFixed(2)}) crossed above oversold threshold (${oversold})` 
        };
      } else if (prevRSI >= overbought && rsi < overbought) {
        return { 
          signal: 'SELL', 
          reason: `RSI (${rsi.toFixed(2)}) crossed below overbought threshold (${overbought})` 
        };
      }
      
      return { 
        signal: null, 
        reason: `No signal. RSI: ${rsi.toFixed(2)}` 
      };
    }
    
    case StrategyType.BREAKOUT: {
      const { lookbackPeriod, breakoutThreshold } = strategy.parameters;
      
      if (prices.length < lookbackPeriod) {
        return { 
          signal: null, 
          reason: `Not enough data. Need at least ${lookbackPeriod} periods.` 
        };
      }
      
      const { isBreakout, direction } = calculateBreakout(
        prices, 
        lookbackPeriod, 
        breakoutThreshold
      );
      
      if (isBreakout && direction === 'up') {
        return { 
          signal: 'BUY', 
          reason: `Upward breakout detected (${breakoutThreshold}% threshold)` 
        };
      } else if (isBreakout && direction === 'down') {
        return { 
          signal: 'SELL', 
          reason: `Downward breakout detected (${breakoutThreshold}% threshold)` 
        };
      }
      
      return { 
        signal: null, 
        reason: 'No breakout detected' 
      };
    }
    
    default:
      return { signal: null, reason: 'Unknown strategy type.' };
  }
};