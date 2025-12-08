/**
 * Mock Mode Configuration
 * Enables testing without real API keys or live trading
 */

export const mockModeConfig = {
  // Enable/disable mock mode
  enabled: process.env.MOCK_MODE === 'true' || process.env.NODE_ENV === 'test',

  // Mock user for testing
  mockUser: {
    id: 999999,
    email: 'mock@test.com',
    username: 'MockUser',
    password: 'MockPassword123!'
  },

  // Mock API credentials
  mockCredentials: {
    apiKey: 'MOCK_API_KEY',
    apiSecret: 'MOCK_API_SECRET',
    passphrase: 'MOCK_PASSPHRASE'
  },

  // Mock trading settings
  mockTrading: {
    initialBalance: 10000, // USDT
    enableSlippage: true,
    slippagePercent: 0.1,
    enableFees: true,
    feePercent: 0.1,
    enableLatency: true,
    latencyMs: 100
  },

  // Mock strategy generation
  mockStrategyGeneration: {
    enabled: true,
    generateCount: 5,
    generationTimeMs: 2000, // Simulate AI thinking time
    mockStrategies: [
      {
        name: 'BTC_Momentum_Breakout',
        description: 'Momentum-based breakout strategy for BTC',
        entryConditions: 'RSI > 60 AND Price > EMA20',
        exitConditions: 'RSI < 40 OR StopLoss triggered',
        riskManagement: {
          stopLoss: 5,
          takeProfit: 10,
          positionSize: 2
        }
      },
      {
        name: 'ETH_Mean_Reversion',
        description: 'Mean reversion strategy for ETH',
        entryConditions: 'RSI < 30 AND Price < BB_Lower',
        exitConditions: 'RSI > 50 OR Price > BB_Middle',
        riskManagement: {
          stopLoss: 3,
          takeProfit: 6,
          positionSize: 2
        }
      },
      {
        name: 'Multi_Pair_Trend_Following',
        description: 'Trend following across multiple pairs',
        entryConditions: 'EMA50 > EMA200 AND MACD > Signal',
        exitConditions: 'EMA50 < EMA200 OR MACD < Signal',
        riskManagement: {
          stopLoss: 4,
          takeProfit: 8,
          positionSize: 1.5
        }
      },
      {
        name: 'Volatility_Breakout',
        description: 'Breakout strategy based on volatility',
        entryConditions: 'ATR > ATR_MA AND Price > BB_Upper',
        exitConditions: 'ATR < ATR_MA OR Price < EMA20',
        riskManagement: {
          stopLoss: 6,
          takeProfit: 12,
          positionSize: 1
        }
      },
      {
        name: 'Support_Resistance_Bounce',
        description: 'Trade bounces off support/resistance levels',
        entryConditions: 'Price near Support AND RSI < 35',
        exitConditions: 'Price near Resistance OR RSI > 65',
        riskManagement: {
          stopLoss: 3,
          takeProfit: 9,
          positionSize: 2.5
        }
      }
    ]
  },

  // Mock backtesting results
  mockBacktesting: {
    enabled: true,
    backtestTimeMs: 1000, // Simulate backtest time per strategy
    generateRealisticResults: true,
    mockResults: [
      {
        strategyName: 'BTC_Momentum_Breakout',
        score: 85,
        totalTrades: 120,
        winRate: 68,
        profitFactor: 2.3,
        sharpeRatio: 1.8,
        maxDrawdown: 12.5,
        totalReturn: 45.2
      },
      {
        strategyName: 'ETH_Mean_Reversion',
        score: 78,
        totalTrades: 95,
        winRate: 62,
        profitFactor: 1.9,
        sharpeRatio: 1.5,
        maxDrawdown: 15.3,
        totalReturn: 32.8
      },
      {
        strategyName: 'Multi_Pair_Trend_Following',
        score: 72,
        totalTrades: 80,
        winRate: 58,
        profitFactor: 1.6,
        sharpeRatio: 1.2,
        maxDrawdown: 18.7,
        totalReturn: 28.4
      },
      {
        strategyName: 'Volatility_Breakout',
        score: 65,
        totalTrades: 110,
        winRate: 55,
        profitFactor: 1.4,
        sharpeRatio: 1.0,
        maxDrawdown: 22.1,
        totalReturn: 18.9
      },
      {
        strategyName: 'Support_Resistance_Bounce',
        score: 58,
        totalTrades: 75,
        winRate: 52,
        profitFactor: 1.2,
        sharpeRatio: 0.8,
        maxDrawdown: 25.4,
        totalReturn: 12.3
      }
    ]
  },

  // Mock paper trading
  mockPaperTrading: {
    enabled: true,
    acceleratedTime: true, // 1 hour = 1 minute in mock mode
    accelerationFactor: 60,
    generateTrades: true,
    tradesPerHour: 2
  },

  // Logging
  logging: {
    logMockOperations: true,
    logLevel: 'info'
  }
};

/**
 * Check if mock mode is enabled
 */
export function isMockMode(): boolean {
  return mockModeConfig.enabled;
}

/**
 * Get mock user credentials
 */
export function getMockUser() {
  return mockModeConfig.mockUser;
}

/**
 * Get mock API credentials
 */
export function getMockCredentials() {
  return mockModeConfig.mockCredentials;
}

/**
 * Log mock operation
 */
export function logMockOperation(operation: string, details?: any) {
  if (mockModeConfig.logging.logMockOperations) {
    console.log(`[MOCK MODE] ${operation}`, details || '');
  }
}
