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
  amount: number;
  price: number;
  timestamp: number;
  fee?: number;
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
  amount: number;
}

export interface OrderBook {
  asks: OrderBookEntry[];
  bids: OrderBookEntry[];
}

export interface TradingStrategy {
  id: string;
  name: string;
  type: 'manual' | 'automated' | 'ml' | 'dqn';
  active: boolean;
  parameters: Record<string, any>;
  performance?: {
    totalPnl: number;
    winRate: number;
    sharpeRatio: number;
  };
}