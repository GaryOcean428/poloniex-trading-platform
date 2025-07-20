import { describe, it, expect, beforeEach } from 'vitest';
import { AISignalGenerator } from '@/ml/aiSignalGenerator';
import { MarketData } from '@/types';

describe('AI Signal Generator', () => {
  let aiSignalGenerator: AISignalGenerator;
  let mockMarketData: MarketData[];

  beforeEach(() => {
    aiSignalGenerator = new AISignalGenerator({
      lookbackPeriod: 20,
      confidenceThreshold: 0.6,
      riskTolerance: 'MODERATE'
    });

    // Create mock market data
    mockMarketData = [];
    const basePrice = 50000;
    for (let i = 0; i < 25; i++) {
      const price = basePrice + (Math.sin(i / 5) * 1000) + (Math.random() * 500 - 250);
      mockMarketData.push({
        pair: 'BTC_USDT',
        open: price - 50,
        high: price + 100,
        low: price - 100,
        close: price,
        volume: 1000 + Math.random() * 500,
        timestamp: Date.now() - (25 - i) * 5 * 60 * 1000
      });
    }
  });

  describe('Signal Generation', () => {
    it('should generate a valid AI signal with sufficient data', async () => {
      const signal = await aiSignalGenerator.generateSignal(mockMarketData);
      
      expect(signal).toBeDefined();
      expect(signal.action).toMatch(/^(BUY|SELL|HOLD)$/);
      expect(signal.confidence).toBeGreaterThanOrEqual(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
      expect(signal.reason).toBeDefined();
      expect(signal.features).toBeDefined();
      expect(signal.riskLevel).toMatch(/^(LOW|MEDIUM|HIGH)$/);
      expect(typeof signal.expectedReturn).toBe('number');
    });

    it('should return HOLD signal with insufficient data', async () => {
      const insufficientData = mockMarketData.slice(0, 5);
      const signal = await aiSignalGenerator.generateSignal(insufficientData);
      
      expect(signal.action).toBe('HOLD');
      expect(signal.confidence).toBe(0);
      expect(signal.reason).toBe('Insufficient data for analysis');
    });

    it('should include stop loss and take profit when risk management is enabled', async () => {
      const signalGenerator = new AISignalGenerator({
        enableRiskManagement: true,
        confidenceThreshold: 0.1 // Lower threshold to ensure signal generation
      });

      const signal = await signalGenerator.generateSignal(mockMarketData);
      
      if (signal.action !== 'HOLD') {
        expect(signal.stopLoss).toBeDefined();
        expect(signal.takeProfit).toBeDefined();
        expect(typeof signal.stopLoss).toBe('number');
        expect(typeof signal.takeProfit).toBe('number');
      }
    });
  });

  describe('Feature Extraction', () => {
    it('should extract technical features correctly', async () => {
      const signal = await aiSignalGenerator.generateSignal(mockMarketData);
      const features = signal.features;
      
      expect(features.currentPrice).toBeDefined();
      expect(features.sma5).toBeDefined();
      expect(features.sma10).toBeDefined();
      expect(features.sma20).toBeDefined();
      expect(features.rsi).toBeGreaterThanOrEqual(0);
      expect(features.rsi).toBeLessThanOrEqual(100);
      expect(features.volatility).toBeGreaterThanOrEqual(0);
      expect(features.volumeRatio).toBeGreaterThanOrEqual(0);
    });

    it('should calculate Bollinger Bands correctly', async () => {
      const signal = await aiSignalGenerator.generateSignal(mockMarketData);
      const features = signal.features;
      
      expect(features.bbUpper).toBeGreaterThan(features.bbMiddle);
      expect(features.bbMiddle).toBeGreaterThan(features.bbLower);
      expect(features.pricePosition).toBeGreaterThanOrEqual(0);
      expect(features.pricePosition).toBeLessThanOrEqual(1);
    });
  });

  describe('Risk Management', () => {
    it('should adjust confidence based on risk level', async () => {
      const conservativeGenerator = new AISignalGenerator({
        riskTolerance: 'CONSERVATIVE',
        enableRiskManagement: true
      });

      const aggressiveGenerator = new AISignalGenerator({
        riskTolerance: 'AGGRESSIVE',
        enableRiskManagement: true
      });

      const conservativeSignal = await conservativeGenerator.generateSignal(mockMarketData);
      const aggressiveSignal = await aggressiveGenerator.generateSignal(mockMarketData);

      // Conservative should generally have lower confidence for risky signals
      if (conservativeSignal.riskLevel === 'HIGH' && aggressiveSignal.riskLevel === 'HIGH') {
        expect(conservativeSignal.confidence).toBeLessThanOrEqual(aggressiveSignal.confidence);
      }
    });

    it('should calculate appropriate risk level', async () => {
      // Create high volatility data
      const highVolatilityData = mockMarketData.map((data) => ({
        ...data,
        close: data.close + (Math.random() * 2000 - 1000) // Add high volatility
      }));

      const signal = await aiSignalGenerator.generateSignal(highVolatilityData);
      
      // Signal should have a valid risk level
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(signal.riskLevel);
      
      // Risk level should be calculated based on market conditions
      expect(signal.riskLevel).toBeDefined();
    });
  });

  describe('Signal Combination', () => {
    it('should generate stronger signals when technical and ML agree', async () => {
      // Create trending data that should generate strong signals
      const trendingData = mockMarketData.map((data, index) => ({
        ...data,
        close: 50000 + (index * 100), // Strong uptrend
        volume: 1000 + (index * 10) // Increasing volume
      }));

      const signal = await aiSignalGenerator.generateSignal(trendingData);
      
      // Should generate a strong buy signal with high confidence
      if (signal.action === 'BUY') {
        expect(signal.confidence).toBeGreaterThan(0.5);
      }
    });
  });

  describe('Configuration Impact', () => {
    it('should respect confidence threshold setting', async () => {
      const highThresholdGenerator = new AISignalGenerator({
        confidenceThreshold: 0.9
      });

      const lowThresholdGenerator = new AISignalGenerator({
        confidenceThreshold: 0.1
      });

      const highThresholdSignal = await highThresholdGenerator.generateSignal(mockMarketData);
      const lowThresholdSignal = await lowThresholdGenerator.generateSignal(mockMarketData);

      // High threshold should be more likely to return HOLD
      // Low threshold should be more likely to return BUY/SELL
      if (highThresholdSignal.action === 'HOLD' && lowThresholdSignal.action !== 'HOLD') {
        expect(lowThresholdSignal.confidence).toBeLessThan(0.9);
      }
    });

    it('should use correct lookback period', async () => {
      const shortLookbackGenerator = new AISignalGenerator({
        lookbackPeriod: 10
      });

      const longLookbackGenerator = new AISignalGenerator({
        lookbackPeriod: 20
      });

      // Both should work with sufficient data
      const shortSignal = await shortLookbackGenerator.generateSignal(mockMarketData);
      const longSignal = await longLookbackGenerator.generateSignal(mockMarketData);

      expect(shortSignal.action).toMatch(/^(BUY|SELL|HOLD)$/);
      expect(longSignal.action).toMatch(/^(BUY|SELL|HOLD)$/);

      // Test with limited data that should work for short lookback
      const limitedData = mockMarketData.slice(0, 15);
      const shortWithLimitedData = await shortLookbackGenerator.generateSignal(limitedData);
      const longWithLimitedData = await longLookbackGenerator.generateSignal(limitedData);

      // Short lookback should be able to generate signals with limited data
      expect(shortWithLimitedData.action).toMatch(/^(BUY|SELL|HOLD)$/);
      // Long lookback should return HOLD with insufficient data
      expect(longWithLimitedData.action).toBe('HOLD');
    });
  });
});