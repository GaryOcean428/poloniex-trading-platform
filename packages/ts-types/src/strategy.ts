import { z } from 'zod';

// =================== Strategy Types with Zod Validation ===================

// Base parameters all strategies share
export const BaseStrategyParametersSchema = z.object({
  pair: z.string().describe('Trading pair, e.g., BTC-USDT'),
  timeframe: z.string().describe('Timeframe, e.g., 1h, 4h'),
  positionSize: z.number().optional().describe('Position size as % or units'),
});

export type BaseStrategyParameters = z.infer<typeof BaseStrategyParametersSchema>;

// Specific strategy parameter shapes
export const MovingAverageCrossoverParametersSchema = BaseStrategyParametersSchema.extend({
  fastPeriod: z.number().positive(),
  slowPeriod: z.number().positive(),
  shortPeriod: z.number().positive().optional(),
  longPeriod: z.number().positive().optional(),
});

export type MovingAverageCrossoverParameters = z.infer<typeof MovingAverageCrossoverParametersSchema>;

export const RSIParametersSchema = BaseStrategyParametersSchema.extend({
  period: z.number().positive(),
  overbought: z.number().min(0).max(100),
  oversold: z.number().min(0).max(100),
  oversoldThreshold: z.number().min(0).max(100).optional(),
  overboughtThreshold: z.number().min(0).max(100).optional(),
});

export type RSIParameters = z.infer<typeof RSIParametersSchema>;

export const MACDParametersSchema = BaseStrategyParametersSchema.extend({
  fastPeriod: z.number().positive(),
  slowPeriod: z.number().positive(),
  signalPeriod: z.number().positive(),
});

export type MACDParameters = z.infer<typeof MACDParametersSchema>;

export const BollingerBandsParametersSchema = BaseStrategyParametersSchema.extend({
  period: z.number().positive(),
  stdDev: z.number().positive(),
});

export type BollingerBandsParameters = z.infer<typeof BollingerBandsParametersSchema>;

export const BreakoutParametersSchema = BaseStrategyParametersSchema.extend({
  lookbackPeriod: z.number().positive(),
  breakoutThreshold: z.number(),
  volatilityThreshold: z.number().optional(),
});

export type BreakoutParameters = z.infer<typeof BreakoutParametersSchema>;

export const CustomParametersSchema = BaseStrategyParametersSchema.catchall(z.unknown());

export type CustomParameters = z.infer<typeof CustomParametersSchema>;

// Union of parameters across supported strategy types
export const StrategyParametersSchema = z.union([
  MovingAverageCrossoverParametersSchema,
  RSIParametersSchema,
  MACDParametersSchema,
  BollingerBandsParametersSchema,
  BreakoutParametersSchema,
  CustomParametersSchema,
]);

export type StrategyParameters = z.infer<typeof StrategyParametersSchema>;

// Performance metrics captured per strategy
export const StrategyPerformanceSchema = z.object({
  totalPnL: z.number().describe('Absolute PnL'),
  winRate: z.number().min(0).max(1).describe('Win rate 0-1'),
  tradesCount: z.number().int().nonnegative(),
  sharpeRatio: z.number().optional(),
  maxDrawdown: z.number().optional(),
  profitFactor: z.number().optional(),
});

export type StrategyPerformance = z.infer<typeof StrategyPerformanceSchema>;

// Supported strategy types
export const StrategyTypeUnionSchema = z.enum([
  'manual',
  'automated',
  'ml',
  'dqn',
  'MovingAverageCrossover',
  'RSI',
  'MACD',
  'BollingerBands',
  'Custom',
  'Breakout',
  'mean_reversion',
  'trend_following',
  'MOMENTUM',
  'MEAN_REVERSION',
  'GRID',
  'DCA',
  'ARBITRAGE',
]);

export type StrategyTypeUnion = z.infer<typeof StrategyTypeUnionSchema>;

export const StrategyAlgorithmSchema = z.enum([
  'MovingAverageCrossover',
  'RSI',
  'MACD',
  'BollingerBands',
  'Custom',
  'Breakout',
]);

export type StrategyAlgorithm = z.infer<typeof StrategyAlgorithmSchema>;

// Unified Strategy interface
export const StrategySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: StrategyTypeUnionSchema,
  active: z.boolean(),
  algorithm: StrategyAlgorithmSchema.optional(),
  parameters: StrategyParametersSchema,
  performance: StrategyPerformanceSchema.optional(),
  createdAt: z.string().optional().describe('ISO string timestamp'),
  updatedAt: z.string().optional().describe('ISO string timestamp'),
});

export type Strategy = z.infer<typeof StrategySchema>;

// Signal interface
export const StrategySignalSchema = z.object({
  strategyId: z.string(),
  signal: z.enum(['buy', 'sell', 'hold']),
  confidence: z.number().min(0).max(1),
  timestamp: z.number(),
});

export type StrategySignal = z.infer<typeof StrategySignalSchema>;
