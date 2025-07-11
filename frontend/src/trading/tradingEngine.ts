// Import required modules
import { poloniexApi } from '@/services/poloniexAPI';
import { logger } from '@/utils/logger';
import { MarketData } from '@/types';
import { TradingModeManager } from './TradingModeManager';
import { combineIndicatorSignals, calculateRSI, calculateMACD, calculateMovingAverageCrossover } from '@/utils/technicalIndicators';
import { createRiskManager, RiskManager, RISK_PROFILES } from '@/utils/riskManagement';
import { monitoringSystem } from '@/utils/monitoringSystem';
import { performanceOptimizer } from '@/utils/performanceOptimizer';
import { errorHandler, ErrorCategory, ErrorSeverity } from '@/utils/errorHandling';

interface Activity {
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  details?: string;
  timestamp: number;
}

interface BacktestResults {
  sharpeRatio: number;
  winRate: number;
  maxDrawdown: number;
  profitFactor: number;
}

interface ValidationResult {
  isValid: boolean;
  reasons: string[];
}

class TradingEngine {
  private activities: Activity[] = [];
  private maxActivities = 100;
  private currentActivity = 'Idle';
  public modeManager: TradingModeManager;
  public dailyPnL = 0;
  public isEmergencyMode = false;
  public isRunning = false;
  private tradingLoop: ReturnType<typeof setInterval> | null = null;
  private confidenceThreshold = 0.75; // Minimum confidence for live trading
  private riskManager: RiskManager;
  private accountBalance = 0;
  private apiCircuitBreaker = errorHandler.createCircuitBreaker('poloniex_api', {
    failureThreshold: 0.5,
    resetTimeout: 60000,
    minimumRequests: 5
  });
  private performanceMetrics = {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalProfit: 0,
    totalLoss: 0,
    maxDrawdown: 0,
    averageWin: 0,
    averageLoss: 0,
    profitFactor: 0,
    sharpeRatio: 0
  };
  private status = {
    currentAction: 'Initialized',
    lastUpdate: new Date().toISOString(),
    marketAnalysis: {
      prediction: null,
      sentiment: 0,
      confidence: 0
    } as {
      prediction: { direction: 'up' | 'down'; probability: number; reasoning: string } | null;
      sentiment: number;
      confidence: number;
    },
    performance: {
      averageLeverage: 0,
      totalInvested: 0,
      profitPerTrade: 0,
      pairMetrics: {}
    }
  };

  constructor() {
    this.modeManager = new TradingModeManager();
    
    // Initialize risk manager with moderate risk profile
    const riskProfile = localStorage.getItem('poloniex_risk_profile') || 'moderate';
    const riskParams = RISK_PROFILES[riskProfile as keyof typeof RISK_PROFILES];
    this.riskManager = createRiskManager(riskParams);
    
    // Set daily start value for P&L calculation
    const storedBalance = localStorage.getItem('poloniex_daily_start_balance');
    if (storedBalance) {
      this.riskManager.setDailyStartValue(parseFloat(storedBalance));
    }
    
    // Configure error handling for trading operations
    errorHandler.configureRetry('trading', {
      maxAttempts: 2,
      baseDelay: 1000,
      maxDelay: 5000,
      backoffMultiplier: 2,
      retryableErrors: ['NetworkError', 'TimeoutError', 'PoloniexConnectionError']
    });
    
    // Setup error listener for monitoring
    errorHandler.addErrorListener((error) => {
      monitoringSystem.logError(new Error(error.message), error.context.component);
    });
  }

  async initialize() {
    try {
      if (!this.modeManager) {
        this.modeManager = new TradingModeManager();
      }
      await this.modeManager.initialize();
      
      // Start monitoring system
      monitoringSystem.start();
      
      logger.info('Trading engine initialized successfully');
      return true;
    } catch (error) {
      monitoringSystem.logError(error instanceof Error ? error : new Error(String(error)), 'Trading engine initialization');
      logger.error('Failed to initialize trading engine:', error);
      throw error;
    }
  }

  async startTradingLoop() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info('Starting trading engine...');
    
