import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { pool } from '../db/connection.js';
import backtestingEngine from './backtestingEngine.js';
import paperTradingService from './paperTradingService.js';
import confidenceScoringService from './confidenceScoringService.js';

/**
 * Strategy Optimizer
 * Handles backtesting, paper trading, and promotion of strategies
 * Works with AutonomousStrategyGenerator to optimize strategies
 */
class StrategyOptimizer extends EventEmitter {
  constructor() {
    super();
    this.backtestQueue = [];
    this.paperTradingQueue = [];
    this.livePromotionQueue = [];
    this.isProcessing = false;
    
    // Optimization thresholds
    this.thresholds = {
      backtestMinProfit: 0.05,        // 5% minimum profit for backtest
      backtestMinWinRate: 0.45,       // 45% minimum win rate
      backtestMinSharpe: 0.5,         // 0.5 minimum Sharpe ratio
      backtestMaxDrawdown: 0.15,      // 15% maximum drawdown
      
      paperTradeMinProfit: 0.03,      // 3% minimum profit for paper trading
      paperTradeMinTrades: 10,        // Minimum trades for evaluation
      paperTradeDurationHours: 48,    // 48 hours minimum paper trading
      
      livePromotionMinProfit: 0.05,   // 5% minimum profit for live promotion
      livePromotionMinConfidence: 75, // 75% minimum confidence score
      livePromotionMinTrades: 20,     // Minimum trades for live promotion
      
      retirementMaxDrawdown: 0.20,    // 20% drawdown triggers retirement
      retirementMinWinRate: 0.30,     // 30% win rate minimum
      retirementLookbackDays: 7       // 7 days lookback for retirement
    };
    
    // Performance tracking
    this.optimizationStats = {
      backtestsCompleted: 0,
      paperTradingPromotions: 0,
      livePromotions: 0,
      retirements: 0,
      totalStrategiesTested: 0
    };
    
    this.logger = logger;
  }
  
  /**
   * Add strategy to backtest queue
   */
  async queueForBacktest(strategy) {
    this.backtestQueue.push(strategy);
    this.logger.info(`📋 Queued strategy ${strategy.id} for backtesting`);
    
    if (!this.isProcessing) {
      this.processQueues();
    }
  }
  
  /**
   * Add strategy to paper trading queue
   */
  async queueForPaperTrading(strategy) {
    this.paperTradingQueue.push(strategy);
    this.logger.info(`📋 Queued strategy ${strategy.id} for paper trading`);
    
    if (!this.isProcessing) {
      this.processQueues();
    }
  }
  
  /**
   * Add strategy to live promotion queue
   */
  async queueForLivePromotion(strategy) {
    this.livePromotionQueue.push(strategy);
    this.logger.info(`📋 Queued strategy ${strategy.id} for live promotion`);
    
    if (!this.isProcessing) {
      this.processQueues();
    }
  }
  
