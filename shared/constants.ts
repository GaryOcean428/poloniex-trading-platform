/**
 * Centralized API Constants
 * Provides versioned constants for all API routes, ensuring consistency across the platform
 * 
 * This follows the QIG (Quality, Integrity, Governance) principle by centralizing
 * all route definitions in one location for maintainability and governance.
 */

/**
 * API Version Configuration
 */
export const API_VERSION = {
  CURRENT: 'v1',
  SUPPORTED: ['v1'],
  DEPRECATED: [] as string[],
} as const;

/**
 * Base API paths with versioning
 */
export const API_BASE = {
  V1: `/api/${API_VERSION.CURRENT}`,
  INTERNAL: '/internal',
  PUBLIC: '/public',
} as const;

/**
 * Route Categories - "barrel" pattern for grouped routes
 */
export const ROUTE_CATEGORIES = {
  AUTH: 'auth',
  TRADING: 'trading',
  MARKET: 'market',
  STRATEGY: 'strategy',
  ML: 'ml',
  ADMIN: 'admin',
  MONITORING: 'monitoring',
} as const;

/**
 * Authentication & Authorization Routes
 */
export const AUTH_ROUTES = {
  BASE: `${API_BASE.V1}/auth`,
  LOGIN: `${API_BASE.V1}/auth/login`,
  LOGOUT: `${API_BASE.V1}/auth/logout`,
  REGISTER: `${API_BASE.V1}/auth/register`,
  REFRESH: `${API_BASE.V1}/auth/refresh`,
  VERIFY: `${API_BASE.V1}/auth/verify`,
  API_KEYS: `${API_BASE.V1}/api-keys`,
  CREDENTIALS: `${API_BASE.V1}/credentials`,
} as const;

/**
 * Trading Routes - "dry" mode support for testing
 */
export const TRADING_ROUTES = {
  BASE: `${API_BASE.V1}/trading`,
  SPOT: `${API_BASE.V1}/trading/spot`,
  FUTURES: `${API_BASE.V1}/trading/futures`,
  PAPER: `${API_BASE.V1}/trading/paper`,
  PAPER_DRY: `${API_BASE.V1}/trading/paper/dry`, // dry run mode
  BACKTEST: `${API_BASE.V1}/trading/backtest`,
  BACKTEST_DRY: `${API_BASE.V1}/trading/backtest/dry`, // dry run mode
  AUTONOMOUS: `${API_BASE.V1}/trading/autonomous`,
  SESSIONS: `${API_BASE.V1}/trading/sessions`,
} as const;

/**
 * Market Data Routes
 */
export const MARKET_ROUTES = {
  BASE: `${API_BASE.V1}/markets`,
  DATA: `${API_BASE.V1}/markets/data`,
  TICKER: `${API_BASE.V1}/markets/ticker`,
  ORDERBOOK: `${API_BASE.V1}/markets/orderbook`,
  TRADES: `${API_BASE.V1}/markets/trades`,
  CANDLES: `${API_BASE.V1}/markets/candles`,
} as const;

/**
 * Strategy & Risk Management Routes
 */
export const STRATEGY_ROUTES = {
  BASE: `${API_BASE.V1}/strategies`,
  LIST: `${API_BASE.V1}/strategies/list`,
  CREATE: `${API_BASE.V1}/strategies/create`,
  UPDATE: `${API_BASE.V1}/strategies/update`,
  DELETE: `${API_BASE.V1}/strategies/delete`,
  LLM: `${API_BASE.V1}/strategies/llm`,
  RISK: `${API_BASE.V1}/strategies/risk`,
  CONFIDENCE: `${API_BASE.V1}/strategies/confidence`,
} as const;

/**
 * ML & AI Routes - QIG-ML pure modules
 */
export const ML_ROUTES = {
  BASE: `${API_BASE.V1}/ml`,
  PREDICT: `${API_BASE.V1}/ml/predict`,
  TRAIN: `${API_BASE.V1}/ml/train`,
  MODELS: `${API_BASE.V1}/ml/models`,
  QIG: `${API_BASE.V1}/ml/qig`,
  AGENT: `${API_BASE.V1}/ml/agent`,
  AI: `${API_BASE.V1}/ml/ai`,
} as const;

