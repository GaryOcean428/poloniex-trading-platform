/**
 * API Routes barrel file - centralized route exports
 * Provides unified import point for all API routes with versioning support
 */

// Authentication & Authorization
export { default as authRoutes } from './auth.js';
export { default as apiKeyRoutes } from './apiKeys.js';

// Trading Routes
export { default as futuresRoutes } from './futures.js';
export { default as backtestRoutes } from './backtest.js';
export { default as paperTradingRoutes } from './paper-trading.js';
export { default as autonomousTraderRoutes } from './autonomousTrader.js';
export { default as tradingSessionsRoutes } from './tradingSessions.js';

// Strategy & Risk Management
export { default as riskRoutes } from './risk.js';
export { default as confidenceScoringRoutes } from './confidenceScoring.js';

// Market Data & Analysis
export { default as marketsRoutes } from './markets.js';
export { default as proxyRoutes } from './proxy.js';

// ML & AI
export { default as mlRoutes } from './ml.js';
export { default as qigRoutes } from './qig.js';
export { default as agentRoutes } from './agent.js';

// Monitoring & Admin
export { default as dashboardRoutes } from './dashboard.js';
export { default as monitoringRoutes } from './monitoring.js';
export { default as adminRoutes } from './admin.js';
export { default as publicAdminRoutes } from './public-admin.js';
export { default as reconciliationRoutes } from './reconciliation.js';

// Utility Routes
export { default as statusRoutes } from './status.js';
export { default as debugRoutes } from './debug.js';
export { default as versionCheckRoutes } from './version-check.js';
