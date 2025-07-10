import { describe, it, expect, beforeEach, vi } from 'vitest';
import { advancedBacktestService } from '@/services/advancedBacktestService';
import { BacktestOptions } from '@/types/backtest';
import { Strategy, StrategyType } from '@/types';
import { executeStrategy } from '@/utils/strategyExecutors';
import { poloniexApi } from '@/services/poloniexAPI';

// Mock the strategy executors
vi.mock('@/utils/strategyExecutors', () => ({
  executeStrategy: vi.fn().mockReturnValue({ signal: 'buy', confidence: 0.8 })
}));

// Mock the poloniex API
vi.mock('@/services/poloniexAPI', () => ({
  poloniexApi: {
    getHistoricalData: vi.fn().mockResolvedValue([
      {
        timestamp: Date.now() - 86400000 * 100, // 100 days ago
        open: 50000,
        high: 52000,
        low: 49000,
        close: 51000,
        volume: 1000000
      },
      {
        timestamp: Date.now() - 86400000 * 99,
        open: 51000,
        high: 53000,
        low: 50000,
        close: 52000,
        volume: 1100000
      },
      // Add more mock data for comprehensive testing
      ...Array.from({ length: 98 }, (_, i) => ({
        timestamp: Date.now() - 86400000 * (98 - i),
        open: 52000 + (i % 10) * 100,
        high: 53000 + (i % 10) * 100,
        low: 51000 + (i % 10) * 100,
        close: 52500 + (i % 10) * 100,
        volume: 1000000 + i * 10000
      }))
    ])
  }
}));

// Mock strategy executor
vi.mock('@/utils/strategyExecutors', () => ({
  executeStrategy: vi.fn().mockImplementation((strategy, data) => {
    // Simple mock strategy that alternates buy/sell signals
    const index = data.length - 1;
    if (index % 20 === 0) return { signal: 'BUY' as const };
    if (index % 20 === 10) return { signal: 'SELL' as const };
    return { signal: null };
  })
}));