    this.tradingLoop = setInterval(async () => {
      try {
        // Get settings from localStorage instead of using hook
        const autoTradingEnabled = localStorage.getItem('poloniex_auto_trading_enabled') === 'true';
        const defaultPair = localStorage.getItem('poloniex_default_pair') || 'BTC-USDT';
        
        if (autoTradingEnabled) {
          await this.analyzeMarket(defaultPair);
        }
      } catch (error) {
        logger.error('Error in trading loop:', error);
      }
    }, 60000); // Run analysis every minute
  }

  async stopTrading() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.tradingLoop) {
      clearInterval(this.tradingLoop);
      this.tradingLoop = null;
    }
    
    // Stop monitoring system
    monitoringSystem.stop();
    
    logger.info('Trading engine stopped');
  }

  async switchMode(mode: 'paper' | 'live', initialBalance?: number) {
    try {
      this.stopTrading();
      
      if (mode === 'live') {
        // Validate strategy before switching to live
        const backtestResults = await this.runBacktest();
        const validation = await this.validateLiveTrading(backtestResults);
        
        if (!validation.isValid) {
          throw new Error(`Cannot switch to live trading: ${validation.reasons.join(', ')}`);
        }
      }
      
      await this.modeManager.switchMode(mode, initialBalance);
      const status = `Trading mode switched to ${mode}`;
      this.updateStatus(status);

      return {
        success: true,
        status,
        apiConfigured: Boolean(localStorage.getItem('poloniex_api_key') && localStorage.getItem('poloniex_api_secret')),
        balance: mode === 'paper' ? this.modeManager.getPaperEngine().getBalance() : null
      };
    } catch (error) {
      logger.error('Failed to switch trading mode:', error);
      this.updateStatus('Mode switch failed');
      throw error;
    }
  }

  async analyzeMarket(symbol: string) {
    const analysisOperation = async () => {
      try {
        this.setCurrentActivity(`Analyzing market data for ${symbol}`);
        
        // Use cached market data for performance
        const marketData = await performanceOptimizer.cachedRequest(
          `market_data_${symbol}`,
          () => poloniexApi.getMarketData(symbol),
          false
        );
        
        if (this.isEmergencyMode) {
          this.addActivity('warning', 'Emergency mode activated', `Closing positions for ${symbol}`);
          return;
        }

        // Check emergency stop conditions
        const emergencyCheck = this.riskManager.checkEmergencyStop(this.accountBalance);
        if (emergencyCheck.shouldStop) {
          this.isEmergencyMode = true;
          this.addActivity('error', 'Emergency stop triggered', emergencyCheck.reasons.join(', '));
          await this.closeAllPositions();
          return;
        }

        // Enhanced market analysis using multiple technical indicators
        const indicatorSignals = combineIndicatorSignals(marketData, {
          useRSI: true,
          useMACD: true,
          useBB: true,
          useMA: true,
          weights: { rsi: 0.3, macd: 0.3, bb: 0.2, stochastic: 0.1, ma: 0.1 }
        });

        // Update monitoring system with market data
        const currentCandle = marketData[marketData.length - 1];
        monitoringSystem.updateMarketData(symbol, currentCandle);
        
        // Update portfolio risk monitoring
        const portfolioRisk = this.riskManager.calculatePortfolioRisk(this.accountBalance);
        monitoringSystem.updatePortfolioRisk(portfolioRisk);
        
        // Update performance metrics
        monitoringSystem.addPerformanceMetrics({
          timestamp: Date.now(),
          totalPnL: portfolioRisk.unrealizedPnL,
          dailyPnL: portfolioRisk.dailyPnL,
          winRate: this.calculateWinRate(),
          avgWin: this.performanceMetrics.averageWin,
          avgLoss: this.performanceMetrics.averageLoss,
          totalTrades: this.performanceMetrics.totalTrades,
          currentDrawdown: portfolioRisk.currentDrawdown,
          maxDrawdown: portfolioRisk.maxDrawdown,
          portfolioRisk: portfolioRisk.totalRiskPercent,
          leverageUtilization: portfolioRisk.leverageUtilization,
          apiLatency: 100, // This would be measured from actual API calls
          successRate: 0.98, // This would be calculated from API success/failure rates
          errorRate: 0.02,
          wsConnectionStatus: 'connected',
          volatility: this.calculateMarketVolatility(marketData),
          volume: currentCandle.volume,
          spread: 0.01 // This would be calculated from order book data
        });
        
        // Update status with enhanced analysis results
        this.status.marketAnalysis = {
          prediction: {
            direction: indicatorSignals.signal === 'BUY' ? 'up' : indicatorSignals.signal === 'SELL' ? 'down' : 'up',
            probability: indicatorSignals.confidence,
            reasoning: this.generateAnalysisReasoning(indicatorSignals)
          },
          sentiment: indicatorSignals.signal === 'BUY' ? 0.7 : indicatorSignals.signal === 'SELL' ? 0.3 : 0.5,
          confidence: indicatorSignals.confidence
        };

        this.setCurrentActivity(`Enhanced analysis complete for ${symbol}: ${indicatorSignals.signal} (${Math.round(indicatorSignals.confidence * 100)}% confidence)`);
        
        // Execute trade if auto-trading is enabled and signal meets criteria
        const autoTradingEnabled = localStorage.getItem('poloniex_auto_trading_enabled') === 'true';
        if (autoTradingEnabled && indicatorSignals.signal !== 'HOLD' && indicatorSignals.confidence > this.confidenceThreshold) {
          await this.executeEnhancedTrade(symbol, indicatorSignals.signal, indicatorSignals.confidence, marketData);
        }
      } catch (error) {
        throw error; // Re-throw to be handled by error handler
      }
    };

    // Execute with circuit breaker and error handling
    try {
      await this.apiCircuitBreaker.execute(analysisOperation);
    } catch (error) {
      await errorHandler.handleError(error as Error, {
        component: 'trading_engine',
        action: 'analyze_market',
        metadata: { symbol }
      });
    }
  }

  async executeEnhancedTrade(symbol: string, signal: 'BUY' | 'SELL', confidence: number, marketData: MarketData[]) { ... // rest remains unchanged
}
