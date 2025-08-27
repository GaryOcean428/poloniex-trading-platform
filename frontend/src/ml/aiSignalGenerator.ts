import { MarketData } from '@/types';
import { logger } from '@/utils/logger';

export interface AISignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number; // 0-1
  reason: string;
  features: Record<string, number>;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  expectedReturn: number;
  stopLoss?: number;
  takeProfit?: number;
}

// Explicit feature set to satisfy strict typing
interface FeatureSet {
  currentPrice: number;
  priceChange: number;
  volatility: number;
  sma5: number;
  sma10: number;
  sma20: number;
  rsi: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  avgVolume: number;
  volumeRatio: number;
  momentum: number;
  pricePosition: number;
  [key: string]: number;
}

export interface AISignalConfig {
  lookbackPeriod: number;
  confidenceThreshold: number;
  riskTolerance: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
  enableRiskManagement: boolean;
  maxPositionSize: number;
}

/**
 * AI Signal Generation Service
 * Combines multiple technical indicators with machine learning predictions
 */
export class AISignalGenerator {
  private config: AISignalConfig;

  constructor(config: Partial<AISignalConfig> = {}) {
    this.config = {
      lookbackPeriod: 20,
      confidenceThreshold: 0.65,
      riskTolerance: 'MODERATE',
      enableRiskManagement: true,
      maxPositionSize: 0.1, // 10% of portfolio
      ...config
    };
  }

  /**
   * Generate AI-powered trading signal
   */
  public async generateSignal(marketData: MarketData[]): Promise<AISignal> {
    try {
      if (marketData.length < this.config.lookbackPeriod) {
        return {
          action: 'HOLD',
          confidence: 0,
          reason: 'Insufficient data for analysis',
          features: {},
          riskLevel: 'HIGH',
          expectedReturn: 0
        };
      }

      // Extract features
      const features = this.extractFeatures(marketData);

      // Calculate technical indicators
      const technicalSignal = this.calculateTechnicalSignal(features);

      // Apply ML prediction (simplified for now)
      const mlPrediction = this.calculateMLPrediction(features);

      // Combine signals
      const combinedSignal = this.combineSignals(technicalSignal, mlPrediction);

      // Apply risk management
      if (this.config.enableRiskManagement) {
        return this.applyRiskManagement(combinedSignal, features);
      }

      return combinedSignal;
    } catch (error) {
      logger.error('AI Signal generation error:', error instanceof Error ? error.message : String(error));
      return {
        action: 'HOLD',
        confidence: 0,
        reason: 'Signal generation error',
        features: {},
        riskLevel: 'HIGH',
        expectedReturn: 0
      };
    }
  }

  /**
   * Extract relevant features from market data
   */
  private extractFeatures(marketData: MarketData[]): FeatureSet {
    const recent = marketData.slice(-this.config.lookbackPeriod);
    const prices = recent.map(d => d.close ?? 0);
    const volumes = recent.map(d => d.volume ?? 0);

    // Price-based features
    const currentPrice = prices[prices.length - 1] ?? 0;
    const firstPrice = prices[0] ?? currentPrice;
    const denomPC = firstPrice !== 0 ? firstPrice : 1;
    const priceChange = (currentPrice - firstPrice) / denomPC;
    const volatility = this.calculateVolatility(prices);

    // Moving averages
    const sma5 = this.calculateSMA(prices, 5);
    const sma10 = this.calculateSMA(prices, 10);
    const sma20 = this.calculateSMA(prices, 20);

    // Technical indicators
    const rsi = this.calculateRSI(prices, 14);
    const macd = this.calculateMACD(prices);
    const bbands = this.calculateBollingerBands(prices, 20);

    // Volume features
    const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
    const lastVol = volumes[volumes.length - 1] ?? 0;
    const volumeRatio = avgVolume !== 0 ? lastVol / avgVolume : 0;

    // Momentum features
    const lastPrice = prices[prices.length - 1] ?? 0;
    const lookbackIdx = prices.length - 5;
    const refPrice = prices[lookbackIdx] ?? (prices[0] ?? lastPrice);
    const denomMom = refPrice !== 0 ? refPrice : 1;
    const momentum = (lastPrice - refPrice) / denomMom;

    return {
      currentPrice,
      priceChange,
      volatility,
      sma5,
      sma10,
      sma20,
      rsi,
      macdLine: macd.macd,
      macdSignal: macd.signal,
      macdHistogram: macd.histogram,
      bbUpper: bbands.upper,
      bbMiddle: bbands.middle,
      bbLower: bbands.lower,
      avgVolume,
      volumeRatio,
      momentum,
      pricePosition: (bbands.upper - bbands.lower) !== 0 ? (currentPrice - bbands.lower) / (bbands.upper - bbands.lower) : 0
    };
  }

