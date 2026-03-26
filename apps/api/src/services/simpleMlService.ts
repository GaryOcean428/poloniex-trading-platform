/**
 * Simple ML Service (JavaScript-based fallback)
 * Provides basic technical analysis-based predictions when Python ML models are unavailable
 */

import { logger } from '../utils/logger.js';

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
    if (data.length < period + 1) return 50; // Neutral
    
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
    const ema12 = this.calculateEMA(data, 12);
    const ema26 = this.calculateEMA(data, 26);
    const macd = ema12 - ema26;
    
    // For signal line, we'd need to calculate EMA of MACD values
    // Simplified: use a basic approximation
    const signal = macd * 0.9; // Approximation
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
      const sma20 = this.calculateSMA(closePrices, 20);
      const sma50 = this.calculateSMA(closePrices, 50);
      const ema12 = this.calculateEMA(closePrices, 12);
      const rsi = this.calculateRSI(closePrices);
      const macd = this.calculateMACD(closePrices);
      
      // Determine trend strength
      const trendStrength = Math.abs(currentPrice - sma20) / sma20;
      const momentum = (currentPrice - closePrices[closePrices.length - 10]) / closePrices[closePrices.length - 10];
      
      // Calculate predictions for different horizons
      const predictions = {
        '1h': this.predictPrice(currentPrice, sma20, ema12, rsi, macd, trendStrength, momentum, 0.005),
        '4h': this.predictPrice(currentPrice, sma20, ema12, rsi, macd, trendStrength, momentum, 0.02),
        '24h': this.predictPrice(currentPrice, sma50, ema12, rsi, macd, trendStrength, momentum, 0.05)
      };
      
      logger.info(`Simple ML predictions for ${symbol}:`, predictions);
      
      return predictions;
    } catch (error: any) {
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
    if (currentPrice > sma) bullishScore += 0.2;
    if (currentPrice > ema) bullishScore += 0.2;
    if (rsi < 30) bullishScore += 0.3; // Oversold
    if (rsi > 50 && rsi < 70) bullishScore += 0.1; // Healthy uptrend
    if (macd.histogram > 0) bullishScore += 0.2;
    if (momentum > 0) bullishScore += 0.2;
    
    // Bearish signals
    let bearishScore = 0;
    if (currentPrice < sma) bearishScore += 0.2;
    if (currentPrice < ema) bearishScore += 0.2;
    if (rsi > 70) bearishScore += 0.3; // Overbought
    if (rsi < 50 && rsi > 30) bearishScore += 0.1; // Healthy downtrend
    if (macd.histogram < 0) bearishScore += 0.2;
    if (momentum < 0) bearishScore += 0.2;
    
    // Determine direction and confidence
    const netScore = bullishScore - bearishScore;
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    let confidence: number;
    let priceChange: number;
    
    if (netScore > 0.2) {
      direction = 'BULLISH';
      confidence = Math.min(netScore * 50 + 30, 85);
      priceChange = horizonFactor * (1 + trendStrength);
    } else if (netScore < -0.2) {
      direction = 'BEARISH';
      confidence = Math.min(Math.abs(netScore) * 50 + 30, 85);
      priceChange = -horizonFactor * (1 + trendStrength);
    } else {
      direction = 'NEUTRAL';
      confidence = 40;
      priceChange = horizonFactor * 0.3 * (Math.random() - 0.5);
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
      const sma20 = this.calculateSMA(closePrices, 20);
      const sma50 = this.calculateSMA(closePrices, 50);
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
      const reasons: string[] = [];

      // Trend: price vs moving averages
      if (currentPrice > sma20) { bullishPoints += 1; reasons.push('+price>SMA20'); }
      else { bearishPoints += 1; reasons.push('+price<SMA20'); }

      if (currentPrice > sma50) { bullishPoints += 1; reasons.push('+price>SMA50'); }
      else { bearishPoints += 1; reasons.push('+price<SMA50'); }

      // Momentum: RSI zones
      if (rsi < 30) { bullishPoints += 2; reasons.push('+RSI oversold'); }
      else if (rsi < 45) { bullishPoints += 1; reasons.push('+RSI low'); }
      else if (rsi > 70) { bearishPoints += 2; reasons.push('+RSI overbought'); }
      else if (rsi > 55) { bearishPoints += 1; reasons.push('+RSI high'); }

      // MACD histogram direction
      if (macd.histogram > 0) { bullishPoints += 1; reasons.push('+MACD bullish'); }
      else if (macd.histogram < 0) { bearishPoints += 1; reasons.push('+MACD bearish'); }

      const netScore = bullishPoints - bearishPoints;
      // Max possible net score is ~5 (all bullish), min is ~-5 (all bearish)

      if (netScore >= 3) {
        action = 'BUY';
        confidence = 80;
        strength = 0.8;
        reason = `Strong bullish: ${reasons.filter(r => r.startsWith('+')).join(', ')}`;
      } else if (netScore >= 2) {
        action = 'BUY';
        confidence = 70;
        strength = 0.65;
        reason = `Moderate bullish: ${reasons.filter(r => r.startsWith('+')).join(', ')}`;
      } else if (netScore >= 1) {
        action = 'BUY';
        confidence = 60;
        strength = 0.5;
        reason = `Mild bullish: ${reasons.filter(r => r.startsWith('+')).join(', ')}`;
      } else if (netScore <= -3) {
        action = 'SELL';
        confidence = 80;
        strength = 0.8;
        reason = `Strong bearish: ${reasons.filter(r => r.startsWith('+')).join(', ')}`;
      } else if (netScore <= -2) {
        action = 'SELL';
        confidence = 70;
        strength = 0.65;
        reason = `Moderate bearish: ${reasons.filter(r => r.startsWith('+')).join(', ')}`;
      } else if (netScore <= -1) {
        action = 'SELL';
        confidence = 60;
        strength = 0.5;
        reason = `Mild bearish: ${reasons.filter(r => r.startsWith('+')).join(', ')}`;
      } else {
        action = 'HOLD';
        confidence = 50;
        strength = 0.3;
        reason = 'Evenly split signals - no clear direction';
      }
      
      logger.info(`Trading signal for ${symbol}:`, { action, confidence, strength });
      
      return { action, confidence, reason, strength };
    } catch (error: any) {
      logger.error('Trading signal error:', error);
      return {
        action: 'HOLD',
        confidence: 0,
        reason: `Error generating signal: ${error.message}`,
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
