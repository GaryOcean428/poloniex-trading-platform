export enum StrategyType {
  MA_CROSSOVER = 'MA_CROSSOVER',
  RSI = 'RSI',
  BREAKOUT = 'BREAKOUT'
}

export interface StrategyParameters {
  [key: string]: any;
  pair: string;
}

export interface MACrossoverParameters extends StrategyParameters {
  shortPeriod: number;
  longPeriod: number;
}

export interface RSIParameters extends StrategyParameters {
  period: number;
  overbought: number;
  oversold: number;
}

export interface BreakoutParameters extends StrategyParameters {
  lookbackPeriod: number;
  breakoutThreshold: number;
}

export interface StrategyPerformance {
  totalPnL: number;
  winRate: number;
  tradesCount: number;
}

export interface Strategy {
  id: string;
  name: string;
  type: StrategyType;
  parameters: StrategyParameters;
  created: string;
  performance?: StrategyPerformance;
}

export interface MarketData {
  pair: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  id: string;
  pair: string;
  timestamp: number;
  type: 'BUY' | 'SELL';
  price: number;
  amount: number;
  total: number;
  strategyId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
}

export interface ExchangeService {
  placeOrder: (pair: string, side: 'buy' | 'sell', type: 'limit' | 'market', quantity: number, price?: number) => Promise<any>;
  errors: string[];
  addError: (error: string) => void;
  clearErrors: () => void;
  refreshApiConnection: () => Promise<void>;
}