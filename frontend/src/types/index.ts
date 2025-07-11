export enum StrategyType {
  MOVING_AVERAGE_CROSSOVER = 'MovingAverageCrossover',
  MA_CROSSOVER = 'MovingAverageCrossover', // Alias for backward compatibility
  RSI = 'RSI',
  MACD = 'MACD',
  BOLLINGER_BANDS = 'BollingerBands',
  BREAKOUT = 'Breakout',
  CUSTOM = 'Custom'
}

export interface BaseStrategyParameters {
  pair: string;
  timeframe: string;
}

export interface MovingAverageCrossoverParameters extends BaseStrategyParameters {
  fastPeriod: number;
  slowPeriod: number;
  // For backward compatibility
  shortPeriod?: number;
  longPeriod?: number;
}

export interface RSIParameters extends BaseStrategyParameters {
  period: number;
  overbought: number;
  oversold: number;
}

export interface MACDParameters extends BaseStrategyParameters {
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
}

export interface BollingerBandsParameters extends BaseStrategyParameters {
  period: number;
  stdDev: number;
}

export interface BreakoutParameters extends BaseStrategyParameters {
  lookbackPeriod: number;
  breakoutThreshold: number;
}

export type StrategyParameters = 
  | MovingAverageCrossoverParameters 
  | RSIParameters 
  | MACDParameters 
  | BollingerBandsParameters
  | BreakoutParameters;

export interface StrategyPerformance {
  totalPnL: number;
  winRate: number;
  tradesCount: number;
}

export interface Strategy {
  id: string;
  name: string;
  type: string;
  parameters: StrategyParameters;
  createdAt: string;
  updatedAt: string;
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

export interface Position {
  id: string;
  pair: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  size: number;
  leverage: number;
  marginMode: 'ISOLATED' | 'CROSS';
  liquidationPrice: number;
  unrealizedPnL: number;
  marginRatio: number;
  timestamp: number;
}

export interface FuturesOrder {
  id: string;
  pair: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET' | 'POST_ONLY' | 'FOK' | 'IOC';
  price?: number;
  size: number;
  value: number;
  leverage: number;
  marginMode: 'ISOLATED' | 'CROSS';
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED';
  timestamp: number;
}

export interface ExchangeService {
  placeOrder: (pair: string, side: 'BUY' | 'SELL', type: 'LIMIT' | 'MARKET', quantity: number, price?: number) => Promise<unknown>;
  errors: string[];
  addError: (error: string) => void;
  clearErrors: () => void;
  refreshApiConnection: () => Promise<void>;
}
