// Unified Strategy interface for Polytrade
// Single source of truth for strategy definitions across frontend and backend

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
  positionSize?: number; // Position size as a percentage of the account balance
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

export interface CustomParameters extends BaseStrategyParameters {
  [key: string]: unknown;
}

export type StrategyParameters =
  | MovingAverageCrossoverParameters
  | RSIParameters
  | MACDParameters
  | BollingerBandsParameters
  | BreakoutParameters
  | CustomParameters;

export interface StrategyPerformance {
  totalPnL: number;
  totalPnl?: number; // FIXME strict: Legacy support - remove after migration
  winRate: number;
  tradesCount: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  profitFactor?: number;
}

// FIXME strict: Temporary extended type union for backward compatibility
export type StrategyTypeUnion = 
  | 'manual' | 'automated' | 'ml' | 'dqn' // Core types
  | 'MovingAverageCrossover' | 'RSI' | 'MACD' | 'BollingerBands' | 'Custom' | 'Breakout'; // Algorithm types

// Unified Strategy interface - single source of truth
export interface Strategy {
  id: string;
  name: string;
  type: StrategyTypeUnion; // FIXME strict: Use union type temporarily
  algorithm?: 'MovingAverageCrossover' | 'RSI' | 'MACD' | 'BollingerBands' | 'Custom' | 'Breakout';
  active: boolean;
  parameters: StrategyParameters;
  performance?: StrategyPerformance;
  createdAt?: string | number; // FIXME strict: Support both string and number timestamps
  updatedAt?: string;
}

// Export TradingStrategy as alias to Strategy for compatibility
export type TradingStrategy = Strategy;
