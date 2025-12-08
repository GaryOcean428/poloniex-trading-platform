import { z } from 'zod';

/**
 * Validation Schemas
 * Centralized validation using Zod for type-safe form validation
 */

// Authentication Schemas
export const loginSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character')
});

export const registerSchema = loginSchema.extend({
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
});

// API Credentials Schema
export const apiCredentialsSchema = z.object({
  credentialName: z.string()
    .min(1, 'Credential name is required')
    .max(50, 'Credential name must be less than 50 characters'),
  apiKey: z.string()
    .regex(
      /^[A-Z0-9]{8}-[A-Z0-9]{8}-[A-Z0-9]{8}-[A-Z0-9]{8}$/,
      'Invalid API key format. Expected: XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX'
    ),
  apiSecret: z.string()
    .regex(
      /^[a-f0-9]{128}$/,
      'Invalid API secret format. Expected 128 lowercase hexadecimal characters'
    ),
  permissions: z.object({
    read: z.boolean(),
    trade: z.boolean(),
    withdraw: z.boolean()
  }).refine((perms) => perms.read || perms.trade || perms.withdraw, {
    message: 'At least one permission must be enabled'
  })
});

// Strategy Configuration Schema
export const strategyConfigSchema = z.object({
  name: z.string()
    .min(1, 'Strategy name is required')
    .max(100, 'Strategy name must be less than 100 characters'),
  pair: z.string()
    .min(1, 'Trading pair is required')
    .regex(/^[A-Z]+[-_][A-Z]+$/, 'Invalid trading pair format'),
  stopLoss: z.number()
    .min(0.1, 'Stop loss must be at least 0.1%')
    .max(10, 'Stop loss cannot exceed 10%'),
  takeProfit: z.number()
    .min(0.5, 'Take profit must be at least 0.5%')
    .max(50, 'Take profit cannot exceed 50%'),
  positionSize: z.number()
    .min(1, 'Position size must be at least 1%')
    .max(100, 'Position size cannot exceed 100%'),
  leverage: z.number()
    .int('Leverage must be a whole number')
    .min(1, 'Leverage must be at least 1x')
    .max(125, 'Leverage cannot exceed 125x')
    .optional()
}).refine((data) => data.takeProfit > data.stopLoss, {
  message: 'Take profit must be greater than stop loss',
  path: ['takeProfit']
});

// Autonomous Agent Configuration Schema
export const autonomousAgentConfigSchema = z.object({
  maxPositions: z.number()
    .int('Must be a whole number')
    .min(1, 'Must have at least 1 position')
    .max(10, 'Cannot exceed 10 positions'),
  riskPerTrade: z.number()
    .min(0.5, 'Risk must be at least 0.5%')
    .max(5, 'Risk cannot exceed 5% per trade'),
  maxDrawdown: z.number()
    .min(5, 'Max drawdown must be at least 5%')
    .max(50, 'Max drawdown cannot exceed 50%'),
  targetDailyReturn: z.number()
    .min(0.1, 'Target return must be at least 0.1%')
    .max(10, 'Target return cannot exceed 10%'),
  symbols: z.array(z.string())
    .min(1, 'At least one symbol is required')
    .max(10, 'Cannot exceed 10 symbols'),
  paperTrading: z.boolean()
});

// Trade Execution Schema
export const tradeExecutionSchema = z.object({
  symbol: z.string().min(1, 'Symbol is required'),
  side: z.enum(['BUY', 'SELL'], {
    errorMap: () => ({ message: 'Side must be BUY or SELL' })
  }),
  quantity: z.number()
    .positive('Quantity must be positive')
    .max(1000000, 'Quantity too large'),
  price: z.number()
    .positive('Price must be positive')
    .optional(),
  orderType: z.enum(['MARKET', 'LIMIT', 'STOP_LOSS', 'TAKE_PROFIT'], {
    errorMap: () => ({ message: 'Invalid order type' })
  }),
  slippageTolerance: z.number()
    .min(0, 'Slippage cannot be negative')
    .max(5, 'Slippage tolerance cannot exceed 5%')
    .optional()
    .default(0.5)
});

// Backtest Configuration Schema
export const backtestConfigSchema = z.object({
  strategyId: z.string().min(1, 'Strategy is required'),
  symbol: z.string().min(1, 'Symbol is required'),
  startDate: z.string()
    .or(z.date())
    .refine((val) => {
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid start date'),
  endDate: z.string()
    .or(z.date())
    .refine((val) => {
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid end date'),
  initialCapital: z.number()
    .min(100, 'Initial capital must be at least $100')
    .max(1000000, 'Initial capital cannot exceed $1,000,000'),
  commission: z.number()
    .min(0, 'Commission cannot be negative')
    .max(1, 'Commission cannot exceed 1%')
    .optional()
    .default(0.1)
}).refine((data) => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  return end > start;
}, {
  message: 'End date must be after start date',
  path: ['endDate']
});

// Risk Management Schema
export const riskManagementSchema = z.object({
  maxPositionSize: z.number()
    .min(1, 'Max position size must be at least 1%')
    .max(100, 'Max position size cannot exceed 100%'),
  maxLeverage: z.number()
    .int('Leverage must be a whole number')
    .min(1, 'Leverage must be at least 1x')
    .max(125, 'Leverage cannot exceed 125x'),
  stopLossPercent: z.number()
    .min(0.1, 'Stop loss must be at least 0.1%')
    .max(10, 'Stop loss cannot exceed 10%'),
  takeProfitPercent: z.number()
    .min(0.5, 'Take profit must be at least 0.5%')
    .max(50, 'Take profit cannot exceed 50%'),
  maxDailyLoss: z.number()
    .min(1, 'Max daily loss must be at least 1%')
    .max(20, 'Max daily loss cannot exceed 20%'),
  maxOpenPositions: z.number()
    .int('Must be a whole number')
    .min(1, 'Must allow at least 1 position')
    .max(20, 'Cannot exceed 20 open positions')
});

// Helper function to validate and return errors
export function validateSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: Record<string, string> } {
  const result = schema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const errors: Record<string, string> = {};
  result.error.errors.forEach((err) => {
    const path = err.path.join('.');
    errors[path] = err.message;
  });
  
  return { success: false, errors };
}

// Type exports for TypeScript
export type LoginFormData = z.infer<typeof loginSchema>;
export type RegisterFormData = z.infer<typeof registerSchema>;
export type ApiCredentialsFormData = z.infer<typeof apiCredentialsSchema>;
export type StrategyConfigFormData = z.infer<typeof strategyConfigSchema>;
export type AutonomousAgentConfigFormData = z.infer<typeof autonomousAgentConfigSchema>;
export type TradeExecutionFormData = z.infer<typeof tradeExecutionSchema>;
export type BacktestConfigFormData = z.infer<typeof backtestConfigSchema>;
export type RiskManagementFormData = z.infer<typeof riskManagementSchema>;
