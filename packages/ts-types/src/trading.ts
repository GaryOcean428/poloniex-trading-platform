import { z } from 'zod';

// =================== Trading Types with Zod Validation ===================

export const PositionSideSchema = z.enum(['long', 'short']);
export type PositionSide = z.infer<typeof PositionSideSchema>;

export const OrderSideSchema = z.enum(['buy', 'sell']);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export const OrderTypeSchema = z.enum(['market', 'limit', 'stop', 'stop-limit']);
export type OrderType = z.infer<typeof OrderTypeSchema>;

export const TimeframeSchema = z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']);
export type Timeframe = z.infer<typeof TimeframeSchema>;

// Trade Signal
export const TradeSignalSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: OrderSideSchema,
  price: z.number().positive(),
  quantity: z.number().positive(),
  timestamp: z.number(),
  confidence: z.number().min(0).max(1),
  strategy: z.string(),
  metadata: z.record(z.any()).optional(),
});

export type TradeSignal = z.infer<typeof TradeSignalSchema>;

// Position
export const PositionSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: PositionSideSchema,
  entryPrice: z.number().positive(),
  currentPrice: z.number().positive(),
  quantity: z.number().positive(),
  pnl: z.number(),
  pnlPercentage: z.number(),
  openTime: z.number(),
  closeTime: z.number().optional(),
  status: z.enum(['open', 'closed', 'pending']),
});

export type Position = z.infer<typeof PositionSchema>;

// Risk Metrics
export const RiskMetricsSchema = z.object({
  maxDrawdown: z.number(),
  sharpeRatio: z.number(),
  winRate: z.number().min(0).max(1),
  profitFactor: z.number(),
  averageWin: z.number(),
  averageLoss: z.number(),
  riskRewardRatio: z.number(),
  valueAtRisk: z.number(),
  beta: z.number().optional(),
  alpha: z.number().optional(),
});

export type RiskMetrics = z.infer<typeof RiskMetricsSchema>;

// Market Data
export const MarketDataSchema = z.object({
  symbol: z.string(),
  price: z.number().positive(),
  volume24h: z.number().nonnegative(),
  change24h: z.number(),
  changePercent24h: z.number(),
  high24h: z.number().positive(),
  low24h: z.number().positive(),
  bid: z.number().positive(),
  ask: z.number().positive(),
  spread: z.number().nonnegative(),
  timestamp: z.number(),
});

export type MarketData = z.infer<typeof MarketDataSchema>;

// Order
export const OrderSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: OrderSideSchema,
  type: OrderTypeSchema,
  quantity: z.number().positive(),
  price: z.number().positive().optional(),
  stopPrice: z.number().positive().optional(),
  status: z.enum(['pending', 'filled', 'partially-filled', 'cancelled', 'rejected']),
  filledQuantity: z.number().nonnegative(),
  averagePrice: z.number().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
  executedAt: z.number().optional(),
});

export type Order = z.infer<typeof OrderSchema>;

// Performance Metrics
export const PerformanceMetricsSchema = z.object({
  totalReturn: z.number(),
  totalReturnPercent: z.number(),
  dailyReturn: z.number(),
  weeklyReturn: z.number(),
  monthlyReturn: z.number(),
  yearlyReturn: z.number(),
  allTimeHigh: z.number(),
  allTimeLow: z.number(),
  currentDrawdown: z.number(),
});

export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;

// Risk Limits
export const RiskLimitsSchema = z.object({
  maxPositionSize: z.number().positive(),
  maxDrawdown: z.number().positive(),
  maxLeverage: z.number().positive(),
  stopLoss: z.number(),
  takeProfit: z.number(),
  maxDailyLoss: z.number().positive(),
  maxOpenPositions: z.number().int().positive(),
});

export type RiskLimits = z.infer<typeof RiskLimitsSchema>;