  /**
   * Calculate technical analysis signal
   */
  private calculateTechnicalSignal(features: FeatureSet): AISignal {
    let score = 0;
    let confidence = 0;
    const reasons: string[] = [];

    // Moving Average signals
    if (features.sma5 > features.sma10 && features.sma10 > features.sma20) {
      score += 2;
      reasons.push('Strong uptrend (MA alignment)');
    } else if (features.sma5 < features.sma10 && features.sma10 < features.sma20) {
      score -= 2;
      reasons.push('Strong downtrend (MA alignment)');
    }

    // RSI signals
    if (features.rsi < 30) {
      score += 1.5;
      reasons.push('Oversold condition (RSI < 30)');
    } else if (features.rsi > 70) {
      score -= 1.5;
      reasons.push('Overbought condition (RSI > 70)');
    }

    // MACD signals
    if (features.macdLine > features.macdSignal && features.macdHistogram > 0) {
      score += 1;
      reasons.push('Bullish MACD signal');
    } else if (features.macdLine < features.macdSignal && features.macdHistogram < 0) {
      score -= 1;
      reasons.push('Bearish MACD signal');
    }

    // Bollinger Bands signals
    if (features.pricePosition < 0.2) {
      score += 1;
      reasons.push('Price near lower Bollinger Band');
    } else if (features.pricePosition > 0.8) {
      score -= 1;
      reasons.push('Price near upper Bollinger Band');
    }

    // Volume confirmation
    if (features.volumeRatio > 1.5) {
      score *= 1.2; // Boost signal with high volume
      reasons.push('High volume confirmation');
    }

    // Momentum
    if (features.momentum > 0.02) {
      score += 0.5;
      reasons.push('Positive momentum');
    } else if (features.momentum < -0.02) {
      score -= 0.5;
      reasons.push('Negative momentum');
    }

    // Convert score to action and confidence
    confidence = Math.min(Math.abs(score) / 5, 1);
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    if (score > 2 && confidence > this.config.confidenceThreshold) {
      action = 'BUY';
    } else if (score < -2 && confidence > this.config.confidenceThreshold) {
      action = 'SELL';
    }

    return {
      action,
      confidence,
      reason: reasons.join(', '),
      features,
      riskLevel: this.calculateRiskLevel(features),
      expectedReturn: this.calculateExpectedReturn(score, features)
    };
  }

  /**
   * Calculate ML prediction (simplified implementation)
   */
  private calculateMLPrediction(features: FeatureSet): AISignal {
    // This is a simplified ML prediction
    // In a real implementation, this would use trained models

    const weights = {
      priceChange: 0.3,
      rsi: -0.2, // Contrarian indicator
      macdHistogram: 0.4,
      momentum: 0.3,
      volumeRatio: 0.2,
      volatility: -0.1 // Lower volatility preferred
    };

    let mlScore = 0;
    Object.entries(weights).forEach(([feature, weight]) => {
      const val = features[feature] ?? 0;
      mlScore += this.normalizeFeature(val, feature) * weight;
    });

    const confidence = Math.min(Math.abs(mlScore), 1);
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    if (mlScore > 0.3) {
      action = 'BUY';
    } else if (mlScore < -0.3) {
      action = 'SELL';
    }

    return {
      action,
      confidence,
      reason: 'ML model prediction',
      features,
      riskLevel: this.calculateRiskLevel(features),
      expectedReturn: mlScore * 0.05 // Estimated 5% max return
    };
  }

  /**
   * Combine technical and ML signals
   */
  private combineSignals(techSignal: AISignal, mlSignal: AISignal): AISignal {
    // Weight the signals
    const techWeight = 0.6;
    const mlWeight = 0.4;

    // Convert actions to scores
    const techScore = techSignal.action === 'BUY' ? 1 : techSignal.action === 'SELL' ? -1 : 0;
    const mlScore = mlSignal.action === 'BUY' ? 1 : mlSignal.action === 'SELL' ? -1 : 0;

    // Combine scores
    const combinedScore = (techScore * techSignal.confidence * techWeight) +
                         (mlScore * mlSignal.confidence * mlWeight);

    const combinedConfidence = (techSignal.confidence * techWeight) +
                              (mlSignal.confidence * mlWeight);

    let finalAction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (combinedScore > 0.3 && combinedConfidence > this.config.confidenceThreshold) {
      finalAction = 'BUY';
    } else if (combinedScore < -0.3 && combinedConfidence > this.config.confidenceThreshold) {
      finalAction = 'SELL';
    }

    return {
      action: finalAction,
      confidence: combinedConfidence,
      reason: `Combined: ${techSignal.reason} + ${mlSignal.reason}`,
      features: techSignal.features,
      riskLevel: techSignal.riskLevel,
      expectedReturn: (techSignal.expectedReturn + mlSignal.expectedReturn) / 2
    };
  }

