// Shared type definitions for Poloniex Trading Platform

// Core domain types
export interface TradeSignal {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  timestamp: number;
  confidence: number;
  strategy: string;
  metadata?: Record<string, any>;
}

export type PositionSide = 'long' | 'short';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop-limit';
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';

export interface Position {
  id: string;
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  pnl: number;
  pnlPercentage: number;
  openTime: number;
  closeTime?: number;
  status: 'open' | 'closed' | 'pending';
}

export interface RiskMetrics {
  maxDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  riskRewardRatio: number;
  valueAtRisk: number;
  beta?: number;
  alpha?: number;
}

// Market data (current snapshot)
export interface MarketData {
  symbol: string;
  price: number;
  volume24h: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
}

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  status: 'pending' | 'filled' | 'partially-filled' | 'cancelled' | 'rejected';
  filledQuantity: number;
  averagePrice: number;
  createdAt: number;
  updatedAt: number;
  executedAt?: number;
}

export interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPercent: number;
  dailyReturn: number;
  weeklyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  allTimeHigh: number;
  allTimeLow: number;
  currentDrawdown: number;
}

export interface RiskLimits {
  maxPositionSize: number;
  maxDrawdown: number;
  maxLeverage: number;
  stopLoss: number;
  takeProfit: number;
  maxDailyLoss: number;
  maxOpenPositions: number;
}

export interface Strategy {
  id: string;
  name: string;
  type: 'momentum' | 'mean-reversion' | 'arbitrage' | 'ml-based' | 'hybrid';
  status: 'active' | 'paused' | 'backtesting';
  parameters: Record<string, any>;
  performance: PerformanceMetrics;
  riskLimits: RiskLimits;
}

export interface Portfolio {
  id: string;
  userId: string;
  totalValue: number;
  availableBalance: number;
  positions: Position[];
  performance: PerformanceMetrics;
  riskMetrics: RiskMetrics;
  lastUpdated: number;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'auto';
  notifications: NotificationSettings;
  riskProfile: 'conservative' | 'moderate' | 'aggressive';
  defaultStrategy?: string;
  timezone: string;
  language: string;
}

export interface NotificationSettings {
  email: boolean;
  push: boolean;
  tradeAlerts: boolean;
  priceAlerts: boolean;
  systemAlerts: boolean;
  weeklyReports: boolean;
}

export interface User {
  id: string;
  email: string;
  username: string;
  apiAccess: boolean;
  tier: 'basic' | 'pro' | 'institutional';
  createdAt: number;
  lastLogin: number;
  settings: UserSettings;
}

export interface WebSocketMessage {
  type: 'market' | 'trade' | 'order' | 'position' | 'alert' | 'system';
  action: 'update' | 'create' | 'delete' | 'error';
  data: any;
  timestamp: number;
  sequenceId: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  timestamp: number;
  requestId: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  statusCode: number;
}

// Legacy/backtest and ticker types for compatibility
export interface Trade {
  id: string;
  symbol: string;
  side: OrderSide;
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
  side: OrderSide;
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

export interface BacktestTrade {
  id: string;
  entryPrice: number;
  exitPrice: number | null;
  entryTime: string;
  exitTime: string | null;
  side: PositionSide;
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

export interface OrderBookEntry {
  price: number;
  quantity: number;
}

export interface OrderBook {
  asks: OrderBookEntry[];
  bids: OrderBookEntry[];
}

// Re-export strategy types from strategy module
export * from './strategy.js';

// Re-export shared constants
export * from '../constants.js';

// Legacy interface for backward compatibility
export interface LegacyStrategyParameters {
  [key: string]: number | string | boolean;
}