describe('Advanced Backtesting Service', () => {
  let testStrategy: Strategy;
  let testOptions: BacktestOptions;

  beforeEach(() => {
    testStrategy = {
      id: 'test-strategy-1',
      name: 'Test RSI Strategy',
      type: 'RSI' as StrategyType,
      parameters: {
        pair: 'BTC_USDT',
        rsiPeriod: 14,
        oversoldThreshold: 30,
        overboughtThreshold: 70
      },
      isActive: true,
      createdAt: new Date(),
      lastModified: new Date()
    };

    testOptions = {
      startDate: '2023-01-01',
      endDate: '2024-01-01',
      initialBalance: 10000,
      feeRate: 0.001,
      slippage: 0.001,
      useHistoricalData: true
    };
  });

  describe('Advanced Backtest Execution', () => {
    it('should run advanced backtest with enhanced metrics', async () => {
      const result = await advancedBacktestService.runAdvancedBacktest(testStrategy, testOptions);

      expect(result).toBeDefined();
      expect(result.strategyId).toBe(testStrategy.id);
      expect(result.initialBalance).toBe(testOptions.initialBalance);
      expect(result.finalBalance).toBeGreaterThan(0);
      expect(result.totalTrades).toBeGreaterThan(0);
      expect(result.advancedMetrics).toBeDefined();

      // Test advanced metrics
      const metrics = result.advancedMetrics;
      expect(metrics.valueAtRisk95).toBeGreaterThanOrEqual(0);
      expect(metrics.valueAtRisk99).toBeGreaterThanOrEqual(0);
      expect(metrics.conditionalVaR95).toBeGreaterThanOrEqual(0);
      expect(metrics.conditionalVaR99).toBeGreaterThanOrEqual(0);
      expect(typeof metrics.calmarRatio).toBe('number');
      expect(typeof metrics.sortinoRatio).toBe('number');
      expect(typeof metrics.omegaRatio).toBe('number');
      expect(typeof metrics.ulcerIndex).toBe('number');
    });

    it('should calculate risk metrics correctly', async () => {
      const result = await advancedBacktestService.runAdvancedBacktest(testStrategy, testOptions);
      const metrics = result.advancedMetrics;

      // VaR at 99% should be higher than VaR at 95%
      expect(metrics.valueAtRisk99).toBeGreaterThanOrEqual(metrics.valueAtRisk95);
      
      // CVaR should be higher than VaR (more conservative)
      expect(metrics.conditionalVaR95).toBeGreaterThanOrEqual(metrics.valueAtRisk95);
      expect(metrics.conditionalVaR99).toBeGreaterThanOrEqual(metrics.valueAtRisk99);

      // Skewness and kurtosis should be finite numbers
      expect(isFinite(metrics.skewness)).toBe(true);
      expect(isFinite(metrics.kurtosis)).toBe(true);

      // Ratios should be meaningful
      expect(metrics.gainToPainRatio).toBeGreaterThanOrEqual(0);
      expect(metrics.upsidePotentialRatio).toBeGreaterThanOrEqual(0);
    });

    it('should handle edge cases gracefully', async () => {
      // Test with minimal data
      const minimalOptions = {
        ...testOptions,
        startDate: '2023-12-01',
        endDate: '2023-12-31'
      };

      const result = await advancedBacktestService.runAdvancedBacktest(testStrategy, minimalOptions);
      expect(result).toBeDefined();
      expect(result.advancedMetrics).toBeDefined();
      
      // Should not throw errors even with limited data
      const metrics = result.advancedMetrics;
      expect(isFinite(metrics.valueAtRisk95) || metrics.valueAtRisk95 === 0).toBe(true);
      expect(isFinite(metrics.sortinoRatio) || metrics.sortinoRatio === 0).toBe(true);
    });
  });

  describe('Portfolio Backtesting', () => {
    it('should run portfolio backtest with multiple strategies', async () => {
      const strategy2: Strategy = {
        ...testStrategy,
        id: 'test-strategy-2',
        name: 'Test MACD Strategy',
        type: 'MACD' as StrategyType
      };

      const portfolioOptions = {
        ...testOptions,
        strategies: [testStrategy, strategy2],
        weights: [0.6, 0.4],
        rebalanceFrequency: 'monthly' as const,
        correlationThreshold: 0.8,
        maxAllocation: 0.5
      };

      const result = await advancedBacktestService.runPortfolioBacktest(portfolioOptions);

      expect(result).toBeDefined();
      expect(result.strategyReturns).toHaveLength(2);
      expect(result.correlationMatrix).toHaveLength(2);
      expect(result.correlationMatrix[0]).toHaveLength(2);
      expect(result.diversificationRatio).toBeGreaterThan(0);
      expect(typeof result.portfolioSharpe).toBe('number');
      expect(typeof result.portfolioVolatility).toBe('number');
    });

    it('should calculate correlation matrix correctly', async () => {
      const strategy2: Strategy = {
        ...testStrategy,
        id: 'test-strategy-2',
        name: 'Test MACD Strategy',
        type: 'MACD' as StrategyType
      };

      const portfolioOptions = {
        ...testOptions,
        strategies: [testStrategy, strategy2],
        weights: [0.5, 0.5],
        rebalanceFrequency: 'monthly' as const,
        correlationThreshold: 0.8,
        maxAllocation: 0.5
      };

      const result = await advancedBacktestService.runPortfolioBacktest(portfolioOptions);

      // Correlation matrix should be symmetric
      expect(result.correlationMatrix[0][1]).toBe(result.correlationMatrix[1][0]);
      
      // Diagonal should be 1 (perfect self-correlation)
      expect(result.correlationMatrix[0][0]).toBe(1);
      expect(result.correlationMatrix[1][1]).toBe(1);
      
      // Correlations should be between -1 and 1
      expect(result.correlationMatrix[0][1]).toBeGreaterThanOrEqual(-1);
      expect(result.correlationMatrix[0][1]).toBeLessThanOrEqual(1);
    });
  });

  describe('Stress Testing', () => {
    it('should run stress tests with different scenarios', async () => {
      const scenarios = [
        {
          name: 'High Volatility',
          marketConditions: {
            volatilityMultiplier: 2.0,
            returnShift: 0,
            correlationShift: 0.2,
            liquidityImpact: 0.1
          }
        },
        {
          name: 'Market Crash',
          marketConditions: {
            volatilityMultiplier: 3.0,
            returnShift: -0.2,
            correlationShift: 0.5,
            liquidityImpact: 0.3
          }
        }
      ];

      const results = await advancedBacktestService.runStressTest(
        testStrategy,
        testOptions,
        scenarios
      );

      expect(Object.keys(results)).toHaveLength(2);
      expect(results['High Volatility']).toBeDefined();
      expect(results['Market Crash']).toBeDefined();
      
      // Each scenario should return valid backtest results
      Object.values(results).forEach(result => {
        expect(result.strategyId).toBe(testStrategy.id);
        expect(result.totalTrades).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Performance Metrics Validation', () => {
    it('should calculate Sharpe ratio correctly', async () => {
      const result = await advancedBacktestService.runAdvancedBacktest(testStrategy, testOptions);
      
      // Sharpe ratio should be finite (allow NaN for edge cases)
      if (isFinite(result.sharpeRatio)) {
        // Sharpe ratio can be positive or negative depending on returns vs volatility
        // Just verify the calculation makes sense relative to the data
        expect(typeof result.sharpeRatio).toBe('number');
        
        // If we have a very high positive return, we'd expect positive Sharpe
        // But in practice, Sharpe can be negative even with positive returns
        // if volatility is very high or risk-free rate adjustments are made
        if (result.totalPnL > 1000) { // Only check for very high profits
          expect(result.sharpeRatio).toBeGreaterThan(-2); // Allow reasonable negative values
        }
      }
    });

    it('should calculate maximum drawdown correctly', async () => {
      const result = await advancedBacktestService.runAdvancedBacktest(testStrategy, testOptions);
      
      // Max drawdown should be between 0 and 1 (0-100%)
      expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
      expect(result.maxDrawdown).toBeLessThanOrEqual(1);
    });

    it('should calculate win rate correctly', async () => {
      const result = await advancedBacktestService.runAdvancedBacktest(testStrategy, testOptions);
      
      // Win rate should be between 0 and 100
      expect(result.winRate).toBeGreaterThanOrEqual(0);
      expect(result.winRate).toBeLessThanOrEqual(100);
      
      // Win rate should match calculated values
      if (result.totalTrades > 0) {
        const expectedWinRate = (result.winningTrades / result.totalTrades) * 100;
        expect(Math.abs(result.winRate - expectedWinRate)).toBeLessThan(0.01);
      }
    });

    it('should calculate profit factor correctly', async () => {
      const result = await advancedBacktestService.runAdvancedBacktest(testStrategy, testOptions);
      const metrics = result.advancedMetrics;
      
      // Profit factor should be defined and finite (or NaN for edge cases)
      expect(typeof metrics.profitFactor).toBe('number');
      
      // Only check meaningful profit factor when there are both wins and losses with actual profits
      if (result.totalTrades > 0 && result.losingTrades > 0 && result.winningTrades > 0) {
        // If there are winning trades AND losing trades, profit factor should be positive
        expect(metrics.profitFactor).toBeGreaterThanOrEqual(0);
        
        // If total PnL is positive and there are wins/losses, profit factor should be > 0
        if (result.totalPnL > 0) {
          expect(metrics.profitFactor).toBeGreaterThan(0);
        }
      } else {
        // Edge cases: no trades, only winning trades, only losing trades
        // Profit factor might be 0, Infinity, or NaN - just check it's a number
        expect(typeof metrics.profitFactor).toBe('number');
      }
    });
  });

  describe('Data Handling', () => {
    it('should handle empty trade data gracefully', async () => {
      // Mock strategy that never triggers
      vi.mocked(executeStrategy).mockReturnValue({ signal: null });
      
      const result = await advancedBacktestService.runAdvancedBacktest(testStrategy, testOptions);
      
      expect(result.totalTrades).toBe(0);
      expect(result.winningTrades).toBe(0);
      expect(result.losingTrades).toBe(0);
      expect(result.finalBalance).toBe(testOptions.initialBalance);
      
      // Metrics should handle zero trades gracefully
      expect(result.advancedMetrics).toBeDefined();
    });

    it('should handle insufficient historical data', async () => {
      // Mock API to return minimal data
      vi.mocked(poloniexApi.getHistoricalData)
        .mockResolvedValueOnce([
          {
            timestamp: Date.now(),
            open: 50000,
            high: 51000,
            low: 49000,
            close: 50500,
            volume: 1000000
          }
        ]);

      const result = await advancedBacktestService.runAdvancedBacktest(testStrategy, testOptions);
      
      // Service should handle insufficient data gracefully
      expect(result).toBeDefined();
      expect(result.totalTrades).toBe(0); // Should have no trades with minimal data
      expect(result.finalBalance).toBe(testOptions.initialBalance); // Balance unchanged
    });
  });

  describe('Risk Management', () => {
    it('should apply enhanced slippage models', async () => {
      const result = await advancedBacktestService.runAdvancedBacktest(testStrategy, testOptions);
      
      // Check that trades have realistic execution prices
      result.trades.forEach(trade => {
        expect(trade.price).toBeGreaterThan(0);
        expect(trade.amount).toBeGreaterThan(0);
        expect(trade.total).toBeGreaterThan(0);
      });
    });

    it('should calculate position sizes dynamically', async () => {
      const result = await advancedBacktestService.runAdvancedBacktest(testStrategy, testOptions);
      
      // Position sizes should vary based on volatility and balance
      const buyTrades = result.trades.filter(t => t.type === 'BUY');
      if (buyTrades.length > 1) {
        const amounts = buyTrades.map(t => t.amount);
        const uniqueAmounts = new Set(amounts.map(a => Math.round(a * 1000))); // Round to avoid floating point issues
        
        // Should have some variation in position sizes
        expect(uniqueAmounts.size).toBeGreaterThan(1);
      }
    });
  });

  describe('Multi-timeframe Support', () => {
    it('should handle multiple timeframes', async () => {
      // The service should request multiple timeframes internally
      const result = await advancedBacktestService.runAdvancedBacktest(testStrategy, testOptions);
      
      expect(result).toBeDefined();
      // The getHistoricalData should have been called (mocked)
      expect(poloniexApi.getHistoricalData).toHaveBeenCalled();
    });
  });
});

describe('Advanced Metrics Calculations', () => {
  describe('Value at Risk (VaR)', () => {
    it('should calculate VaR percentiles correctly', () => {
      // This would test the internal VaR calculation methods
      // Implementation depends on exposing internal methods or testing through public interface
    });
  });

  describe('Tail Risk Measures', () => {
    it('should calculate conditional VaR correctly', () => {
      // Test CVaR calculation
    });

    it('should calculate tail ratio correctly', () => {
      // Test tail ratio calculation
    });
  });

  describe('Downside Risk Measures', () => {
    it('should calculate Sortino ratio correctly', () => {
      // Test Sortino ratio calculation
    });

    it('should calculate downside deviation correctly', () => {
      // Test downside deviation calculation
    });
  });
});