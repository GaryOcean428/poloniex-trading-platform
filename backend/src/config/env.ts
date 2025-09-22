/**
 * Environment Configuration and Validation
 * 
 * Validates required environment variables and provides secure configuration
 * for the backend service.
 */

export interface EnvironmentConfig {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  FRONTEND_URL?: string;
  CORS_ALLOWED_ORIGINS?: string[];
  API_ENCRYPTION_KEY?: string;
  POLONIEX_API_KEY?: string;
  POLONIEX_API_SECRET?: string;
  REDIS_URL?: string;
}

/**
 * Validates that required environment variables are present and meet security requirements
 */
export function validateEnvironment(): EnvironmentConfig {
  const errors: string[] = [];

  // Required environment variables
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const PORT = parseInt(process.env.PORT || '8765', 10);
  const DATABASE_URL = process.env.DATABASE_URL;
  const JWT_SECRET = process.env.JWT_SECRET;

  // Validate required variables
  if (!DATABASE_URL) {
    errors.push('DATABASE_URL environment variable is required');
  }

  if (!JWT_SECRET) {
    errors.push('JWT_SECRET environment variable is required');
  } else if (JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters long for security');
  } else if (JWT_SECRET === 'your-secret-key' || JWT_SECRET === 'change_me') {
    errors.push('JWT_SECRET must be changed from default value');
  }

  // Validate PORT
  if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
    errors.push('PORT must be a valid port number between 1 and 65535');
  }

  // Optional but recommended variables
  const FRONTEND_URL = process.env.FRONTEND_URL;
  const API_ENCRYPTION_KEY = process.env.API_ENCRYPTION_KEY;

  // Parse CORS origins
  const CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
    : undefined;

  // Poloniex API credentials (optional for development)
  const POLONIEX_API_KEY = process.env.POLONIEX_API_KEY;
  const POLONIEX_API_SECRET = process.env.POLONIEX_API_SECRET;

  // Redis configuration (optional)
  const REDIS_URL = process.env.REDIS_URL;

  // Validate API encryption key if provided
  if (API_ENCRYPTION_KEY && API_ENCRYPTION_KEY.length < 32) {
    errors.push('API_ENCRYPTION_KEY must be at least 32 characters long if provided');
  }

  // Production-specific validations
  if (NODE_ENV === 'production') {
    if (!FRONTEND_URL) {
      errors.push('FRONTEND_URL environment variable is required in production');
    }

    if (!API_ENCRYPTION_KEY) {
      console.warn('⚠️  API_ENCRYPTION_KEY not set - using JWT_SECRET for API key encryption');
    }

    if (!POLONIEX_API_KEY || !POLONIEX_API_SECRET) {
      console.warn('⚠️  Poloniex API credentials not set - trading features will be limited');
    }
  }

  // Throw error if validation fails
  if (errors.length > 0) {
    console.error('❌ Environment validation failed:');
    errors.forEach(error => console.error(`   - ${error}`));
    throw new Error(`Environment validation failed: ${errors.join(', ')}`);
  }

  // Log successful validation
  console.log('✅ Environment validation passed');
  
  return {
    NODE_ENV,
    PORT,
    DATABASE_URL: DATABASE_URL!,
    JWT_SECRET: JWT_SECRET!,
    FRONTEND_URL,
    CORS_ALLOWED_ORIGINS,
    API_ENCRYPTION_KEY,
    POLONIEX_API_KEY,
    POLONIEX_API_SECRET,
    REDIS_URL
  };
}

/**
 * Get the validated environment configuration
 * Throws an error if validation fails
 */
export const env = validateEnvironment();