// Portfolio
export const PortfolioSchema = z.object({
  id: z.string(),
  userId: z.string(),
  totalValue: z.number(),
  availableBalance: z.number(),
  positions: z.array(PositionSchema),
  performance: PerformanceMetricsSchema,
  riskMetrics: RiskMetricsSchema,
  lastUpdated: z.number(),
});

export type Portfolio = z.infer<typeof PortfolioSchema>;

// User Settings
export const NotificationSettingsSchema = z.object({
  email: z.boolean(),
  push: z.boolean(),
  tradeAlerts: z.boolean(),
  priceAlerts: z.boolean(),
  systemAlerts: z.boolean(),
  weeklyReports: z.boolean(),
});

export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

export const UserSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'auto']),
  notifications: NotificationSettingsSchema,
  riskProfile: z.enum(['conservative', 'moderate', 'aggressive']),
  defaultStrategy: z.string().optional(),
  timezone: z.string(),
  language: z.string(),
});

export type UserSettings = z.infer<typeof UserSettingsSchema>;

// User
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  username: z.string(),
  apiAccess: z.boolean(),
  tier: z.enum(['basic', 'pro', 'institutional']),
  createdAt: z.number(),
  lastLogin: z.number(),
  settings: UserSettingsSchema,
});

export type User = z.infer<typeof UserSchema>;

// WebSocket Message
export const WebSocketMessageSchema = z.object({
  type: z.enum(['market', 'trade', 'order', 'position', 'alert', 'system']),
  action: z.enum(['update', 'create', 'delete', 'error']),
  data: z.any(),
  timestamp: z.number(),
  sequenceId: z.number(),
});

export type WebSocketMessage = z.infer<typeof WebSocketMessageSchema>;

// API Response
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.any()).optional(),
  statusCode: z.number(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: ApiErrorSchema.optional(),
  timestamp: z.number(),
  requestId: z.string(),
});

export type ApiResponse<T = any> = Omit<z.infer<typeof ApiResponseSchema>, 'data'> & { data?: T };

// Trade
export const TradeSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: OrderSideSchema,
  quantity: z.number().positive(),
  price: z.number().positive(),
  timestamp: z.number(),
  fee: z.number().optional(),
});

export type Trade = z.infer<typeof TradeSchema>;

// Backtest Trade
export const BacktestTradeSchema = z.object({
  id: z.string(),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive().nullable(),
  entryTime: z.string(),
  exitTime: z.string().nullable(),
  side: PositionSideSchema,
  status: z.enum(['open', 'closed', 'stopped']),
  pnl: z.number(),
  pnlPercent: z.number(),
  balance: z.number(),
  size: z.number().positive(),
  fee: z.number(),
  reason: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  highestProfit: z.number().optional(),
  entryDate: z.date().optional(),
  exitDate: z.date().nullable().optional(),
  type: z.enum(['BUY', 'SELL']).optional(),
  quantity: z.number().positive().optional(),
  profit: z.number().optional(),
  profitPercent: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type BacktestTrade = z.infer<typeof BacktestTradeSchema>;

// Order Book
export const OrderBookEntrySchema = z.object({
  price: z.number().positive(),
  quantity: z.number().positive(),
});

export type OrderBookEntry = z.infer<typeof OrderBookEntrySchema>;

export const OrderBookSchema = z.object({
  asks: z.array(OrderBookEntrySchema),
  bids: z.array(OrderBookEntrySchema),
});

export type OrderBook = z.infer<typeof OrderBookSchema>;

// Ticker Data
export const TickerDataSchema = z.object({
  symbol: z.string(),
  price: z.number().positive(),
  lastPrice: z.number().positive(),
  bidPrice: z.number().positive(),
  askPrice: z.number().positive(),
  change24h: z.number(),
  changePercent24h: z.number(),
  volume24h: z.number().nonnegative(),
  high24h: z.number().positive(),
  low24h: z.number().positive(),
  timestamp: z.number(),
});

export type TickerData = z.infer<typeof TickerDataSchema>;
