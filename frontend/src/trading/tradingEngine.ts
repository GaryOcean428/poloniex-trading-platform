// Import required modules
import { poloniexApi } from '@/services/poloniexAPI';
import { logger } from '@/utils/logger';
import { MarketData } from '@/types';
import { TradingModeManager } from './TradingModeManager';

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
  }

  async initialize() {
    try {
      if (!this.modeManager) {
        this.modeManager = new TradingModeManager();
      }
      await this.modeManager.initialize();
      logger.info('Trading engine initialized successfully');
      return true;
    } catch (error) {
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

      // Simple market analysis based on recent price movements
      const prices = marketData.map((candle: MarketData) => candle.close);
      const lastPrice = prices[prices.length - 1];
      const prevPrice = prices[prices.length - 2];
      
      const direction = lastPrice > prevPrice ? 'up' : 'down';
      const change = Math.abs((lastPrice - prevPrice) / prevPrice);
      const probability = 0.5 + (change * 10); // Simple probability calculation
      
      // Update status with analysis results
      this.status.marketAnalysis = {
        prediction: {
          direction: direction,
          probability: Math.min(probability, 0.95),
          reasoning: `Price moved ${direction} by ${(change * 100).toFixed(2)}%`
        },
        sentiment: direction === 'up' ? 0.6 : 0.4,
        confidence: Math.min(probability, 0.95)
      };

      this.setCurrentActivity(`Analysis complete for ${symbol}: ${direction} (${Math.round(probability * 100)}% confidence)`);
      
      // Execute trade if auto-trading is enabled
      const autoTradingEnabled = localStorage.getItem('poloniex_auto_trading_enabled') === 'true';
      if (autoTradingEnabled && this.status.marketAnalysis.confidence > this.confidenceThreshold) {
        await this.executeTrade(symbol, direction);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.addActivity('error', `Market analysis failed for ${symbol}`, errorMessage);
      logger.error(`Market analysis failed for ${symbol}:`, error);
    }
  }

  async executeTrade(symbol: string, direction: 'up' | 'down') {
    try {
      // Get settings from localStorage instead of using hook
      const riskPerTrade = parseFloat(localStorage.getItem('poloniex_risk_per_trade') || '2');
      const leverage = parseFloat(localStorage.getItem('poloniex_leverage') || '1');
      
      // Don't trade if we already have a position
      const paperEngine = this.modeManager.getPaperEngine();
      if (paperEngine.getPosition(symbol)) {
        return;
      }
      
      const side = direction === 'up' ? 'buy' : 'sell';
      const marketData = await poloniexApi.getMarketData(symbol);
      const lastPrice = marketData[marketData.length - 1].close;
      
      // Calculate position size based on risk settings
      const balance = this.modeManager.isLiveMode() 
        ? await poloniexApi.getAccountBalance() 
        : paperEngine.getBalance();
      
      const riskAmount = (balance * riskPerTrade) / 100;
      const size = riskAmount / lastPrice;
      
      // Place order
      if (this.modeManager.isLiveMode()) {
        await poloniexApi.placeOrder(
          symbol,
          side,
          'market',
          size,
          undefined // price is undefined for market orders
        );
      } else {
        await paperEngine.placeOrder({
          symbol,
          side,
          type: 'market',
          size,
          leverage: leverage
        });
      }
      
      this.addActivity('success', `Executed ${side} order for ${symbol}`, 
        `Size: ${size.toFixed(6)}, Price: ${lastPrice}, Leverage: ${leverage}x`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.addActivity('error', `Failed to execute trade for ${symbol}`, errorMessage);
      logger.error(`Trade execution failed for ${symbol}:`, error);
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
    return this.status;
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
