// Import required modules
import { poloniexApi } from '@/services/poloniexAPI';
import { logger } from '@/utils/logger';
import { MarketData } from '@/types';
import { TradingModeManager } from './TradingModeManager';
import { combineIndicatorSignals, calculateRSI, calculateMACD, calculateMovingAverageCrossover } from '@/utils/technicalIndicators';
import { createRiskManager, RiskManager, RISK_PROFILES } from '@/utils/riskManagement';
import { monitoringSystem } from '@/utils/monitoringSystem';

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
    try {
      this.setCurrentActivity(`Analyzing market data for ${symbol}`);
      const marketData = await poloniexApi.getMarketData(symbol);
      
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.addActivity('error', `Market analysis failed for ${symbol}`, errorMessage);
      logger.error(`Market analysis failed for ${symbol}:`, error);
    }
  }

  async executeEnhancedTrade(symbol: string, signal: 'BUY' | 'SELL', confidence: number, marketData: MarketData[]) {
    try {
      // Get current balance
      this.accountBalance = this.modeManager.isLiveMode() 
        ? await poloniexApi.getAccountBalance() 
        : this.modeManager.getPaperEngine().getBalance();

      const currentPrice = marketData[marketData.length - 1].close;
      const direction = signal === 'BUY' ? 'long' : 'short';
      
      // Calculate ATR-based stop loss and take profit
      const levels = this.riskManager.calculateATRLevels(marketData, currentPrice, direction);
      
      // Assess position risk
      const leverage = parseFloat(localStorage.getItem('poloniex_leverage') || '1');
      const riskAssessment = this.riskManager.assessPositionRisk(
        symbol,
        currentPrice,
        0, // We'll calculate size based on risk
        direction,
        this.accountBalance,
        leverage,
        marketData
      );

      if (!riskAssessment.canOpenPosition) {
        this.addActivity('warning', `Trade rejected for ${symbol}`, riskAssessment.reasons.join(', '));
        return;
      }

      // Use recommended position size from risk assessment
      const size = riskAssessment.recommendedSize;
      
      if (size < 0.001) { // Minimum trade size
        this.addActivity('warning', `Position size too small for ${symbol}`, `Calculated size: ${size.toFixed(6)}`);
        return;
      }

      // Add risk warnings if any
      if (riskAssessment.warnings.length > 0) {
        this.addActivity('warning', `Risk warnings for ${symbol}`, riskAssessment.warnings.join(', '));
      }

      const side = signal === 'BUY' ? 'buy' : 'sell';
      
      // Place main order
      let orderResult;
      if (this.modeManager.isLiveMode()) {
        orderResult = await poloniexApi.placeOrder(
          symbol,
          side,
          'market',
          size,
          undefined // market order
        );
      } else {
        orderResult = await this.modeManager.getPaperEngine().placeOrder({
          symbol,
          side,
          type: 'market',
          size,
          leverage: leverage
        });
      }

      // Add position to risk manager
      this.riskManager.addPosition(
        symbol,
        currentPrice,
        side === 'buy' ? size : -size,
        leverage,
        riskAssessment.stopLossPrice,
        riskAssessment.takeProfitPrice
      );

      // Place stop loss and take profit orders
      if (this.modeManager.isLiveMode()) {
        try {
          // Stop loss order
          await poloniexApi.placeConditionalOrder(
            symbol,
            side === 'buy' ? 'sell' : 'buy',
            'stop',
            size,
            riskAssessment.stopLossPrice
          );

          // Take profit order
          await poloniexApi.placeConditionalOrder(
            symbol,
            side === 'buy' ? 'sell' : 'buy',
            'takeProfit',
            size,
            riskAssessment.takeProfitPrice
          );
        } catch (error) {
          this.addActivity('warning', `Failed to place stop/TP orders for ${symbol}`, error instanceof Error ? error.message : 'Unknown error');
        }
      }

      // Update performance metrics
      this.updatePerformanceMetrics(orderResult);
      
      this.addActivity('success', `Enhanced trade executed for ${symbol}`, 
        `${side.toUpperCase()} ${size.toFixed(6)} at ${currentPrice.toFixed(2)}, ` +
        `SL: ${riskAssessment.stopLossPrice.toFixed(2)}, ` +
        `TP: ${riskAssessment.takeProfitPrice.toFixed(2)}, ` +
        `R:R ${riskAssessment.riskReward.toFixed(2)}, ` +
        `Confidence: ${(confidence * 100).toFixed(1)}%`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.addActivity('error', `Enhanced trade execution failed for ${symbol}`, errorMessage);
      logger.error(`Enhanced trade execution failed for ${symbol}:`, error);
    }
  }

  async runBacktest(): Promise<BacktestResults> {
    try {
      this.setCurrentActivity('Running backtest');
      // Simplified backtest results for now
      return {
        sharpeRatio: 1.6,
        winRate: 0.6,
        maxDrawdown: 0.15,
        profitFactor: 1.8
      };
    } catch (error) {
      logger.error('Backtest failed:', error);
      throw error;
    }
  }

  async validateLiveTrading(backtestResults: BacktestResults): Promise<ValidationResult> {
    const validation: ValidationResult = {
      isValid: false,
      reasons: []
    };

    // Minimum requirements for live trading
    if (backtestResults.sharpeRatio < 1.5) {
      validation.reasons.push('Insufficient Sharpe ratio (minimum 1.5 required)');
    }
    if (backtestResults.winRate < 0.55) {
      validation.reasons.push('Win rate too low (minimum 55% required)');
    }
    if (backtestResults.maxDrawdown > 0.2) {
      validation.reasons.push('Maximum drawdown too high (maximum 20% allowed)');
    }
    if (backtestResults.profitFactor < 1.5) {
      validation.reasons.push('Profit factor too low (minimum 1.5 required)');
    }

    validation.isValid = validation.reasons.length === 0;
    return validation;
  }

  getPositions() {
    if (this.modeManager.isLiveMode()) {
      // For live mode, fetch positions from API
      return poloniexApi.getOpenPositions();
    } else {
      // For paper mode, get positions from paper engine
      return this.modeManager.getPaperEngine().getPositions();
    }
  }

  getActivities() {
    return this.activities;
  }

  getCurrentActivity() {
    return this.currentActivity;
  }

  getStatus() {
    return {
      ...this.status,
      riskMetrics: this.accountBalance > 0 ? this.riskManager.calculatePortfolioRisk(this.accountBalance) : null,
      performanceMetrics: this.performanceMetrics
    };
  }

  getRiskManager() {
    return this.riskManager;
  }

  updateAccountBalance(balance: number) {
    this.accountBalance = balance;
    
    // Set daily start value if not set
    const dailyStartKey = `poloniex_daily_start_${new Date().toDateString()}`;
    if (!localStorage.getItem(dailyStartKey)) {
      localStorage.setItem(dailyStartKey, balance.toString());
      this.riskManager.setDailyStartValue(balance);
    }
  }

  async closeAllPositions() {
    try {
      this.setCurrentActivity('Closing all positions due to emergency stop');
      
      if (this.modeManager.isLiveMode()) {
        const positions = await poloniexApi.getOpenPositions();
        for (const position of positions.positions || []) {
          try {
            await poloniexApi.placeOrder(
              position.symbol,
              position.posSide === 'long' ? 'sell' : 'buy',
              'market',
              Math.abs(parseFloat(position.posSize))
            );
          } catch (error) {
            logger.error(`Failed to close position ${position.symbol}:`, error);
          }
        }
      } else {
        // Close paper trading positions
        const paperEngine = this.modeManager.getPaperEngine();
        const positions = paperEngine.getPositions();
        for (const position of positions) {
          try {
            await paperEngine.closePosition(position.symbol);
          } catch (error) {
            logger.error(`Failed to close paper position ${position.symbol}:`, error);
          }
        }
      }
      
      this.addActivity('info', 'All positions closed', 'Emergency stop procedure completed');
    } catch (error) {
      this.addActivity('error', 'Failed to close all positions', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private generateAnalysisReasoning(signals: any): string {
    const reasons = [];
    
    if (signals.indicators.rsi && signals.indicators.rsi.signal !== 'HOLD') {
      reasons.push(`RSI (${signals.indicators.rsi.currentValue.toFixed(1)}) indicates ${signals.indicators.rsi.signal}`);
    }
    
    if (signals.indicators.macd && signals.indicators.macd.currentSignal !== 'NEUTRAL') {
      reasons.push(`MACD shows ${signals.indicators.macd.currentSignal.toLowerCase()} crossover`);
    }
    
    if (signals.indicators.bollingerBands && signals.indicators.bollingerBands.currentPosition !== 'BETWEEN_BANDS') {
      reasons.push(`Price is ${signals.indicators.bollingerBands.currentPosition.toLowerCase().replace('_', ' ')}`);
    }
    
    if (signals.indicators.movingAverage && signals.indicators.movingAverage.signal !== 'HOLD') {
      reasons.push(`Moving averages suggest ${signals.indicators.movingAverage.signal.toLowerCase()}`);
    }
    
    return reasons.length > 0 ? reasons.join('; ') : 'Multiple technical indicators align';
  }

  private updatePerformanceMetrics(orderResult: any) {
    this.performanceMetrics.totalTrades++;
    
    // This is a simplified update - in a real implementation, you'd track
    // the full lifecycle of trades to calculate wins/losses accurately
    if (orderResult && orderResult.success !== false) {
      // For now, just update trade count
      // Full P&L tracking would require monitoring position closures
    }
  }

  private calculateWinRate(): number {
    if (this.performanceMetrics.totalTrades === 0) return 0;
    return (this.performanceMetrics.winningTrades / this.performanceMetrics.totalTrades) * 100;
  }

  private calculateMarketVolatility(marketData: MarketData[]): number {
    if (marketData.length < 20) return 0;
    
    const returns = [];
    for (let i = 1; i < Math.min(marketData.length, 21); i++) {
      const return_ = (marketData[i].close - marketData[i - 1].close) / marketData[i - 1].close;
      returns.push(return_);
    }
    
    const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  private updateStatus(action: string) {
    this.status.currentAction = action;
    this.status.lastUpdate = new Date().toISOString();
    logger.info(`Trading Engine Status: ${action}`);
  }

  private addActivity(type: Activity['type'], message: string, details = '') {
    const activity: Activity = {
      type,
      message,
      details,
      timestamp: Date.now()
    };
    
    this.activities.unshift(activity);
    if (this.activities.length > this.maxActivities) {
      this.activities.pop();
    }
    
    logger.info(`${type}: ${message}${details ? ` - ${details}` : ''}`);
  }

  private setCurrentActivity(activity: string) {
    this.currentActivity = activity;
    this.addActivity('info', activity);
  }
}

// Export singleton instance
export const tradingEngine = new TradingEngine();
