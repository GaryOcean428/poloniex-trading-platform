/**
 * Simple ML Service (JavaScript-based fallback)
 * Provides basic technical analysis-based predictions when Python ML models are unavailable
 */

import { logger } from '../utils/logger.js';

// ─── Named constants for all tuning parameters ───

const INDICATOR_PERIODS = {
  SMA_SHORT: 20,
  SMA_LONG: 50,
  EMA_FAST: 12,
  EMA_SLOW: 26,
  MOMENTUM_LOOKBACK: 10,
} as const;

const RSI_THRESHOLDS = {
  OVERSOLD: 30,
  LOW: 45,
  NEUTRAL: 50,
  HIGH: 55,
  OVERBOUGHT: 70,
} as const;

const DEFAULT_RSI = 50; // Neutral RSI when insufficient data

const MACD_CONFIG = {
  SIGNAL_APPROXIMATION_FACTOR: 0.9, // Simplified EMA-of-MACD approximation
} as const;

const PREDICTION_HORIZON_FACTORS: Record<string, number> = {
  '1h': 0.005,
  '4h': 0.02,
  '24h': 0.05,
} as const;

const SIGNAL_WEIGHTS = {
  SMA_CROSS: 0.2,
  EMA_CROSS: 0.2,
  RSI_EXTREME: 0.3,
  RSI_MODERATE: 0.1,
  MACD_HISTOGRAM: 0.2,
  MOMENTUM: 0.2,
} as const;

const DIRECTION_THRESHOLDS = {
  NET_SCORE_MIN: 0.2,
  CONFIDENCE_MULTIPLIER: 50,
  CONFIDENCE_BASE: 30,
  CONFIDENCE_CAP: 85,
  NEUTRAL_CONFIDENCE: 40,
  NEUTRAL_DAMPENING: 0.3,
} as const;

const SIGNAL_TIERS = {
  STRONG: { minScore: 3, confidence: 80, strength: 0.8 },
  MODERATE: { minScore: 2, confidence: 70, strength: 0.65 },
  MILD: { minScore: 1, confidence: 60, strength: 0.5 },
  NEUTRAL: { minScore: 0, confidence: 50, strength: 0.3 },
} as const;

interface OHLCVData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Prediction {
  price: number;
  confidence: number;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

interface TradingSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  strength: number;
}

