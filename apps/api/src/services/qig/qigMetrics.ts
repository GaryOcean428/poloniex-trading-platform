/**
 * QIG Metrics Module
 * 
 * Implements Quantum Information Geometry principles for trading predictions:
 * - Surprise: QFI distance between predicted and actual market states
 * - Integration (Φ): Coherence across technical indicators
 * - Confidence: State purity weighted by prediction accuracy
 * - Regime: Linear/Geometric/Breakdown classification
 * 
 * Based on: scripts/QIF/RCP_v4.3_QIG_Enhanced_COMPLETE.md
 */

import { logger } from '../../utils/logger.js';

export interface MarketState {
  prices: number[];
  indicators: {
    sma20: number;
    sma50: number;
    ema12: number;
    rsi: number;
    macd: number;
    macdSignal: number;
    macdHistogram: number;
  };
  volume: number[];
  timestamp: number;
}

export interface QIGMetrics {
  surprise: number;           // [0-1] QFI distance from predicted state
  integration: number;        // [0-1] Φ - indicator coherence
  confidence: number;         // [0-1] State purity × (1 - surprise)
  regime: 'LINEAR' | 'GEOMETRIC' | 'BREAKDOWN';
  attentionWeights: Map<string, number>; // Dynamic indicator importance
  statePurity: number;        // [0-1] How "pure" the market state is
}

export class QIGMetricsCalculator {
  /**
   * Compute surprise: QFI distance between predicted and actual states
   * 
   * Based on Bures distance: d(ρ_pred, ρ_actual) = √(2(1-√F))
   * where F is fidelity between states
   * 
   * Simplified for classical states: normalized Euclidean distance
   */
  computeSurprise(predicted: MarketState, actual: MarketState): number {
    try {
      // Extract indicator vectors
      const predVector = this.stateToVector(predicted);
      const actualVector = this.stateToVector(actual);
      
      // Compute Euclidean distance
      let sumSquaredDiff = 0;
      let sumSquaredActual = 0;
      
      for (let i = 0; i < predVector.length; i++) {
        const diff = predVector[i] - actualVector[i];
        sumSquaredDiff += diff * diff;
        sumSquaredActual += actualVector[i] * actualVector[i];
      }
      
      // Normalize by magnitude of actual state
      const distance = Math.sqrt(sumSquaredDiff);
      const magnitude = Math.sqrt(sumSquaredActual);
      
      const normalizedDistance = magnitude > 0 ? distance / magnitude : 0;
      
      // Clamp to [0, 1]
      const surprise = Math.min(normalizedDistance, 1.0);
      
      logger.debug('QIG Surprise computed:', { surprise, distance, magnitude });
      
      return surprise;
    } catch (error: any) {
      logger.error('Error computing surprise:', error);
      return 0.5; // Neutral surprise on error
    }
  }
  
  /**
   * Compute integration (Φ): How unified are the technical indicators?
   * 
   * High Φ = indicators strongly agree (coherent signal)
   * Low Φ = indicators disagree (mixed signals)
   * 
   * Based on cross-correlation between indicator subsystems
   */
  computeIntegration(indicators: MarketState['indicators']): number {
    try {
      // Normalize indicators to [0, 1] range
      const normalized = this.normalizeIndicators(indicators);
      
      // Partition into subsystems
      const subsystems = [
        [normalized.sma20, normalized.sma50],           // Trend subsystem
        [normalized.ema12],                              // Momentum subsystem
        [normalized.rsi],                                // Oscillator subsystem
        [normalized.macd, normalized.macdHistogram]      // MACD subsystem
      ];
      
      // Compute correlations between subsystems
      const correlations: number[] = [];
      
      for (let i = 0; i < subsystems.length - 1; i++) {
        for (let j = i + 1; j < subsystems.length; j++) {
          const corr = this.computeSubsystemCorrelation(
            subsystems[i],
            subsystems[j]
          );
          correlations.push(Math.abs(corr));
        }
      }
      
      // Average correlation = integration proxy
      const integration = correlations.length > 0
        ? correlations.reduce((sum, c) => sum + c, 0) / correlations.length
        : 0.5;
      
      logger.debug('QIG Integration computed:', { integration, correlations });
      
      return integration;
    } catch (error: any) {
      logger.error('Error computing integration:', error);
      return 0.5; // Neutral integration on error
    }
  }
  
  /**
   * Compute confidence: State purity × (1 - surprise)
   * 
   * High confidence = low surprise + high purity (clear, expected state)
   * Low confidence = high surprise or low purity (unexpected or mixed state)
   */
  computeConfidence(surprise: number, statePurity: number): number {
    const confidence = statePurity * (1 - surprise);
    logger.debug('QIG Confidence computed:', { confidence, surprise, statePurity });
    return confidence;
  }
  
  /**
   * Compute state purity: How "definite" is the market state?
   * 
   * High purity = clear trend, strong signals
   * Low purity = mixed signals, uncertain state
   * 
   * Based on variance of normalized indicators
   */
  computeStatePurity(indicators: MarketState['indicators']): number {
    try {
      const normalized = this.normalizeIndicators(indicators);
      const values = Object.values(normalized);
      
      // Compute variance
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
      
      // High variance = low purity (mixed signals)
      // Low variance = high purity (coherent signals)
      const purity = 1 - Math.min(variance * 4, 1); // Scale variance to [0, 1]
      
      logger.debug('QIG State Purity computed:', { purity, variance, mean });
      
      return purity;
    } catch (error: any) {
      logger.error('Error computing state purity:', error);
      return 0.5; // Neutral purity on error
    }
  }
  
