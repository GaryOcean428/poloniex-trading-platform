/**
 * Services Module Barrel Export
 * Centralized exports for all service modules
 * 
 * This follows the QIG (Quality, Integrity, Governance) principle by centralizing
 * all service exports for better maintainability and governance.
 */

// Authentication & Credentials
export * from './apiCredentialsService.js';
export * from './encryptionService.js';
export * from './userService.js';

// Trading Services
export * from './automatedTradingService.js';
export * from './autonomousTradingAgent.js';
export * from './backtestingEngine.js';
export * from './fullyAutonomousTrader.js';
export * from './paperTradingService.js';
export * from './persistentTradingEngine.js';
export * from './mockTradingService.js';

// Strategy Services
export * from './strategyService.js';
export * from './strategyOptimizer.js';
export * from './llmStrategyGenerator.js';
export * from './autonomousStrategyGenerator.js';
export * from './pineScriptParser.js';
export * from './templateStrategies.js';

// ML & AI Services
export * from './mlPredictionService.js';
export * from './simpleMlService.js';
export * from './confidenceScoringService.js';
export * from './contextAwarenessService.js';
export * from './enhancedAutonomousAgent.js';

// Market & Data Services
export * from './poloniexFuturesService.js';
export * from './poloniexSpotService.js';
export * from './poloniexWebSocket.js';
export * from './marketCatalog.js';

// Infrastructure Services
export * from './redisService.js';
export * from './monitoringService.js';
export * from './alertingService.js';

// Risk & Profit Management
export * from './riskService.js';
export * from './profitBankingService.js';

// Agent & Scheduling
export * from './agentScheduler.js';
export * from './agentSettingsService.js';

// Automation
export * from './automatedBacktestingPipeline.js';
export * from './haikuOptimizationService.js';

// QIG Services
export * from './qig/index.js';
