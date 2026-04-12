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
export * from './paperTradingSimulatorService';
export * from './claudeTradingService';

// Backtesting Services
export * from './backtestService';
export * from './advancedBacktestService';

// Strategy Services
export * from './llmStrategyService';
export { openAITradingService } from './openAIService';

// Data & Mock Services
export * from './mockDataService';
export * from './mockDataGenerators';

// API Credentials
export * from './apiCredentialsService';

// WebSocket Services
export * from './websocketService';
export {
  AUTONOMOUS_TRADING_EVENTS,
  autonomousTradingWebSocket,
  type GenerationCompleteEvent,
  type ProfitBankedEvent,
  type StrategyEvent,
  type BacktestCompletedEvent,
  type EmergencyStopEvent,
  type RiskAssessmentAlert,
  type EventListener,
} from './autonomousTradingWebSocket';
export * from './websocket/index';
