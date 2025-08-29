// Unified Strategy type definitions shared across frontend and backend

// Base parameters all strategies share
export interface BaseStrategyParameters {
  pair: string; // e.g., BTC-USDT
  timeframe: string; // e.g., 1h, 4h
  positionSize?: number; // optional % risk per trade or size unit
}

// Specific strategy parameter shapes
export interface MovingAverageCrossoverParameters extends BaseStrategyParameters {
  fastPeriod: number;
  slowPeriod: number;
  shortPeriod?: number;
  longPeriod?: number;
}

export interface RSIParameters extends BaseStrategyParameters {
  period: number;
  overbought: number;
  oversold: number;
  oversoldThreshold?: number;
  overboughtThreshold?: number;
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
  volatilityThreshold?: number;
}

export interface CustomParameters extends BaseStrategyParameters {
  [key: string]: unknown;
}

// Union of parameters across supported strategy types
export type StrategyParameters =
  | MovingAverageCrossoverParameters
  | RSIParameters
  | MACDParameters
  | BollingerBandsParameters
  | BreakoutParameters
  | CustomParameters;

// Performance metrics captured per strategy
export interface StrategyPerformance {
  totalPnL: number; // absolute PnL
  winRate: number; // 0..1
  tradesCount: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  profitFactor?: number;
}

// Supported identifiers
export type StrategyTypeUnion =
  | 'manual'
  | 'automated'
  | 'ml'
  | 'dqn'
  | 'MovingAverageCrossover'
  | 'RSI'
  | 'MACD'
  | 'BollingerBands'
  | 'Custom'
  | 'Breakout'
  | 'mean_reversion'
  | 'trend_following';

export type StrategyAlgorithm =
  | 'MovingAverageCrossover'
  | 'RSI'
  | 'MACD'
  | 'BollingerBands'
  | 'Custom'
  | 'Breakout';


// Compatibility enum-like constant for UI and mock data
// Provides both runtime values and a type alias usable in generics
export const StrategyType = {
  MA_CROSSOVER: 'MovingAverageCrossover',
  RSI: 'RSI',
  MACD: 'MACD',
  BOLLINGER_BANDS: 'BollingerBands',
  BREAKOUT: 'Breakout'
} as const;


// Unified Strategy interface
export interface Strategy {
  id: string;
  name: string;
  type: StrategyTypeUnion; // logical classification
  active: boolean;
  algorithm?: StrategyAlgorithm; // technical algorithm used
  parameters: StrategyParameters;
  performance?: StrategyPerformance;
  createdAt?: string; // ISO string timestamps
  updatedAt?: string;
}

// Optional signal interface retained for compatibility
export interface StrategySignal {
  strategyId: string;
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
  timestamp: number;
}
