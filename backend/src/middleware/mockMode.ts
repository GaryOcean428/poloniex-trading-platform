import { Request, Response, NextFunction } from 'express';

export const MOCK_MODE = process.env.MOCK_MODE === 'true';

export function mockModeMiddleware(req: Request, res: Response, next: NextFunction) {
  if (MOCK_MODE) {
    (req as any).mockMode = true;
  }
  next();
}

// Mock user for development
export const MOCK_USER = {
  id: '7e989bb1-9bbf-442d-a778-2086cd27d6ab',
  email: 'demo@poloniex.com',
  name: 'Demo User'
};

// Mock API credentials
export const MOCK_CREDENTIALS = {
  id: '82b03785-08d5-43cb-a4ee-578ec2ea77fe',
  userId: MOCK_USER.id,
  exchange: 'poloniex',
  apiKey: 'MOCK_API_KEY',
  apiSecret: 'MOCK_API_SECRET',
  isActive: true,
  lastUsedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date()
};

// Mock balance data
export const MOCK_BALANCE = {
  totalBalance: 10000.00,
  availableBalance: 9500.00,
  marginBalance: 10000.00,
  unrealizedPnL: 150.00,
  currency: 'USDT',
  source: 'mock'
};

// Mock strategies
export const MOCK_STRATEGIES = [
  {
    id: 'mock-strategy-1',
    name: 'RSI Mean Reversion',
    type: 'mean_reversion',
    status: 'backtested',
    symbol: 'BTC_USDT',
    timeframe: '15m',
    indicators: ['RSI', 'Volume'],
    description: 'Buy when RSI < 30, sell when RSI > 70',
    performance: {
      winRate: 0.65,
      profitFactor: 1.8,
      totalTrades: 150,
      totalReturn: 0.25
    },
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  },
  {
    id: 'mock-strategy-2',
    name: 'Moving Average Crossover',
    type: 'trend_following',
    status: 'paper_trading',
    symbol: 'ETH_USDT',
    timeframe: '1h',
    indicators: ['SMA', 'EMA'],
    description: 'Buy when fast MA crosses above slow MA',
    performance: {
      winRate: 0.58,
      profitFactor: 1.5,
      totalTrades: 89,
      totalReturn: 0.18
    },
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  },
  {
    id: 'mock-strategy-3',
    name: 'Bollinger Band Breakout',
    type: 'breakout',
    status: 'generated',
    symbol: 'BTC_USDT',
    timeframe: '4h',
    indicators: ['Bollinger Bands', 'Volume'],
    description: 'Buy on upper band breakout with volume confirmation',
    performance: {
      winRate: 0,
      profitFactor: 0,
      totalTrades: 0,
      totalReturn: 0
    },
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  }
];

// Mock backtest results
export const MOCK_BACKTEST_RESULTS = {
  winRate: 0.65,
  profitFactor: 1.8,
  totalReturn: 0.25,
  totalTrades: 150,
  winningTrades: 98,
  losingTrades: 52,
  averageWin: 2.5,
  averageLoss: -1.2,
  sharpeRatio: 1.5,
  maxDrawdown: 0.08,
  trades: [
    {
      entryTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      exitTime: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000),
      entryPrice: 42000,
      exitPrice: 43050,
      pnl: 1050,
      pnlPercent: 2.5,
      type: 'long'
    }
  ]
};
