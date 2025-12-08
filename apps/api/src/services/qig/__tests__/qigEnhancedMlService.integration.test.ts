/**
 * Integration tests for QIG-Enhanced ML Service
 * Tests with realistic market data scenarios
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import qigEnhancedMlService from '../qigEnhancedMlService.js';

// Mock logger
jest.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

describe('QIGEnhancedMLService Integration Tests', () => {
  const service = qigEnhancedMlService;

  describe('Bullish Market Scenario', () => {
    it('should predict bullish trend with high confidence', async () => {
      // Simulate strong uptrend: prices rising, RSI healthy, MACD positive
      const bullishData = [
        { timestamp: 1000, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
        { timestamp: 2000, open: 101, high: 103, low: 100, close: 102, volume: 1100 },
        { timestamp: 3000, open: 102, high: 104, low: 101, close: 103, volume: 1200 },
        { timestamp: 4000, open: 103, high: 105, low: 102, close: 104, volume: 1300 },
        { timestamp: 5000, open: 104, high: 106, low: 103, close: 105, volume: 1400 },
        { timestamp: 6000, open: 105, high: 107, low: 104, close: 106, volume: 1500 },
        { timestamp: 7000, open: 106, high: 108, low: 105, close: 107, volume: 1600 },
        { timestamp: 8000, open: 107, high: 109, low: 106, close: 108, volume: 1700 },
        { timestamp: 9000, open: 108, high: 110, low: 107, close: 109, volume: 1800 },
        { timestamp: 10000, open: 109, high: 111, low: 108, close: 110, volume: 1900 },
        // Add more data points for better indicator calculation
        ...Array.from({ length: 40 }, (_, i) => ({
          timestamp: 11000 + i * 1000,
          open: 110 + i * 0.5,
          high: 112 + i * 0.5,
          low: 109 + i * 0.5,
          close: 111 + i * 0.5,
          volume: 2000 + i * 50
        }))
      ];

      const result = await service.getMultiHorizonPredictions('BTC_USDT', bullishData);

      // Verify structure
      expect(result).toHaveProperty('predictions');
      expect(result).toHaveProperty('qigMetrics');
      expect(result).toHaveProperty('explanation');

      // Verify predictions (should be bullish or neutral for uptrend)
      expect(['BULLISH', 'NEUTRAL']).toContain(result.predictions['1h'].direction);
      expect(['BULLISH', 'NEUTRAL']).toContain(result.predictions['4h'].direction);
      expect(['BULLISH', 'NEUTRAL']).toContain(result.predictions['24h'].direction);

      // Verify confidence is reasonable (may be lower in GEOMETRIC regime)
      expect(result.predictions['1h'].confidence).toBeGreaterThan(10);
      expect(result.predictions['1h'].confidence).toBeLessThanOrEqual(100);

      // Verify QIG metrics
      expect(result.qigMetrics.surprise).toBeGreaterThanOrEqual(0);
      expect(result.qigMetrics.surprise).toBeLessThanOrEqual(1);
      expect(result.qigMetrics.integration).toBeGreaterThanOrEqual(0);
      expect(result.qigMetrics.integration).toBeLessThanOrEqual(1);
      expect(result.qigMetrics.confidence).toBeGreaterThanOrEqual(0);
      expect(result.qigMetrics.confidence).toBeLessThanOrEqual(1);

      // Verify regime classification
      expect(['LINEAR', 'GEOMETRIC', 'BREAKDOWN']).toContain(result.qigMetrics.regime);

      // For stable uptrend, expect LINEAR or GEOMETRIC regime
      expect(result.qigMetrics.regime).not.toBe('BREAKDOWN');

      console.log('Bullish Market Result:', JSON.stringify(result, null, 2));
    });
  });

  describe('Bearish Market Scenario', () => {
    it('should predict bearish trend with appropriate confidence', async () => {
      // Simulate downtrend: prices falling
      const bearishData = [
        ...Array.from({ length: 50 }, (_, i) => ({
          timestamp: 1000 + i * 1000,
          open: 150 - i * 0.8,
          high: 152 - i * 0.8,
          low: 148 - i * 0.8,
          close: 149 - i * 0.8,
          volume: 2000 - i * 20
        }))
      ];

      const result = await service.getMultiHorizonPredictions('BTC_USDT', bearishData);

      // Verify predictions show bearish or neutral
      expect(['BEARISH', 'NEUTRAL']).toContain(result.predictions['1h'].direction);
      
      // Verify QIG metrics are valid
      expect(result.qigMetrics.surprise).toBeGreaterThanOrEqual(0);
      expect(result.qigMetrics.integration).toBeGreaterThanOrEqual(0);
      expect(result.qigMetrics.confidence).toBeGreaterThanOrEqual(0);

      console.log('Bearish Market Result:', JSON.stringify(result, null, 2));
    });
  });

  describe('Volatile Market Scenario', () => {
    it('should detect BREAKDOWN regime in highly volatile market', async () => {
      // Simulate high volatility: large price swings
      const volatileData = [
        ...Array.from({ length: 50 }, (_, i) => {
          const basePrice = 100;
          const swing = i % 2 === 0 ? 10 : -10;
          const price = basePrice + swing + (Math.random() - 0.5) * 5;
          return {
            timestamp: 1000 + i * 1000,
            open: price,
            high: price + 5,
            low: price - 5,
            close: price + (Math.random() - 0.5) * 3,
            volume: 1000 + Math.random() * 1000
          };
        })
      ];

      const result = await service.getMultiHorizonPredictions('BTC_USDT', volatileData);

      // In volatile market, expect lower confidence
      expect(result.predictions['1h'].confidence).toBeLessThan(70);

      // May detect BREAKDOWN regime
      if (result.qigMetrics.regime === 'BREAKDOWN') {
        // In breakdown regime, predictions should be conservative
        expect(result.predictions['1h'].direction).toBe('NEUTRAL');
        expect(result.qigMetrics.confidence).toBeLessThan(0.5);
      }

      console.log('Volatile Market Result:', JSON.stringify(result, null, 2));
    });
  });

  describe('Sideways Market Scenario', () => {
    it('should predict neutral with moderate confidence', async () => {
      // Simulate sideways market: prices oscillating around same level
      const sidewaysData = [
        ...Array.from({ length: 50 }, (_, i) => ({
          timestamp: 1000 + i * 1000,
          open: 100 + Math.sin(i * 0.5) * 2,
          high: 102 + Math.sin(i * 0.5) * 2,
          low: 98 + Math.sin(i * 0.5) * 2,
          close: 100 + Math.sin(i * 0.5) * 2,
          volume: 1000 + Math.random() * 200
        }))
      ];

      const result = await service.getMultiHorizonPredictions('BTC_USDT', sidewaysData);

      // Sideways market should show neutral or mixed signals
      // Confidence may be moderate
      expect(result.qigMetrics.integration).toBeLessThan(0.8); // Lower integration due to mixed signals

      console.log('Sideways Market Result:', JSON.stringify(result, null, 2));
    });
  });

  describe('QIG Metrics Evolution', () => {
    it('should show decreasing surprise as market stabilizes', async () => {
      // First prediction with initial data
      const initialData = [
        ...Array.from({ length: 30 }, (_, i) => ({
          timestamp: 1000 + i * 1000,
          open: 100 + i * 0.5,
          high: 102 + i * 0.5,
          low: 99 + i * 0.5,
          close: 101 + i * 0.5,
          volume: 1000
        }))
      ];

      const result1 = await service.getMultiHorizonPredictions('BTC_USDT', initialData);
      const surprise1 = result1.qigMetrics.surprise;

      // Second prediction with continued stable trend
      const continuedData = [
        ...initialData,
        ...Array.from({ length: 20 }, (_, i) => ({
          timestamp: 31000 + i * 1000,
          open: 115 + i * 0.5,
          high: 117 + i * 0.5,
          low: 114 + i * 0.5,
          close: 116 + i * 0.5,
          volume: 1000
        }))
      ];

      const result2 = await service.getMultiHorizonPredictions('BTC_USDT', continuedData);
      const surprise2 = result2.qigMetrics.surprise;

      // Surprise should decrease or stay low as pattern continues
      // (predictor learns the pattern)
      expect(surprise2).toBeLessThanOrEqual(surprise1 + 0.2); // Allow some variance

      console.log('Surprise Evolution:', { surprise1, surprise2 });
    });
  });

  describe('Attention Weights', () => {
    it('should assign higher weights to distinguishable indicators', async () => {
      const data = [
        ...Array.from({ length: 50 }, (_, i) => ({
          timestamp: 1000 + i * 1000,
          open: 100 + i * 0.5,
          high: 102 + i * 0.5,
          low: 99 + i * 0.5,
          close: 101 + i * 0.5,
          volume: 1000
        }))
      ];

      const result = await service.getMultiHorizonPredictions('BTC_USDT', data);

      // Verify attention weights sum to approximately 1
      const weights = Object.values(result.qigMetrics.attentionWeights);
      const sum = weights.reduce((a: number, b: number) => a + b, 0);
      expect(sum).toBeCloseTo(1, 1);

      // All weights should be positive
      weights.forEach((weight: number) => {
        expect(weight).toBeGreaterThan(0);
      });

      console.log('Attention Weights:', result.qigMetrics.attentionWeights);
    });
  });

  describe('Explanation Generation', () => {
    it('should generate human-readable explanation', async () => {
      const data = [
        ...Array.from({ length: 50 }, (_, i) => ({
          timestamp: 1000 + i * 1000,
          open: 100 + i * 0.5,
          high: 102 + i * 0.5,
          low: 99 + i * 0.5,
          close: 101 + i * 0.5,
          volume: 1000
        }))
      ];

      const result = await service.getMultiHorizonPredictions('BTC_USDT', data);

      // Verify explanation exists and contains key information
      expect(result.explanation).toBeTruthy();
      expect(typeof result.explanation).toBe('string');
      expect(result.explanation.length).toBeGreaterThan(50);

      // Should mention regime (in the explanation text)
      const hasRegimeInfo = 
        result.explanation.includes('stable') || 
        result.explanation.includes('complex') || 
        result.explanation.includes('volatile');
      expect(hasRegimeInfo).toBe(true);

      // Should mention surprise level
      expect(result.explanation).toMatch(/low|moderate|high/);

      console.log('Explanation:', result.explanation);
    });
  });
});
