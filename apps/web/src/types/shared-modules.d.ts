// Ambient module declarations for @shared/types imports
// This is a temporary fix to unblock TypeScript compilation during Railway builds
// TODO: Replace with proper shared package or local types

declare module '@shared/types' {
  export interface OrderBookEntry {
    price: number;
    quantity: number;
  }

  export interface TradeData {
    id: string;
    symbol: string;
    price: number;
    quantity: number;
    side: 'buy' | 'sell';
    timestamp: number;
  }

  export interface TickerData {
    symbol: string;
    price: number;
    lastPrice: number;
    bidPrice: number;
    askPrice: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    change24h: number;
    changePercent24h: number;
    timestamp: number;
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
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    price: number;
    timestamp: number;
    fee?: number;
  }

  export interface BacktestTrade {
    id: string;
    entryPrice: number;
    exitPrice: number | null;
    entryTime: string;
    exitTime: string | null;
    side: 'long' | 'short';
    status: 'open' | 'closed' | 'stopped';
    pnl: number;
    pnlPercent: number;
    balance: number;
    size: number;
    fee: number;
    reason?: string;
    metadata?: Record<string, unknown>;
    highestProfit?: number;
    entryDate?: Date;
    exitDate?: Date | null;
    type?: 'BUY' | 'SELL';
    quantity?: number;
    profit?: number;
    profitPercent?: number;
    confidence?: number;
  }

  export enum StrategyType {
    MOVING_AVERAGE_CROSSOVER = 'MovingAverageCrossover',
    MA_CROSSOVER = 'MovingAverageCrossover',
    RSI = 'RSI',
    MACD = 'MACD',
    BOLLINGER_BANDS = 'BollingerBands',
    BREAKOUT = 'Breakout',
    CUSTOM = 'Custom'
  }

  export interface BaseStrategyParameters {
    pair: string;
    timeframe: string;
    positionSize?: number;
  }

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

  export type StrategyParameters =
    | MovingAverageCrossoverParameters
    | RSIParameters
    | MACDParameters
    | BollingerBandsParameters
    | BreakoutParameters
    | CustomParameters;

  export interface StrategyPerformance {
    totalPnL: number;
    totalPnl?: number;
    winRate: number;
    tradesCount: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    profitFactor?: number;
  }

  export type StrategyTypeUnion = 
    | 'manual' | 'automated' | 'ml' | 'dqn'
    | 'MovingAverageCrossover' | 'RSI' | 'MACD' | 'BollingerBands' | 'Custom' | 'Breakout'
    | 'mean_reversion' | 'trend_following';

  export interface Strategy {
    id: string;
    name: string;
    description?: string;
    type: StrategyTypeUnion;
    algorithm?: 'MovingAverageCrossover' | 'RSI' | 'MACD' | 'BollingerBands' | 'Custom' | 'Breakout';
    active: boolean;
    isActive?: boolean;
    parameters: StrategyParameters;
    performance?: StrategyPerformance;
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    createdAt?: string | number;
    updatedAt?: string;
    lastModified?: string | number;
  }

  export type TradingStrategy = Strategy;
}

declare module '@shared/types/strategy' {
  export * from '@shared/types';
}

declare module '@shared/types/*' {
  const value: unknown;
  export = value;
}

declare module '../../../shared/types' {
  const value: unknown;
  export = value;
}

declare module '../../../shared/types/*' {
  const value: unknown;
  export = value;
}