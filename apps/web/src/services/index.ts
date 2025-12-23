/**
 * Services Module Barrel Export
 * Centralized exports for all service modules
 */

// Core Services
export * from './api';
export * from './authService';
export * from './dashboardService';

// Market Services
export * from './MarketsService';
export * from './poloniexAPI';
export * from './poloniexFuturesAPI';
export * from './advancedLiveData';
export * from './tickerService';

// Trading Services
export * from './automatedTrading';
export * from './autonomousTradingAPI';
export * from './autonomousTradingEngine';
export * from './liveAutonomousTradingEngine';
export * from './liveTradingService';
export * from './mockTradingService';
export * from './claudeTradingService';

// Backtesting Services
export * from './backtestService';
export * from './advancedBacktestService';

// Strategy Services
export * from './llmStrategyService';
export * from './openAIService';

// Data & Mock Services
export * from './mockDataService';
export * from './mockDataGenerators';

// API Credentials
export * from './apiCredentialsService';

// WebSocket Services
export * from './websocketService';
export * from './autonomousTradingWebSocket';
export * from './websocket/index';