  /**
   * Classify market regime based on QIG metrics
   * 
   * LINEAR: Low volatility, high purity, simple strategies
   * GEOMETRIC: Moderate volatility, complex patterns, full analysis
   * BREAKDOWN: High volatility, low purity, risk-off
   */
  classifyRegime(
    state: MarketState,
    integration: number,
    statePurity: number
  ): 'LINEAR' | 'GEOMETRIC' | 'BREAKDOWN' {
    try {
      // Compute activation (average magnitude of normalized indicators)
      const normalized = this.normalizeIndicators(state.indicators);
      const activation = Object.values(normalized).reduce((sum, v) => sum + Math.abs(v - 0.5), 0) / 7;
      
      // Compute volatility (price variance)
      const volatility = this.computeVolatility(state.prices);
      
      // Regime classification based on RCP v4.3
      if (activation < 0.3 && statePurity > 0.7 && integration > 0.6) {
        return 'LINEAR';
      } else if (volatility > 0.15 || statePurity < 0.3 || integration < 0.3) {
        return 'BREAKDOWN';
      } else {
        return 'GEOMETRIC';
      }
    } catch (error: any) {
      logger.error('Error classifying regime:', error);
      return 'GEOMETRIC'; // Default to geometric on error
    }
  }
  
  /**
   * Compute attention weights: Dynamic indicator importance
   * 
   * Based on QFI distance - indicators with high distinguishability
   * get higher attention weights
   */
  computeAttentionWeights(
    indicators: MarketState['indicators'],
    surprise: number
  ): Map<string, number> {
    try {
      const weights = new Map<string, number>();
      const normalized = this.normalizeIndicators(indicators);
      
      // Temperature parameter for softmax (higher = more uniform)
      const temperature = 0.5 + surprise; // Higher surprise = more exploration
      
      // Compute "distinguishability" for each indicator
      // (distance from neutral 0.5 value)
      const distinguishability: Record<string, number> = {};
      for (const [key, value] of Object.entries(normalized)) {
        distinguishability[key] = Math.abs(value - 0.5);
      }
      
      // Softmax to get attention weights
      const expValues: Record<string, number> = {};
      let sumExp = 0;
      
      for (const [key, dist] of Object.entries(distinguishability)) {
        const expVal = Math.exp(dist / temperature);
        expValues[key] = expVal;
        sumExp += expVal;
      }
      
      for (const [key, expVal] of Object.entries(expValues)) {
        weights.set(key, expVal / sumExp);
      }
      
      logger.debug('QIG Attention Weights computed:', Object.fromEntries(weights));
      
      return weights;
    } catch (error: any) {
      logger.error('Error computing attention weights:', error);
      // Return uniform weights on error
      const uniformWeight = 1 / 7;
      return new Map([
        ['sma20', uniformWeight],
        ['sma50', uniformWeight],
        ['ema12', uniformWeight],
        ['rsi', uniformWeight],
        ['macd', uniformWeight],
        ['macdSignal', uniformWeight],
        ['macdHistogram', uniformWeight]
      ]);
    }
  }
  
  /**
   * Compute all QIG metrics for a market state
   */
  computeAllMetrics(predicted: MarketState, actual: MarketState): QIGMetrics {
    const surprise = this.computeSurprise(predicted, actual);
    const integration = this.computeIntegration(actual.indicators);
    const statePurity = this.computeStatePurity(actual.indicators);
    const confidence = this.computeConfidence(surprise, statePurity);
    const regime = this.classifyRegime(actual, integration, statePurity);
    const attentionWeights = this.computeAttentionWeights(actual.indicators, surprise);
    
    return {
      surprise,
      integration,
      confidence,
      regime,
      attentionWeights,
      statePurity
    };
  }
  
  // ========== Helper Methods ==========
  
  /**
   * Convert market state to vector for distance calculations
   */
  private stateToVector(state: MarketState): number[] {
    const ind = state.indicators;
    return [
      ind.sma20,
      ind.sma50,
      ind.ema12,
      ind.rsi,
      ind.macd,
      ind.macdSignal,
      ind.macdHistogram
    ];
  }
  
  /**
   * Normalize indicators to [0, 1] range
   */
  private normalizeIndicators(indicators: MarketState['indicators']): Record<string, number> {
    return {
      sma20: this.normalize(indicators.sma20, 0, 100000),
      sma50: this.normalize(indicators.sma50, 0, 100000),
      ema12: this.normalize(indicators.ema12, 0, 100000),
      rsi: indicators.rsi / 100, // RSI already in [0, 100]
      macd: this.normalize(indicators.macd, -1000, 1000),
      macdSignal: this.normalize(indicators.macdSignal, -1000, 1000),
      macdHistogram: this.normalize(indicators.macdHistogram, -500, 500)
    };
  }
  
  /**
   * Normalize value to [0, 1] range
   */
  private normalize(value: number, min: number, max: number): number {
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }
  
  /**
   * Compute correlation between two subsystems
   */
  private computeSubsystemCorrelation(subsystem1: number[], subsystem2: number[]): number {
    // For simplicity, use average values as proxy
    const avg1 = subsystem1.reduce((sum, v) => sum + v, 0) / subsystem1.length;
    const avg2 = subsystem2.reduce((sum, v) => sum + v, 0) / subsystem2.length;
    
    // Correlation proxy: 1 - |difference|
    return 1 - Math.abs(avg1 - avg2);
  }
  
  /**
   * Compute volatility (normalized standard deviation of prices)
   */
  private computeVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    
    const recentPrices = prices.slice(-20); // Last 20 periods
    const mean = recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length;
    const variance = recentPrices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / recentPrices.length;
    const stdDev = Math.sqrt(variance);
    
    // Normalize by mean
    return mean > 0 ? stdDev / mean : 0;
  }
}

export default new QIGMetricsCalculator();