class SimpleMlService {
  /**
   * Calculate Simple Moving Average
   */
  private calculateSMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1] || 0;
    const slice = data.slice(-period);
    return slice.reduce((sum, val) => sum + val, 0) / period;
  }

  /**
   * Calculate Exponential Moving Average
   */
  private calculateEMA(data: number[], period: number): number {
    if (data.length === 0) return 0;
    if (data.length < period) return this.calculateSMA(data, data.length);

    const multiplier = 2 / (period + 1);
    let ema = this.calculateSMA(data.slice(0, period), period);

    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  private calculateRSI(data: number[], period: number = 14): number {
    if (data.length < period + 1) return DEFAULT_RSI;

    const changes = [];
    for (let i = 1; i < data.length; i++) {
      changes.push(data[i] - data[i - 1]);
    }

    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);

    const avgGain = this.calculateSMA(gains, period);
    const avgLoss = this.calculateSMA(losses, period);

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  private calculateMACD(data: number[]): { macd: number; signal: number; histogram: number } {
    const ema12 = this.calculateEMA(data, INDICATOR_PERIODS.EMA_FAST);
    const ema26 = this.calculateEMA(data, INDICATOR_PERIODS.EMA_SLOW);
    const macd = ema12 - ema26;

    // For signal line, we'd need to calculate EMA of MACD values
    // Simplified: use a basic approximation
    const signal = macd * MACD_CONFIG.SIGNAL_APPROXIMATION_FACTOR;
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  /**
   * Get multi-horizon predictions based on technical indicators
   */
  async getMultiHorizonPredictions(symbol: string, ohlcvData: OHLCVData[]): Promise<{
    '1h': Prediction;
    '4h': Prediction;
    '24h': Prediction;
  }> {
    try {
      const closePrices = ohlcvData.map(d => d.close);
      const currentPrice = closePrices[closePrices.length - 1];

      // Calculate technical indicators
      const sma20 = this.calculateSMA(closePrices, INDICATOR_PERIODS.SMA_SHORT);
      const sma50 = this.calculateSMA(closePrices, INDICATOR_PERIODS.SMA_LONG);
      const ema12 = this.calculateEMA(closePrices, INDICATOR_PERIODS.EMA_FAST);
      const rsi = this.calculateRSI(closePrices);
      const macd = this.calculateMACD(closePrices);

      // Determine trend strength
      const trendStrength = Math.abs(currentPrice - sma20) / sma20;
      const momentum = (currentPrice - closePrices[closePrices.length - INDICATOR_PERIODS.MOMENTUM_LOOKBACK]) / closePrices[closePrices.length - INDICATOR_PERIODS.MOMENTUM_LOOKBACK];

      // Calculate predictions for different horizons
      const predictions = {
        '1h': this.predictPrice(currentPrice, sma20, ema12, rsi, macd, trendStrength, momentum, PREDICTION_HORIZON_FACTORS['1h']),
        '4h': this.predictPrice(currentPrice, sma20, ema12, rsi, macd, trendStrength, momentum, PREDICTION_HORIZON_FACTORS['4h']),
        '24h': this.predictPrice(currentPrice, sma50, ema12, rsi, macd, trendStrength, momentum, PREDICTION_HORIZON_FACTORS['24h'])
      };

      logger.info(`Simple ML predictions for ${symbol}:`, predictions);

      return predictions;
    } catch (error) {
      logger.error('Simple ML prediction error:', error);
      throw error;
    }
  }

  /**
   * Predict price based on technical indicators
   */
  private predictPrice(
    currentPrice: number,
    sma: number,
    ema: number,
    rsi: number,
    macd: { macd: number; signal: number; histogram: number },
    trendStrength: number,
    momentum: number,
    horizonFactor: number
  ): Prediction {
    // Bullish signals
    let bullishScore = 0;
    if (currentPrice > sma) bullishScore += SIGNAL_WEIGHTS.SMA_CROSS;
    if (currentPrice > ema) bullishScore += SIGNAL_WEIGHTS.EMA_CROSS;
    if (rsi < RSI_THRESHOLDS.OVERSOLD) bullishScore += SIGNAL_WEIGHTS.RSI_EXTREME;
    if (rsi > RSI_THRESHOLDS.NEUTRAL && rsi < RSI_THRESHOLDS.OVERBOUGHT) bullishScore += SIGNAL_WEIGHTS.RSI_MODERATE;
    if (macd.histogram > 0) bullishScore += SIGNAL_WEIGHTS.MACD_HISTOGRAM;
    if (momentum > 0) bullishScore += SIGNAL_WEIGHTS.MOMENTUM;

    // Bearish signals
    let bearishScore = 0;
    if (currentPrice < sma) bearishScore += SIGNAL_WEIGHTS.SMA_CROSS;
    if (currentPrice < ema) bearishScore += SIGNAL_WEIGHTS.EMA_CROSS;
    if (rsi > RSI_THRESHOLDS.OVERBOUGHT) bearishScore += SIGNAL_WEIGHTS.RSI_EXTREME;
    if (rsi < RSI_THRESHOLDS.NEUTRAL && rsi > RSI_THRESHOLDS.OVERSOLD) bearishScore += SIGNAL_WEIGHTS.RSI_MODERATE;
    if (macd.histogram < 0) bearishScore += SIGNAL_WEIGHTS.MACD_HISTOGRAM;
    if (momentum < 0) bearishScore += SIGNAL_WEIGHTS.MOMENTUM;

    // Determine direction and confidence
    const netScore = bullishScore - bearishScore;
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    let confidence: number;
    let priceChange: number;

    if (netScore > DIRECTION_THRESHOLDS.NET_SCORE_MIN) {
      direction = 'BULLISH';
      confidence = Math.min(netScore * DIRECTION_THRESHOLDS.CONFIDENCE_MULTIPLIER + DIRECTION_THRESHOLDS.CONFIDENCE_BASE, DIRECTION_THRESHOLDS.CONFIDENCE_CAP);
      priceChange = horizonFactor * (1 + trendStrength);
    } else if (netScore < -DIRECTION_THRESHOLDS.NET_SCORE_MIN) {
      direction = 'BEARISH';
      confidence = Math.min(Math.abs(netScore) * DIRECTION_THRESHOLDS.CONFIDENCE_MULTIPLIER + DIRECTION_THRESHOLDS.CONFIDENCE_BASE, DIRECTION_THRESHOLDS.CONFIDENCE_CAP);
      priceChange = -horizonFactor * (1 + trendStrength);
    } else {
      direction = 'NEUTRAL';
      confidence = DIRECTION_THRESHOLDS.NEUTRAL_CONFIDENCE;
      priceChange = horizonFactor * DIRECTION_THRESHOLDS.NEUTRAL_DAMPENING * (Math.random() - 0.5);
    }

    const predictedPrice = currentPrice * (1 + priceChange);

    return {
      price: Math.round(predictedPrice * 100) / 100,
      confidence: Math.round(confidence),
      direction
    };
  }

  /**
   * Get trading signal based on technical analysis
   */
  async getTradingSignal(symbol: string, ohlcvData: OHLCVData[], currentPrice: number): Promise<TradingSignal> {
    try {
      const closePrices = ohlcvData.map(d => d.close);

      // Calculate indicators
      const sma20 = this.calculateSMA(closePrices, INDICATOR_PERIODS.SMA_SHORT);
      const sma50 = this.calculateSMA(closePrices, INDICATOR_PERIODS.SMA_LONG);
      const rsi = this.calculateRSI(closePrices);
      const macd = this.calculateMACD(closePrices);

      // Determine signal using a scoring approach instead of rigid conditions
      let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      let confidence = 0;
      let reason = '';
      let strength = 0;

      // Build a composite score from multiple indicators
      let bullishPoints = 0;
      let bearishPoints = 0;
      const bullishReasons: string[] = [];
      const bearishReasons: string[] = [];

      // Trend: price vs moving averages
      if (currentPrice > sma20) { bullishPoints += 1; bullishReasons.push('price>SMA20'); }
      else { bearishPoints += 1; bearishReasons.push('price<SMA20'); }

      if (currentPrice > sma50) { bullishPoints += 1; bullishReasons.push('price>SMA50'); }
      else { bearishPoints += 1; bearishReasons.push('price<SMA50'); }

      // Momentum: RSI zones
      if (rsi < RSI_THRESHOLDS.OVERSOLD) { bullishPoints += 2; bullishReasons.push('RSI oversold'); }
      else if (rsi < RSI_THRESHOLDS.LOW) { bullishPoints += 1; bullishReasons.push('RSI low'); }
      else if (rsi > RSI_THRESHOLDS.OVERBOUGHT) { bearishPoints += 2; bearishReasons.push('RSI overbought'); }
      else if (rsi > RSI_THRESHOLDS.HIGH) { bearishPoints += 1; bearishReasons.push('RSI high'); }

      // MACD histogram direction
      if (macd.histogram > 0) { bullishPoints += 1; bullishReasons.push('MACD bullish'); }
      else if (macd.histogram < 0) { bearishPoints += 1; bearishReasons.push('MACD bearish'); }

      const netScore = bullishPoints - bearishPoints;
      // Max possible net score is ~5 (all bullish), min is ~-5 (all bearish)

      if (netScore >= SIGNAL_TIERS.STRONG.minScore) {
        action = 'BUY';
        confidence = SIGNAL_TIERS.STRONG.confidence;
        strength = SIGNAL_TIERS.STRONG.strength;
        reason = `Strong bullish: ${bullishReasons.join(', ')}`;
      } else if (netScore >= SIGNAL_TIERS.MODERATE.minScore) {
        action = 'BUY';
        confidence = SIGNAL_TIERS.MODERATE.confidence;
        strength = SIGNAL_TIERS.MODERATE.strength;
        reason = `Moderate bullish: ${bullishReasons.join(', ')}`;
      } else if (netScore >= SIGNAL_TIERS.MILD.minScore) {
        action = 'BUY';
        confidence = SIGNAL_TIERS.MILD.confidence;
        strength = SIGNAL_TIERS.MILD.strength;
        reason = `Mild bullish: ${bullishReasons.join(', ')}`;
      } else if (netScore <= -SIGNAL_TIERS.STRONG.minScore) {
        action = 'SELL';
        confidence = SIGNAL_TIERS.STRONG.confidence;
        strength = SIGNAL_TIERS.STRONG.strength;
        reason = `Strong bearish: ${bearishReasons.join(', ')}`;
      } else if (netScore <= -SIGNAL_TIERS.MODERATE.minScore) {
        action = 'SELL';
        confidence = SIGNAL_TIERS.MODERATE.confidence;
        strength = SIGNAL_TIERS.MODERATE.strength;
        reason = `Moderate bearish: ${bearishReasons.join(', ')}`;
      } else if (netScore <= -SIGNAL_TIERS.MILD.minScore) {
        action = 'SELL';
        confidence = SIGNAL_TIERS.MILD.confidence;
        strength = SIGNAL_TIERS.MILD.strength;
        reason = `Mild bearish: ${bearishReasons.join(', ')}`;
      } else {
        action = 'HOLD';
        confidence = SIGNAL_TIERS.NEUTRAL.confidence;
        strength = SIGNAL_TIERS.NEUTRAL.strength;
        reason = 'Evenly split signals - no clear direction';
      }

      logger.info(`Trading signal for ${symbol}:`, { action, confidence, strength });

      return { action, confidence, reason, strength };
    } catch (error) {
      logger.error('Trading signal error:', error);
      return {
        action: 'HOLD',
        confidence: 0,
        reason: `Error generating signal: ${error instanceof Error ? error.message : String(error)}`,
        strength: 0
      };
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return true; // Always healthy since it's pure JavaScript
  }
}

export default new SimpleMlService();
