import { MarketData, Strategy, StrategyType, Trade } from '../types';

export interface Transaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE';
  description: string;
  amount: number;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  timestamp: number;
}

export const mockTransactions: Transaction[] = [
  {
    id: 'tx_1',
    type: 'DEPOSIT',
    description: 'USDT Deposit',
    amount: 5000,
    status: 'COMPLETED',
    timestamp: Date.now() - 24 * 60 * 60 * 1000
  },
  {
    id: 'tx_2',
    type: 'TRADE',
    description: 'BTC-USDT Buy',
    amount: 2500,
    status: 'COMPLETED',
    timestamp: Date.now() - 12 * 60 * 60 * 1000
  },
  {
    id: 'tx_3',
    type: 'WITHDRAWAL',
    description: 'USDT Withdrawal',
    amount: 1000,
    status: 'PENDING',
    timestamp: Date.now() - 6 * 60 * 60 * 1000
  },
  {
    id: 'tx_4',
    type: 'TRADE',
    description: 'ETH-USDT Sell',
    amount: 1500,
    status: 'COMPLETED',
    timestamp: Date.now() - 3 * 60 * 60 * 1000
  },
  {
    id: 'tx_5',
    type: 'DEPOSIT',
    description: 'BTC Deposit',
    amount: 3000,
    status: 'COMPLETED',
    timestamp: Date.now() - 1 * 60 * 60 * 1000
  }
];

// Generate mock market data for the past 100 periods
export const mockMarketData: MarketData[] = Array.from({ length: 100 }, (_, i) => {
  const basePrice = 50000 + Math.random() * 5000;
  const volatility = basePrice * 0.01;
  const timestamp = Date.now() - (99 - i) * 60 * 1000; // Last 100 minutes
  const open = basePrice + (Math.random() - 0.5) * volatility;
  const high = open + Math.random() * volatility;
  const low = open - Math.random() * volatility;
  const close = low + Math.random() * (high - low);
  
  return {
    pair: 'BTC-USDT',
    timestamp,
    open,
    high,
    low,
    close,
    volume: 100 + Math.random() * 900,
  };
});

export const mockStrategies: Strategy[] = [
  {
    id: '1',
    name: 'BTC Daily MA Crossover',
    type: StrategyType.MA_CROSSOVER,
    parameters: {
      shortPeriod: 10,
      longPeriod: 50,
      pair: 'BTC-USDT'
    },
    created: new Date().toISOString(),
    performance: {
      totalPnL: 12.5,
      winRate: 0.65,
      tradesCount: 24
    }
  },
  {
    id: '2',
    name: 'ETH RSI Strategy',
    type: StrategyType.RSI,
    parameters: {
      period: 14,
      overbought: 70,
      oversold: 30,
      pair: 'ETH-USDT'
    },
    created: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    performance: {
      totalPnL: 8.2,
      winRate: 0.58,
      tradesCount: 17
    }
  },
  {
    id: '3',
    name: 'BTC Breakout',
    type: StrategyType.BREAKOUT,
    parameters: {
      lookbackPeriod: 24,
      breakoutThreshold: 2.5,
      pair: 'BTC-USDT'
    },
    created: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    performance: {
      totalPnL: 15.7,
      winRate: 0.45,
      tradesCount: 11
    }
  }
];

// Generate mock trades with guaranteed unique IDs
export const mockTrades: Trade[] = [
  {
    id: 'mock-trade-1',
    pair: 'BTC-USDT',
    timestamp: Date.now() - 3 * 60 * 60 * 1000,
    type: 'BUY',
    price: 51234.56,
    amount: 0.05,
    total: 2561.73,
    strategyId: '1',
    status: 'COMPLETED'
  },
  {
    id: 'mock-trade-2',
    pair: 'BTC-USDT',
    timestamp: Date.now() - 2 * 60 * 60 * 1000,
    type: 'SELL',
    price: 51934.12,
    amount: 0.05,
    total: 2596.71,
    strategyId: '1',
    status: 'COMPLETED'
  },
  {
    id: 'mock-trade-3',
    pair: 'ETH-USDT',
    timestamp: Date.now() - 1 * 60 * 60 * 1000,
    type: 'BUY',
    price: 3245.78,
    amount: 0.25,
    total: 811.45,
    strategyId: '2',
    status: 'COMPLETED'
  },
  {
    id: 'mock-trade-4',
    pair: 'BTC-USDT',
    timestamp: Date.now() - 30 * 60 * 1000,
    type: 'BUY',
    price: 52100.45,
    amount: 0.03,
    total: 1563.01,
    strategyId: '3',
    status: 'PENDING'
  }
];