/**
 * Monitoring & Diagnostics Routes
 */
export const MONITORING_ROUTES = {
  BASE: `${API_BASE.V1}/monitoring`,
  DASHBOARD: `${API_BASE.V1}/monitoring/dashboard`,
  STATUS: `${API_BASE.V1}/monitoring/status`,
  HEALTH: `${API_BASE.V1}/monitoring/health`,
  METRICS: `${API_BASE.V1}/monitoring/metrics`,
  DIAGNOSTICS: `${API_BASE.V1}/monitoring/diagnostics`,
  DEBUG: `${API_BASE.V1}/monitoring/debug`,
} as const;

/**
 * Admin Routes - Internal API
 */
export const ADMIN_ROUTES = {
  BASE: `${API_BASE.INTERNAL}/admin`,
  USERS: `${API_BASE.INTERNAL}/admin/users`,
  SYSTEM: `${API_BASE.INTERNAL}/admin/system`,
  CONFIG: `${API_BASE.INTERNAL}/admin/config`,
  PUBLIC: `${API_BASE.PUBLIC}/admin`,
} as const;

/**
 * WebSocket Event Types
 */
export const WS_EVENTS = {
  // Connection
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  ERROR: 'error',
  
  // Market Data
  MARKET_DATA: 'market:data',
  MARKET_TICKER: 'market:ticker',
  MARKET_TRADES: 'market:trades',
  
  // Trading
  TRADE_UPDATE: 'trade:update',
  ORDER_UPDATE: 'order:update',
  POSITION_UPDATE: 'position:update',
  
  // System
  SYSTEM_STATUS: 'system:status',
  SYSTEM_ALERT: 'system:alert',
} as const;

/**
 * Cache Keys for Redis
 */
export const CACHE_KEYS = {
  MARKET_DATA: (symbol: string) => `cache:market:${symbol}`,
  USER_SESSION: (sessionId: string) => `session:${sessionId}`,
  RATE_LIMIT: (key: string) => `rate_limit:${key}`,
  API_RESPONSE: (endpoint: string) => `cache:api:${endpoint}`,
} as const;

/**
 * Rate Limiting Constants
 */
export const RATE_LIMITS = {
  DEFAULT: { limit: 100, window: 60 }, // 100 requests per minute
  AUTH: { limit: 5, window: 60 }, // 5 auth attempts per minute
  TRADING: { limit: 30, window: 60 }, // 30 trades per minute
  API_KEYS: { limit: 1000, window: 3600 }, // 1000 requests per hour
} as const;

/**
 * Trading Mode Constants - "dry" mode support
 */
export const TRADING_MODES = {
  LIVE: 'live',
  PAPER: 'paper',
  DRY: 'dry', // dry run - no actual execution
  BACKTEST: 'backtest',
} as const;

/**
 * Environment-specific configuration
 */
export const ENV_CONFIG = {
  PRODUCTION: 'production',
  DEVELOPMENT: 'development',
  STAGING: 'staging',
  TEST: 'test',
} as const;

/**
 * Error Codes - Standardized error responses
 */
export const ERROR_CODES = {
  // Authentication
  AUTH_INVALID: 'AUTH_INVALID',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  
  // Trading
  TRADE_INVALID: 'TRADE_INVALID',
  TRADE_INSUFFICIENT_FUNDS: 'TRADE_INSUFFICIENT_FUNDS',
  TRADE_LIMIT_EXCEEDED: 'TRADE_LIMIT_EXCEEDED',
  
  // Market Data
  MARKET_UNAVAILABLE: 'MARKET_UNAVAILABLE',
  MARKET_INVALID_SYMBOL: 'MARKET_INVALID_SYMBOL',
  
  // System
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

/**
 * Type exports for TypeScript
 */
export type ApiVersion = typeof API_VERSION.CURRENT;
export type RouteCategory = typeof ROUTE_CATEGORIES[keyof typeof ROUTE_CATEGORIES];
export type TradingMode = typeof TRADING_MODES[keyof typeof TRADING_MODES];
export type EnvironmentType = typeof ENV_CONFIG[keyof typeof ENV_CONFIG];
export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
export type WsEvent = typeof WS_EVENTS[keyof typeof WS_EVENTS];
