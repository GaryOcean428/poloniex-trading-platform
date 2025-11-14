/**
 * Unit tests for QIG Metrics Calculator
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { QIGMetricsCalculator, MarketState } from '../qigMetrics.js';

// Mock logger to avoid import issues
jest.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

describe('QIGMetricsCalculator', () => {
  let calculator: QIGMetricsCalculator;
  let mockState: MarketState;

  beforeEach(() => {
    calculator = new QIGMetricsCalculator();
    
    mockState = {
      prices: [100, 101, 102, 103, 104, 105],
      indicators: {
        sma20: 102,
        sma50: 100,
        ema12: 103,
        rsi: 55,
        macd: 1.5,
        macdSignal: 1.2,
        macdHistogram: 0.3
      },
      volume: [1000, 1100, 1050, 1200, 1150, 1100],
      timestamp: Date.now()
    };
  });

  describe('computeSurprise', () => {
    it('should return 0 for identical states', () => {
      const surprise = calculator.computeSurprise(mockState, mockState);
      expect(surprise).toBe(0);
    });

    it('should return > 0 for different states', () => {
      const differentState = {
        ...mockState,
        indicators: {
          ...mockState.indicators,
          rsi: 75, // Changed from 55
          macd: 3.0 // Changed from 1.5
        }
      };
      
      const surprise = calculator.computeSurprise(mockState, differentState);
      expect(surprise).toBeGreaterThan(0);
      expect(surprise).toBeLessThanOrEqual(1);
    });

    it('should return higher surprise for more different states', () => {
      const slightlyDifferent = {
        ...mockState,
        indicators: { ...mockState.indicators, rsi: 60 }
      };
      
      const veryDifferent = {
        ...mockState,
        indicators: {
          sma20: 200,
          sma50: 190,
          ema12: 205,
          rsi: 90,
          macd: 10,
          macdSignal: 8,
          macdHistogram: 2
        }
      };
      
      const surprise1 = calculator.computeSurprise(mockState, slightlyDifferent);
      const surprise2 = calculator.computeSurprise(mockState, veryDifferent);
      
      expect(surprise2).toBeGreaterThan(surprise1);
    });
  });

  describe('computeIntegration', () => {
    it('should return value between 0 and 1', () => {
      const integration = calculator.computeIntegration(mockState.indicators);
      expect(integration).toBeGreaterThanOrEqual(0);
      expect(integration).toBeLessThanOrEqual(1);
    });

    it('should compute integration based on indicator correlation', () => {
      // Test that integration is computed and returns valid range
      const indicators = {
        sma20: 100,
        sma50: 95,
        ema12: 102,
        rsi: 60,
        macd: 2.0,
        macdSignal: 1.5,
        macdHistogram: 0.5
      };
      
      const integration = calculator.computeIntegration(indicators);
      
      // Integration should be in valid range
      expect(integration).toBeGreaterThanOrEqual(0);
      expect(integration).toBeLessThanOrEqual(1);
      
      // For these coherent indicators, expect moderate to high integration
      expect(integration).toBeGreaterThan(0.3);
    });
  });

  describe('computeStatePurity', () => {
    it('should return value between 0 and 1', () => {
      const purity = calculator.computeStatePurity(mockState.indicators);
      expect(purity).toBeGreaterThanOrEqual(0);
      expect(purity).toBeLessThanOrEqual(1);
    });

    it('should return higher purity for coherent signals', () => {
      // All indicators near same normalized value (high purity)
      const coherentIndicators = {
        sma20: 100,
        sma50: 100,
        ema12: 100,
        rsi: 50,
        macd: 0,
        macdSignal: 0,
        macdHistogram: 0
      };
      
      // Indicators spread across range (low purity)
      const mixedIndicators = {
        sma20: 50,
        sma50: 150,
        ema12: 75,
        rsi: 90,
        macd: -5,
        macdSignal: 5,
        macdHistogram: 3
      };
      
      const coherentPurity = calculator.computeStatePurity(coherentIndicators);
      const mixedPurity = calculator.computeStatePurity(mixedIndicators);
      
      expect(coherentPurity).toBeGreaterThan(mixedPurity);
    });
  });

  describe('computeConfidence', () => {
    it('should return value between 0 and 1', () => {
      const confidence = calculator.computeConfidence(0.3, 0.8);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    });

    it('should be high when surprise is low and purity is high', () => {
      const highConfidence = calculator.computeConfidence(0.1, 0.9);
      const lowConfidence = calculator.computeConfidence(0.8, 0.3);
      
      expect(highConfidence).toBeGreaterThan(lowConfidence);
      expect(highConfidence).toBeGreaterThan(0.7);
      expect(lowConfidence).toBeLessThan(0.3);
    });
  });

  describe('classifyRegime', () => {
    it('should classify stable market as LINEAR', () => {
      const stableState: MarketState = {
        prices: [100, 100.5, 101, 101.5, 102], // Low volatility
        indicators: {
          sma20: 101,
          sma50: 100,
          ema12: 101.5,
          rsi: 52, // Neutral
          macd: 0.5,
          macdSignal: 0.4,
          macdHistogram: 0.1
        },
        volume: [1000, 1000, 1000, 1000, 1000],
        timestamp: Date.now()
      };
      
      const integration = 0.8; // High integration
      const purity = 0.9; // High purity
      
      const regime = calculator.classifyRegime(stableState, integration, purity);
      expect(regime).toBe('LINEAR');
    });

    it('should classify volatile market as BREAKDOWN', () => {
      const volatileState: MarketState = {
        prices: [100, 110, 95, 115, 90], // High volatility
        indicators: {
          sma20: 102,
          sma50: 100,
          ema12: 105,
          rsi: 45,
          macd: 2.0,
          macdSignal: 1.0,
          macdHistogram: 1.0
        },
        volume: [1000, 2000, 500, 3000, 400],
        timestamp: Date.now()
      };
      
      const integration = 0.2; // Low integration
      const purity = 0.2; // Low purity
      
      const regime = calculator.classifyRegime(volatileState, integration, purity);
      expect(regime).toBe('BREAKDOWN');
    });

    it('should classify moderate market as GEOMETRIC', () => {
      const regime = calculator.classifyRegime(mockState, 0.6, 0.6);
      expect(regime).toBe('GEOMETRIC');
    });
  });

  describe('computeAttentionWeights', () => {
    it('should return weights that sum to approximately 1', () => {
      const weights = calculator.computeAttentionWeights(mockState.indicators, 0.3);
      
      const sum = Array.from(weights.values()).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 2);
    });

    it('should give higher weight to more distinguishable indicators', () => {
      const indicators = {
        sma20: 100,
        sma50: 100,
        ema12: 100,
        rsi: 95, // Very distinguishable (far from neutral 50)
        macd: 0,
        macdSignal: 0,
        macdHistogram: 0
      };
      
      const weights = calculator.computeAttentionWeights(indicators, 0.2); // Lower surprise = less exploration
      const rsiWeight = weights.get('rsi') || 0;
      const macdWeight = weights.get('macd') || 0;
      
      // RSI should have higher weight due to extreme value
      // Compare with macd which is at neutral 0
      expect(rsiWeight).toBeGreaterThan(macdWeight);
    });

    it('should have all positive weights', () => {
      const weights = calculator.computeAttentionWeights(mockState.indicators, 0.3);
      
      for (const weight of weights.values()) {
        expect(weight).toBeGreaterThan(0);
      }
    });
  });

  describe('computeAllMetrics', () => {
    it('should return complete QIG metrics', () => {
      const predicted = { ...mockState };
      const actual = {
        ...mockState,
        indicators: { ...mockState.indicators, rsi: 60 }
      };
      
      const metrics = calculator.computeAllMetrics(predicted, actual);
      
      expect(metrics).toHaveProperty('surprise');
      expect(metrics).toHaveProperty('integration');
      expect(metrics).toHaveProperty('confidence');
      expect(metrics).toHaveProperty('regime');
      expect(metrics).toHaveProperty('attentionWeights');
      expect(metrics).toHaveProperty('statePurity');
      
      expect(['LINEAR', 'GEOMETRIC', 'BREAKDOWN']).toContain(metrics.regime);
    });
  });
});
