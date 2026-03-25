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
 * Trading Mode Constants
 * 
 * Defines the different execution modes for trading operations:
 * 
 * - **LIVE**: Real trading with actual funds and live market execution
 *   - Orders are placed on the exchange
 *   - Real money is at risk
 *   - Requires valid API credentials
 * 
 * - **PAPER**: Simulated trading with virtual funds
 *   - Orders are simulated but track real market prices
 *   - No real money is used
 *   - Useful for strategy testing with realistic market conditions
 *   - Maintains a virtual portfolio
 * 
 * - **DRY**: Dry run mode - validation without execution
 *   - Validates strategy logic and parameters
 *   - Checks API connectivity and authentication
 *   - No orders are placed (neither real nor simulated)
 *   - Used for testing integrations and configurations
 *   - Similar to "test mode" or "validation mode"
 * 
 * - **BACKTEST**: Historical data simulation
 *   - Tests strategies against historical market data
 *   - Uses past price data to simulate trades
 *   - No real-time market interaction
 *   - Useful for strategy optimization and historical analysis
 * 
 * **Relationship between modes:**
 * ```
 * DRY → Validate logic, no execution
 * BACKTEST → Test on historical data
 * PAPER → Test on live data with virtual funds
 * LIVE → Execute on live market with real funds
 * ```
 */
export const TRADING_MODES = {
  LIVE: 'live',
  PAPER: 'paper',
  DRY: 'dry',
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
/**
 * Poloniex Futures V3 Constants
 *
 * All autonomous agent trading uses perpetual futures via the Poloniex V3 API.
 * Symbols use the `BASE_QUOTE_PERP` format (e.g. `BTC_USDT_PERP`).
 * The UI displays the dash format (e.g. `BTC-USDT`) but all backend logic
 * and strategy generation must use the canonical PERP symbols below.
 */

/** Default futures pairs the autonomous agent trades */
export const FUTURES_DEFAULT_PAIRS = [
  'BTC_USDT_PERP',
  'ETH_USDT_PERP',
  'SOL_USDT_PERP',
] as const;

/** Full catalog of available Poloniex perpetual futures pairs */
export const FUTURES_ALL_PAIRS = [
  'BTC_USDT_PERP',
  'ETH_USDT_PERP',
  'SOL_USDT_PERP',
  'XRP_USDT_PERP',
  'DOGE_USDT_PERP',
  'AVAX_USDT_PERP',
  'BCH_USDT_PERP',
  'LTC_USDT_PERP',
  'TRX_USDT_PERP',
  'BNB_USDT_PERP',
  'APT_USDT_PERP',
  'LINK_USDT_PERP',
  'UNI_USDT_PERP',
  'XMR_USDT_PERP',
  '1000PEPE_USDT_PERP',
  '1000SHIB_USDT_PERP',
] as const;

/** Pairs shown in the dashboard UI pair-selector (dash format for display) */
export const FUTURES_UI_PAIRS = [
  'BTC-USDT',
  'ETH-USDT',
  'SOL-USDT',
  'XRP-USDT',
  'DOGE-USDT',
  'AVAX-USDT',
  'BCH-USDT',
  'LTC-USDT',
  'TRX-USDT',
  'BNB-USDT',
  'LINK-USDT',
  'UNI-USDT',
] as const;

/** Market type for strategy and agent configuration */
export const MARKET_TYPES = {
  FUTURES: 'futures',
  SPOT: 'spot',
} as const;

export type MarketType = typeof MARKET_TYPES[keyof typeof MARKET_TYPES];

/** Default futures trading configuration for the autonomous agent */
export const FUTURES_DEFAULTS = {
  /** Conservative default leverage */
  leverage: 3,
  /** Default margin mode */
  marginMode: 'CROSS' as const,
  /** Maker fee in basis points (0.01%) */
  makerFeeBps: 1,
  /** Taker fee in basis points (0.075%) */
  takerFeeBps: 7.5,
  /** Funding rate interval in hours */
  fundingIntervalHours: 8,
} as const;

/**
 * Normalize any symbol format to the canonical Poloniex Futures PERP format.
 *
 * Accepted inputs:
 *   BTC-USDT  →  BTC_USDT_PERP
 *   BTC_USDT  →  BTC_USDT_PERP
 *   BTCUSDT   →  BTC_USDT_PERP  (best effort – only for well-known bases)
 *   BTC_USDT_PERP → BTC_USDT_PERP (no-op)
 */
export function normalizeFuturesSymbol(symbol: string): string {
  if (!symbol) return symbol;
  let s = symbol.toUpperCase().trim();

  // Already canonical
  if (s.endsWith('_PERP')) return s;

  // Dash → underscore
  s = s.replace(/-/g, '_');

  // If already contains underscore (e.g. BTC_USDT), just append _PERP
  if (s.includes('_')) return `${s}_PERP`;

  // Concatenated format (BTCUSDT): try to split on USDT suffix
  if (s.endsWith('USDT')) {
    const base = s.slice(0, -4);
    return `${base}_USDT_PERP`;
  }

  // Fallback: return as-is with _PERP
  return `${s}_PERP`;
}

/**
 * Convert a canonical PERP symbol to the UI dash format.
 * BTC_USDT_PERP → BTC-USDT
 */
export function futuresSymbolToUI(symbol: string): string {
  if (!symbol) return symbol;
  return symbol.replace(/_PERP$/, '').replace(/_/g, '-');
}

/**
 * Validate that a symbol is a valid Poloniex perpetual futures symbol.
 */
export function isFuturesSymbol(symbol: string): boolean {
  if (!symbol) return false;
  const normalized = normalizeFuturesSymbol(symbol);
  return normalized.endsWith('_PERP');
}

export type ApiVersion = typeof API_VERSION.CURRENT;
export type RouteCategory = typeof ROUTE_CATEGORIES[keyof typeof ROUTE_CATEGORIES];
export type TradingMode = typeof TRADING_MODES[keyof typeof TRADING_MODES];
export type EnvironmentType = typeof ENV_CONFIG[keyof typeof ENV_CONFIG];
export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
export type WsEvent = typeof WS_EVENTS[keyof typeof WS_EVENTS];