  /**
   * Process all queues in order
   */
  async processQueues() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    
    try {
      // Process backtests first
      while (this.backtestQueue.length > 0) {
        const strategy = this.backtestQueue.shift();
        await this.runBacktest(strategy);
      }
      
      // Process paper trading promotions
      while (this.paperTradingQueue.length > 0) {
        const strategy = this.paperTradingQueue.shift();
        await this.startPaperTrading(strategy);
      }
      
      // Process live promotions
      while (this.livePromotionQueue.length > 0) {
        const strategy = this.livePromotionQueue.shift();
        await this.promoteToLive(strategy);
      }
      
    } finally {
      this.isProcessing = false;
    }
  }
  
  /**
   * Run backtest for a strategy
   */
  async runBacktest(strategy) {
    try {
      this.logger.info(`🔬 Starting backtest for strategy ${strategy.id}...`);
      
      // Register strategy with backtesting engine
      backtestingEngine.registerStrategy(strategy.id, {
        name: strategy.name,
        type: strategy.type,
        parameters: strategy.parameters
      });
      
      // Get historical data (30 days minimum)
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - (30 * 24 * 60 * 60 * 1000));
      
      // Run backtest
      const backtestResult = await backtestingEngine.runBacktest(
        strategy.id,
        strategy.symbol,
        strategy.timeframe,
        startDate,
        endDate,
        {
          initialCapital: 10000,
          commission: 0.001,
          slippage: 0.001
        }
      );
      
      // Evaluate backtest results
      const evaluation = this.evaluateBacktestResult(backtestResult);
      
      // Update strategy performance
      strategy.performance.backtestScore = evaluation.score;
      strategy.performance.profit = evaluation.totalReturn;
      strategy.performance.winRate = evaluation.winRate;
      strategy.performance.sharpeRatio = evaluation.sharpeRatio;
      strategy.performance.maxDrawdown = evaluation.maxDrawdown;
      strategy.performance.trades = evaluation.totalTrades;
      
      // Determine next step based on performance
      if (evaluation.passedThreshold) {
        strategy.status = 'backtested';
        this.logger.info(`✅ Strategy ${strategy.id} passed backtest - queuing for paper trading`);
        await this.queueForPaperTrading(strategy);
      } else {
        strategy.status = 'failed_backtest';
        this.logger.info(`❌ Strategy ${strategy.id} failed backtest - ${evaluation.failureReason}`);
      }
      
      this.optimizationStats.backtestsCompleted++;
      this.optimizationStats.totalStrategiesTested++;
      
      this.emit('backtestCompleted', {
        strategyId: strategy.id,
        result: backtestResult,
        evaluation,
        passed: evaluation.passedThreshold
      });
      
    } catch (error) {
      this.logger.error(`❌ Backtest failed for strategy ${strategy.id}:`, error);
      strategy.status = 'backtest_error';
      strategy.error = error.message;
    }
  }
  
  /**
   * Evaluate backtest results against thresholds
   */
  evaluateBacktestResult(result) {
    const evaluation = {
      score: 0,
      totalReturn: result.totalReturn || 0,
      winRate: result.winRate || 0,
      sharpeRatio: result.sharpeRatio || 0,
      maxDrawdown: result.maxDrawdown || 0,
      totalTrades: result.totalTrades || 0,
      passedThreshold: false,
      failureReason: null
    };
    
    // Check minimum thresholds
    if (evaluation.totalReturn < this.thresholds.backtestMinProfit) {
      evaluation.failureReason = `Profit ${(evaluation.totalReturn * 100).toFixed(2)}% < ${(this.thresholds.backtestMinProfit * 100)}%`;
      return evaluation;
    }
    
    if (evaluation.winRate < this.thresholds.backtestMinWinRate) {
      evaluation.failureReason = `Win rate ${(evaluation.winRate * 100).toFixed(2)}% < ${(this.thresholds.backtestMinWinRate * 100)}%`;
      return evaluation;
    }
    
    if (evaluation.sharpeRatio < this.thresholds.backtestMinSharpe) {
      evaluation.failureReason = `Sharpe ratio ${evaluation.sharpeRatio.toFixed(2)} < ${this.thresholds.backtestMinSharpe}`;
      return evaluation;
    }
    
    if (evaluation.maxDrawdown > this.thresholds.backtestMaxDrawdown) {
      evaluation.failureReason = `Max drawdown ${(evaluation.maxDrawdown * 100).toFixed(2)}% > ${(this.thresholds.backtestMaxDrawdown * 100)}%`;
      return evaluation;
    }
    
    // Calculate composite score
    evaluation.score = (
      (evaluation.totalReturn * 30) +
      (evaluation.winRate * 20) +
      (evaluation.sharpeRatio * 20) +
      ((1 - evaluation.maxDrawdown) * 15) +
      (Math.min(evaluation.totalTrades / 50, 1) * 15)
    );
    
    evaluation.passedThreshold = true;
    return evaluation;
  }
  
  /**
   * Start paper trading for a strategy
   */
  async startPaperTrading(strategy) {
    try {
      this.logger.info(`📝 Starting paper trading for strategy ${strategy.id}...`);
      
      // Create paper trading session
      const sessionConfig = {
        name: `Paper - ${strategy.name}`,
        strategyName: strategy.id,
        symbol: strategy.symbol,
        timeframe: strategy.timeframe,
        initialCapital: 10000,
        riskParameters: {
          maxDailyLoss: 0.05,
          maxPositionSize: 0.1,
          stopLossPercent: strategy.parameters.stopLoss || 0.02,
          takeProfitPercent: strategy.parameters.takeProfit || 0.04,
          riskPerTrade: 0.02
        }
      };
      
      const session = await paperTradingService.createSession(sessionConfig);
      
      // Start the session with strategy
      await paperTradingService.startSession(session.id, {
        strategy: strategy.id,
        parameters: strategy.parameters
      });
      
      // Store session reference
      strategy.paperTradingSessionId = session.id;
      strategy.paperTradingStartTime = new Date();
      strategy.status = 'paper_trading';
      
      this.optimizationStats.paperTradingPromotions++;
      
      this.emit('paperTradingStarted', {
        strategyId: strategy.id,
        sessionId: session.id,
        strategy
      });
      
      // Schedule evaluation after minimum duration
      setTimeout(async () => {
        await this.evaluatePaperTrading(strategy);
      }, this.thresholds.paperTradeDurationHours * 60 * 60 * 1000);
      
    } catch (error) {
      this.logger.error(`❌ Paper trading failed for strategy ${strategy.id}:`, error);
      strategy.status = 'paper_trading_error';
      strategy.error = error.message;
    }
  }
  
  /**
   * Evaluate paper trading performance
   */
  async evaluatePaperTrading(strategy) {
    try {
      const session = paperTradingService.getSession(strategy.paperTradingSessionId);
      if (!session) {
        this.logger.error(`❌ Paper trading session not found for strategy ${strategy.id}`);
        return;
      }
      
      // Calculate performance metrics
      const totalReturn = (session.currentValue - session.initialCapital) / session.initialCapital;
      const winRate = session.totalTrades > 0 ? session.winningTrades / session.totalTrades : 0;
      const totalTrades = session.totalTrades;
      
      // Update strategy performance
      strategy.performance.paperTradeScore = totalReturn * 100;
      strategy.performance.profit = totalReturn;
      strategy.performance.winRate = winRate;
      strategy.performance.trades = totalTrades;
      
      // Evaluate for live promotion
      const shouldPromote = (
        totalReturn >= this.thresholds.paperTradeMinProfit &&
        totalTrades >= this.thresholds.paperTradeMinTrades &&
        winRate >= this.thresholds.backtestMinWinRate
      );
      
      if (shouldPromote) {
        this.logger.info(`✅ Strategy ${strategy.id} ready for live promotion`);
        await this.queueForLivePromotion(strategy);
      } else {
        this.logger.info(`❌ Strategy ${strategy.id} failed paper trading evaluation`);
        strategy.status = 'failed_paper_trading';
        
        // Stop paper trading session
        await paperTradingService.stopSession(strategy.paperTradingSessionId);
      }
      
      this.emit('paperTradingEvaluated', {
        strategyId: strategy.id,
        sessionId: strategy.paperTradingSessionId,
        totalReturn,
        winRate,
        totalTrades,
        promoted: shouldPromote
      });
      
    } catch (error) {
      this.logger.error(`❌ Paper trading evaluation failed for strategy ${strategy.id}:`, error);
    }
  }
  
  /**
   * Promote strategy to live trading
   */
  async promoteToLive(strategy) {
    try {
      this.logger.info(`🚀 Promoting strategy ${strategy.id} to live trading...`);
      
      // Calculate confidence score
      const confidenceAssessment = await confidenceScoringService.calculateConfidenceScore(
        strategy.id,
        strategy.symbol,
        strategy.timeframe
      );
      
      // Check confidence threshold
      if (confidenceAssessment.confidenceScore < this.thresholds.livePromotionMinConfidence) {
        this.logger.info(`❌ Strategy ${strategy.id} confidence too low for live promotion: ${confidenceAssessment.confidenceScore}%`);
        strategy.status = 'failed_confidence';
        return;
      }
      
      // Update strategy status
      strategy.status = 'live';
      strategy.livePromotionTime = new Date();
      strategy.performance.confidence = confidenceAssessment.confidenceScore;
      strategy.performance.liveTradeScore = 0;
      
      // Stop paper trading session
      if (strategy.paperTradingSessionId) {
        await paperTradingService.stopSession(strategy.paperTradingSessionId);
      }
      
      this.optimizationStats.livePromotions++;
      
      this.emit('livePromotionCompleted', {
        strategyId: strategy.id,
        confidenceScore: confidenceAssessment.confidenceScore,
        strategy
      });
      
      this.logger.info(`✅ Strategy ${strategy.id} promoted to live trading with ${confidenceAssessment.confidenceScore}% confidence`);
      
    } catch (error) {
      this.logger.error(`❌ Live promotion failed for strategy ${strategy.id}:`, error);
      strategy.status = 'live_promotion_error';
      strategy.error = error.message;
    }
  }
  
  /**
   * Evaluate strategy for retirement
   */
  async evaluateForRetirement(strategy) {
    try {
      const lookbackTime = Date.now() - (this.thresholds.retirementLookbackDays * 24 * 60 * 60 * 1000);
      
      // Get recent performance data
      const recentPerformance = await this.getRecentPerformance(strategy.id, lookbackTime);
      
      const shouldRetire = (
        recentPerformance.drawdown > this.thresholds.retirementMaxDrawdown ||
        recentPerformance.winRate < this.thresholds.retirementMinWinRate ||
        recentPerformance.profitFactor < 0.8
      );
      
      if (shouldRetire) {
        await this.retireStrategy(strategy, recentPerformance);
      }
      
    } catch (error) {
      this.logger.error(`❌ Retirement evaluation failed for strategy ${strategy.id}:`, error);
    }
  }
  
  /**
   * Retire underperforming strategy
   */
  async retireStrategy(strategy, performance) {
    try {
      this.logger.info(`🏁 Retiring strategy ${strategy.id} due to poor performance`);
      
      strategy.status = 'retired';
      strategy.retirementTime = new Date();
      strategy.retirementReason = this.getRetirementReason(performance);
      
      // Stop any active trading
      if (strategy.paperTradingSessionId) {
        await paperTradingService.stopSession(strategy.paperTradingSessionId);
      }
      
      this.optimizationStats.retirements++;
      
      this.emit('strategyRetired', {
        strategyId: strategy.id,
        reason: strategy.retirementReason,
        performance
      });
      
    } catch (error) {
      this.logger.error(`❌ Strategy retirement failed for ${strategy.id}:`, error);
    }
  }
  
  /**
   * Get retirement reason based on performance
   */
  getRetirementReason(performance) {
    if (performance.drawdown > this.thresholds.retirementMaxDrawdown) {
      return `Excessive drawdown: ${(performance.drawdown * 100).toFixed(2)}%`;
    }
    if (performance.winRate < this.thresholds.retirementMinWinRate) {
      return `Low win rate: ${(performance.winRate * 100).toFixed(2)}%`;
    }
    if (performance.profitFactor < 0.8) {
      return `Poor profit factor: ${performance.profitFactor.toFixed(2)}`;
    }
    return 'General underperformance';
  }
  
  /**
   * Get recent performance data for strategy
   */
  async getRecentPerformance(strategyId, since) {
    try {
      const result = await pool.query(`
        SELECT
          COALESCE(MAX(CASE WHEN pnl < 0 THEN ABS(pnl) ELSE 0 END), 0) as max_loss,
          COALESCE(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END), 0) as wins,
          COALESCE(COUNT(*), 0) as total_trades,
          COALESCE(SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END), 0) as gross_profit,
          COALESCE(SUM(CASE WHEN pnl < 0 THEN ABS(pnl) ELSE 0 END), 0) as gross_loss,
          COALESCE(SUM(pnl), 0) as total_pnl
        FROM autonomous_trades
        WHERE reason LIKE $1
          AND created_at >= $2
          AND status = 'closed'
      `, [`%${strategyId}%`, new Date(since)]);

      const row = result.rows[0];
      const totalTrades = parseInt(row.total_trades) || 0;
      const wins = parseInt(row.wins) || 0;
      const grossProfit = parseFloat(row.gross_profit) || 0;
      const grossLoss = parseFloat(row.gross_loss) || 0.001; // avoid division by zero

      return {
        drawdown: parseFloat(row.max_loss) || 0,
        winRate: totalTrades > 0 ? wins / totalTrades : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
        totalTrades,
        profit: parseFloat(row.total_pnl) || 0,
      };
    } catch (error) {
      this.logger.error('Error fetching recent performance:', error);
      // FAIL CLOSED: return worst-case metrics that will trigger retirement review
      return {
        drawdown: 1.0,
        winRate: 0,
        profitFactor: 0,
        totalTrades: 0,
        profit: -1,
      };
    }
  }
  
  /**
   * Get optimization statistics
   */
  getStats() {
    return {
      ...this.optimizationStats,
      queues: {
        backtest: this.backtestQueue.length,
        paperTrading: this.paperTradingQueue.length,
        livePromotion: this.livePromotionQueue.length
      },
      thresholds: this.thresholds
    };
  }
  
  /**
   * Update optimization thresholds
   */
  updateThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    this.logger.info('📊 Optimization thresholds updated');
    this.emit('thresholdsUpdated', this.thresholds);
  }
}

export default new StrategyOptimizer();