  /**
   * Apply risk management rules
   */
  private applyRiskManagement(signal: AISignal, features: FeatureSet): AISignal {
    // Adjust for risk tolerance
    const riskMultiplier = {
      'CONSERVATIVE': 0.5,
      'MODERATE': 1.0,
      'AGGRESSIVE': 1.5
    }[this.config.riskTolerance];

    // Calculate stop loss and take profit
    const currentPrice = features.currentPrice;
    const volatility = features.volatility;

    let stopLoss: number | undefined;
    let takeProfit: number | undefined;

    if (signal.action === 'BUY') {
      stopLoss = currentPrice * (1 - (volatility * 2)); // 2x volatility stop loss
      takeProfit = currentPrice * (1 + (signal.expectedReturn * riskMultiplier));
    } else if (signal.action === 'SELL') {
      stopLoss = currentPrice * (1 + (volatility * 2));
      takeProfit = currentPrice * (1 - (Math.abs(signal.expectedReturn) * riskMultiplier));
    }

    // Reduce confidence based on risk level
    let adjustedConfidence = signal.confidence;
    if (signal.riskLevel === 'HIGH') {
      adjustedConfidence *= 0.7;
    } else if (signal.riskLevel === 'MEDIUM') {
      adjustedConfidence *= 0.85;
    }

    return {
      ...signal,
      confidence: adjustedConfidence,
      stopLoss,
      takeProfit
    };
  }

  // Technical indicator calculations
  private calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] ?? 0;
    const recent = prices.slice(-period);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50; // Neutral

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      const curr = prices[i] ?? prices[i - 1] ?? 0;
      const prev = prices[i - 1] ?? curr;
      changes.push(curr - prev);
    }

    const recentChanges = changes.slice(-period);
    const gains = recentChanges.filter(c => c > 0);
    const losses = recentChanges.filter(c => c < 0).map(c => Math.abs(c));

    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;

    // Simplified signal line calculation
    const signal = this.calculateEMA([macd], 9);
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    if (prices.length === 1) return prices[0] ?? 0;

    const multiplier = 2 / (period + 1);
    let ema = prices[0] ?? 0;

    for (let i = 1; i < prices.length; i++) {
      const price = prices[i] ?? ema;
      ema = (price * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
  }

  private calculateBollingerBands(prices: number[], period: number): { upper: number; middle: number; lower: number } {
    const sma = this.calculateSMA(prices, period);
    const recent = prices.slice(-period);

    // Calculate standard deviation
    const variance = recent.reduce((acc, price) => acc + Math.pow(price - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    return {
      upper: sma + (stdDev * 2),
      middle: sma,
      lower: sma - (stdDev * 2)
    };
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      const curr = prices[i] ?? prices[i - 1] ?? 0;
      const prevRaw = prices[i - 1];
      const prev = prevRaw !== undefined ? prevRaw : curr;
      const denom = prev !== 0 ? prev : 1;
      returns.push((curr - prev) / denom);
    }

    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((acc, ret) => acc + Math.pow(ret - avgReturn, 2), 0) / returns.length;

    return Math.sqrt(variance);
  }

  private calculateRiskLevel(features: FeatureSet): 'LOW' | 'MEDIUM' | 'HIGH' {
    const volatility = features.volatility;
    const volumeRatio = features.volumeRatio;

    if (volatility > 0.05 || volumeRatio > 3) {
      return 'HIGH';
    } else if (volatility > 0.02 || volumeRatio > 1.5) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  private calculateExpectedReturn(score: number, features: FeatureSet): number {
    // Base expected return on signal strength and market conditions
    const baseReturn = Math.abs(score) * 0.02; // 2% max base return
    const volatilityAdjustment = Math.min(features.volatility * 5, 0.03); // Volatility can add up to 3%

    return Math.sign(score) * (baseReturn + volatilityAdjustment);
  }

  private normalizeFeature(value: number, featureName: string): number {
    // Simple normalization - in practice, this would use learned parameters
    switch (featureName) {
      case 'rsi':
        return (value - 50) / 50; // Normalize RSI to [-1, 1]
      case 'priceChange':
        return Math.max(-1, Math.min(1, value * 10)); // Cap at ±1
      case 'momentum':
        return Math.max(-1, Math.min(1, value * 20)); // Cap at ±1
      case 'volumeRatio':
        return Math.max(0, Math.min(2, value)) - 1; // Normalize to [-1, 1]
      case 'volatility':
        return Math.min(1, value * 100); // Normalize volatility
      default:
        return value;
    }
  }
}

// Export singleton instance
export const aiSignalGenerator = new AISignalGenerator();
