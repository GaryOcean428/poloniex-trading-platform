/**
 * Zod Validation Schemas
 * 
 * Runtime validation for JSON data and API responses.
 * These schemas mirror the Pydantic models in the Python backend.
 */

import { z } from 'zod';

// Market Data Schema
export const MarketDataSchema = z.object({
  symbol: z.string().min(1),
  timestamp: z.string().datetime(),
  price: z.number().positive(),
  volume: z.number().nonnegative(),
  high: z.number().positive().optional(),
  low: z.number().positive().optional(),
  open: z.number().positive().optional(),
  close: z.number().positive().optional(),
});

export type MarketData = z.infer<typeof MarketDataSchema>;

// Trade Schema
export const TradeSchema = z.object({
  id: z.string().optional(),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().positive(),
  price: z.number().positive(),
  status: z.enum(['pending', 'executed', 'failed', 'cancelled']),
  executedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});

export type Trade = z.infer<typeof TradeSchema>;

// User Schema
export const UserSchema = z.object({
  id: z.string().optional(),
  username: z.string().min(3).max(50),
  email: z.string().email(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type User = z.infer<typeof UserSchema>;

// API Response Wrapper
export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  });

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
};

// Validation helper
export function validateData<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Validation failed: ${error.errors.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
}

// Safe parse helper
export function safeValidateData<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.errors.map(e => e.message).join(', '),
  };
}
