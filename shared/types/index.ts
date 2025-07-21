// Shared types for the Poloniex Trading Platform

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
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

export interface StrategyParameters {
  [key: string]: number | string | boolean;
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
  // Compatibility with strategyTester.ts
  entryDate?: Date;
  exitDate?: Date | null;
  type?: 'BUY' | 'SELL';
  quantity?: number;
  profit?: number;
  profitPercent?: number;
  confidence?: number;
}

export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  timestamp: number;
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
}

export interface OrderBook {
  asks: OrderBookEntry[];
  bids: OrderBookEntry[];
}

export interface TradingStrategy {
  id: string;
  name: string;
  type: 'manual' | 'automated' | 'ml' | 'dqn';
  algorithm?: 'MovingAverageCrossover' | 'RSI' | 'MACD' | 'BollingerBands' | 'Custom';
  active: boolean;
  parameters: Record<string, any>;
  performance?: {
    totalPnl: number;
    winRate: number;
    sharpeRatio: number;
  };
}

// Alias for backward compatibility
export type Strategy = TradingStrategy;