/**
 * Environment Configuration and Validation
 *
 * Validates required environment variables and provides secure configuration
 * for the backend service using Zod for runtime validation.
 */
import dotenv from 'dotenv';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
// Load environment variables before validation
dotenv.config();
// Environment schema with Zod validation
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8765),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string()
        .min(32, 'JWT_SECRET must be at least 32 characters long for security')
        .refine((val) => val !== 'your-secret-key' && val !== 'change_me', 'JWT_SECRET must be changed from default value'),
    FRONTEND_URL: z.string().url().optional(),
    CORS_ALLOWED_ORIGINS: z.string()
        .optional()
        .transform((val) => val ? val.split(',').map(s => s.trim()).filter(Boolean) : undefined),
    API_ENCRYPTION_KEY: z.string().min(32).optional(),
    POLONIEX_API_KEY: z.string().optional(),
    POLONIEX_API_SECRET: z.string().optional(),
    REDIS_URL: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
});
/**
 * Validates environment variables using Zod schema
 */
export function validateEnvironment() {
    try {
        const validated = envSchema.parse(process.env);
        // Production-specific warnings
        if (validated.NODE_ENV === 'production') {
            if (!validated.FRONTEND_URL) {
                logger.warn('FRONTEND_URL not set in production - CORS may not work correctly');
            }
            if (!validated.API_ENCRYPTION_KEY) {
                logger.warn('API_ENCRYPTION_KEY not set - using JWT_SECRET for API key encryption');
            }
            if (!validated.POLONIEX_API_KEY || !validated.POLONIEX_API_SECRET) {
                logger.warn('Poloniex API credentials not set - trading features will be limited');
            }
        }
        // Log successful validation
        logger.info('Environment validation passed', {
            NODE_ENV: validated.NODE_ENV,
            PORT: validated.PORT,
            FRONTEND_URL: validated.FRONTEND_URL || 'not set',
            HAS_DATABASE: !!validated.DATABASE_URL,
            HAS_JWT_SECRET: !!validated.JWT_SECRET,
            HAS_API_ENCRYPTION_KEY: !!validated.API_ENCRYPTION_KEY,
            HAS_POLONIEX_CREDENTIALS: !!(validated.POLONIEX_API_KEY && validated.POLONIEX_API_SECRET),
            HAS_REDIS: !!validated.REDIS_URL,
            CORS_ORIGINS_COUNT: validated.CORS_ALLOWED_ORIGINS?.length || 0
        });
        return validated;
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            const errors = error.issues.map(e => `${e.path.join('.')}: ${e.message}`);
            logger.error('Environment validation failed', { errors });
            throw new Error(`Environment validation failed: ${errors.join(', ')}`);
        }
        throw error;
    }
}
/**
 * Get the validated environment configuration
 * Throws an error if validation fails
 */
export const env = validateEnvironment();
