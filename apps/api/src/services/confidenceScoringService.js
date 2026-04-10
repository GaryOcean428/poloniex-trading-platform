import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { query } from '../db/connection.js';
import poloniexFuturesService from './poloniexFuturesService.js';

/**
 * Confidence Scoring & Risk Assessment Service
 * Exclusively for Poloniex Futures v3 API
 * 
 * Evaluates strategy reliability and automatically adjusts position sizing
 * based on performance confidence and real-time market conditions
 */
class ConfidenceScoringService extends EventEmitter {
  constructor() {
    super();
    this.confidenceScores = new Map();
    this.marketConditions = new Map();
    this.riskAssessments = new Map();
    this.performanceHistory = new Map();
    this.isInitialized = false;
    
    // Confidence scoring parameters
    this.scoringParameters = {
      minimumTrades: 30, // Minimum trades for reliable confidence
      lookbackDays: 90, // Days to look back for performance
      marketConditionWeight: 0.3, // Market condition influence
      performanceWeight: 0.4, // Historical performance influence
      consistencyWeight: 0.2, // Consistency influence
      riskWeight: 0.1, // Risk-adjusted return influence
      
      // Confidence thresholds
      highConfidenceThreshold: 80,
      mediumConfidenceThreshold: 60,
      lowConfidenceThreshold: 40,
      
      // Risk assessment parameters
      maxDrawdownLimit: 0.15, // 15% max drawdown
      sharpeRatioMin: 1.0, // Minimum Sharpe ratio
      winRateMin: 0.45, // Minimum win rate
      profitFactorMin: 1.2, // Minimum profit factor
      
      // Position sizing parameters
      basePositionSize: 0.02, // 2% base position size
      maxPositionSize: 0.10, // 10% max position size
      minPositionSize: 0.005, // 0.5% min position size
      
      // Market condition factors
      volatilityPenalty: 0.2, // Reduce confidence in high volatility
      trendStrengthBonus: 0.1, // Increase confidence in strong trends
      liquidityPenalty: 0.15, // Reduce confidence in low liquidity

      // Minimum uncensored trades required for reliable fit
      minUncensoredTradesForFit: 10,

      // QIG censoring divergence threshold (20% = 0.20)
      censoredDivergenceThreshold: 0.20,

      // Confidence trajectory buffer length (number of past scores to retain)
      trajectoryLength: 20,

      // Max number of trajectory keys to retain (prevents unbounded Map growth)
      maxTrajectoryKeys: 1000
    };

    // Per-strategy confidence trajectory buffers (last N scores over time)
    this.confidenceTrajectories = new Map();
  }

  /**
   * Initialize the confidence scoring service
   */
  async initialize() {
    try {
      if (this.isInitialized) return;

      logger.info('🎯 Initializing Confidence Scoring Service for Poloniex Futures...');

      // Load existing confidence scores
      await this.loadExistingConfidenceScores();

      // Load performance history
      await this.loadPerformanceHistory();

      // Set up periodic updates
      this.setupPeriodicUpdates();

      this.isInitialized = true;
      logger.info('✅ Confidence Scoring Service initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize Confidence Scoring Service:', error);
      throw error;
    }
  }

  /**
   * Calculate confidence score for a strategy on specific symbol
   */
  async calculateConfidenceScore(strategyName, symbol, timeframe) {
    try {
      if (!strategyName) {
        return this.createLowConfidenceScore(strategyName, symbol, 'missing_strategy_name');
      }

      logger.info(`🔍 Calculating confidence score for ${strategyName} on ${symbol} (${timeframe})`);

      // Get historical performance data
      const performanceData = await this.getStrategyPerformanceData(strategyName, symbol, timeframe);
      
      if (!performanceData || performanceData.trades.length < this.scoringParameters.minimumTrades) {
        logger.warn(`Insufficient trade data for ${strategyName} on ${symbol} (${performanceData?.trades.length || 0} trades)`);
        // Return partial sub-scores even when there is insufficient data for the
        // composite score.  This lets callers see the direction of quality without
        // waiting for the full minimumTrades threshold.
        return this.createLowConfidenceScore(strategyName, symbol, 'insufficient_data', performanceData);
      }

      // Get current market conditions
      const marketConditions = await this.analyzeMarketConditions(symbol);

      // Separate censored and uncensored trade sets (QIG censoring detection).
      // Fitting only on uncensored data gives a more reliable estimate.
      const uncensoredTrades = performanceData.trades.filter(t => !t.is_censored);
      const hasCensoredData = uncensoredTrades.length < performanceData.trades.length;

      const uncensoredData = hasCensoredData && uncensoredTrades.length >= this.scoringParameters.minUncensoredTradesForFit
        ? { ...performanceData, trades: uncensoredTrades }
        : null;

      // Calculate component scores on the full dataset
      const performanceScore = this.calculatePerformanceScore(performanceData);
      const consistencyScore = this.calculateConsistencyScore(performanceData);
      const riskScore = this.calculateRiskScore(performanceData);
      const marketConditionScore = this.calculateMarketConditionScore(marketConditions, performanceData);

      // Calculate weighted confidence score (full dataset)
      const confidenceScore = (
        (performanceScore * this.scoringParameters.performanceWeight) +
        (consistencyScore * this.scoringParameters.consistencyWeight) +
        (riskScore * this.scoringParameters.riskWeight) +
        (marketConditionScore * this.scoringParameters.marketConditionWeight)
      );

      // QIG: dual censored/uncensored Sharpe comparison.
      // Compute Sharpe both ways; if they diverge by >20% the strategy's
      // performance estimate is considered unreliable.
      const allSharpe = this.computeSharpe(performanceData.trades);
      const uncensoredSharpe = this.computeSharpe(
        performanceData.trades.filter(t => !t.isCensored)
      );
      const sharpeDenominator = Math.max(Math.abs(uncensoredSharpe), 0.01);
      const sharpeDivergence = Math.abs(allSharpe - uncensoredSharpe) / sharpeDenominator;
      const reliabilityWarning = sharpeDivergence > this.scoringParameters.censoredDivergenceThreshold;

      // Calculate recommended position size (continuous, not threshold-based)
      const recommendedPositionSize = this.calculateRecommendedPositionSize(confidenceScore, marketConditions);

      // Update per-strategy confidence trajectory
      const cacheKey = `${strategyName}_${symbol}_${timeframe}`;
      this.updateConfidenceTrajectory(cacheKey, Math.round(confidenceScore));
      const confidence_trajectory = this.getConfidenceTrajectory(cacheKey);

      // Create confidence assessment
      const confidenceAssessment = {
        strategyName,
        symbol,
        timeframe,
        confidenceScore: Math.round(confidenceScore),
        riskScore: Math.round(riskScore),
        recommendedPositionSize,
        marketConditions,
        factors: {
          performance: Math.round(performanceScore),
          consistency: Math.round(consistencyScore),
          risk: Math.round(riskScore),
          marketCondition: Math.round(marketConditionScore)
        },
        // QIG: censored-fitness divergence flag
        reliability_warning: reliabilityWarning,
        censored_fitness: {
          all_sharpe: allSharpe,
          uncensored_sharpe: uncensoredSharpe,
          divergence: sharpeDivergence
        },
        censoringInfo: {
          allDataSharpe: allSharpe,
          uncensoredSharpe: uncensoredSharpe,
          sharpeDivergence: sharpeDivergence,
          estimateUnreliable: reliabilityWarning,
        },
        // Continuous confidence trajectory (last N scores over time)
        confidence_trajectory,
        warnings: this.generateWarnings(confidenceScore, marketConditions, performanceData, reliabilityWarning),
        calculatedAt: new Date(),
        tradesAnalyzed: performanceData.trades.length,
        performancePeriod: {
          start: performanceData.startDate,
          end: performanceData.endDate
        }
      };

      // Add unreliable-estimate warning when censored/uncensored fits diverge
      if (confidenceAssessment?.censoringInfo?.estimateUnreliable) {
        confidenceAssessment.warnings.push({
          type: 'censored_data_divergence',
          message: `Censored trades alter confidence by ${Math.abs(Math.round(confidenceScore) - confidenceWithoutCensored)} points. Performance estimate may be unreliable.`,
          severity: 'high'
        });
      }

      // Store confidence score
      await this.storeConfidenceScore(confidenceAssessment);

      // Update in-memory cache (cacheKey already declared above)
      this.confidenceScores.set(cacheKey, confidenceAssessment);

      logger.info(`✅ Confidence score calculated: ${confidenceScore}% for ${strategyName} on ${symbol}`);
      
      this.emit('confidenceScoreCalculated', confidenceAssessment);
      return confidenceAssessment;

    } catch (error) {
      logger.error(`Error calculating confidence score for ${strategyName} on ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get strategy performance data from database
   */
  async getStrategyPerformanceData(strategyName, symbol, timeframe) {
    try {
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - this.scoringParameters.lookbackDays);

      // Get backtest results
      const backtestResults = await query(`
        SELECT * FROM backtest_results 
        WHERE strategy_name = $1 AND symbol = $2 AND timeframe = $3
        AND created_at >= $4
        ORDER BY created_at DESC
        LIMIT 10
      `, [strategyName, symbol, timeframe, lookbackDate]);

      // Get paper trading results
      const paperTradingResults = await query(`
        SELECT pts.*, 
               COUNT(ptt.id) as total_trades,
               SUM(CASE WHEN ptt.pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
               AVG(ptt.pnl) as avg_pnl,
               STDDEV(ptt.pnl) as pnl_stddev
        FROM paper_trading_sessions pts
        LEFT JOIN paper_trading_trades ptt ON pts.id = ptt.session_id AND ptt.type = 'exit'
        WHERE pts.strategy_name = $1 AND pts.symbol = $2 AND pts.timeframe = $3
        AND pts.started_at >= $4
        GROUP BY pts.id
        ORDER BY pts.started_at DESC
      `, [strategyName, symbol, timeframe, lookbackDate]);

      // Get live trading results (if available)
      const liveTradingResults = await query(`
        SELECT COUNT(*) as total_trades,
               SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
               AVG(realized_pnl) as avg_pnl,
               STDDEV(realized_pnl) as pnl_stddev,
               SUM(realized_pnl) as total_pnl
        FROM futures_trades 
        WHERE strategy_name = $1 AND symbol = $2
        AND created_at >= $3
      `, [strategyName, symbol, lookbackDate]);

      // Combine all performance data
      const allTrades = [];
      const allResults = [];

      // Process backtest results
      for (const result of backtestResults.rows) {
        const trades = await query(`
          SELECT * FROM backtest_trades 
          WHERE backtest_id = $1 AND type = 'exit'
          ORDER BY timestamp
        `, [result.id]);

        allTrades.push(...trades.rows.map(trade => ({
          ...trade,
          source: 'backtest',
          sessionId: result.id
        })));

        allResults.push({
          ...result,
          source: 'backtest',
          winRate: result.win_rate,
          totalReturn: result.total_return,
          maxDrawdown: result.max_drawdown_percent,
          sharpeRatio: result.sharpe_ratio
        });
      }

      // Process paper trading results
      for (const result of paperTradingResults.rows) {
        if (result.total_trades > 0) {
          const trades = await query(`
            SELECT * FROM paper_trading_trades 
            WHERE session_id = $1 AND type = 'exit'
            ORDER BY timestamp
          `, [result.id]);

          // QIG: propagate session-level censoring flag to each trade so callers
          // can compute fitness metrics with and without censored sessions.
          const isCensoredSession = result.is_censored || false;
          allTrades.push(...trades.rows.map(trade => ({
            ...trade,
            source: 'paper_trading',
            sessionId: result.id,
            isCensored: isCensoredSession
          })));

          const winRate = result.winning_trades / result.total_trades * 100;
          const totalReturn = ((result.current_value - result.initial_capital) / result.initial_capital) * 100;

          allResults.push({
            ...result,
            source: 'paper_trading',
            winRate,
            totalReturn,
            maxDrawdown: 0, // Would need to calculate from equity curve
            sharpeRatio: result.pnl_stddev > 0 ? result.avg_pnl / result.pnl_stddev : 0
          });
        }
      }

      // Process live trading results
      if (liveTradingResults.rows[0] && liveTradingResults.rows[0].total_trades > 0) {
        const liveResult = liveTradingResults.rows[0];
        const winRate = liveResult.winning_trades / liveResult.total_trades * 100;
        
        allResults.push({
          source: 'live_trading',
          total_trades: liveResult.total_trades,
          winning_trades: liveResult.winning_trades,
          winRate,
          totalReturn: 0, // Would need account value tracking
          maxDrawdown: 0, // Would need to calculate
          sharpeRatio: liveResult.pnl_stddev > 0 ? liveResult.avg_pnl / liveResult.pnl_stddev : 0,
          avg_pnl: liveResult.avg_pnl
        });
      }

      if (allTrades.length === 0) {
        return null;
      }

      // Sort trades by timestamp
      allTrades.sort((a, b) => new Date(a.timestamp || a.created_at) - new Date(b.timestamp || b.created_at));

      return {
        trades: allTrades,
        results: allResults,
        startDate: allTrades[0].timestamp || allTrades[0].created_at,
        endDate: allTrades[allTrades.length - 1].timestamp || allTrades[allTrades.length - 1].created_at,
        totalTrades: allTrades.length,
        sources: [...new Set(allTrades.map(t => t.source))]
      };

    } catch (error) {
      logger.error('Error getting strategy performance data:', error);
      return null;
    }
  }

  /**
   * Analyze current market conditions for symbol
   */
  async analyzeMarketConditions(symbol) {
    try {
      // Get current market data from Poloniex
      const [ticker, orderBook, recentTrades] = await Promise.all([
        poloniexFuturesService.getTicker(symbol),
        poloniexFuturesService.getOrderBook(symbol, 20),
        poloniexFuturesService.getRecentTrades(symbol, 100)
      ]);

      // Get historical data for trend analysis
      const endTime = Math.floor(Date.now() / 1000);
      const startTime = endTime - (24 * 60 * 60); // 24 hours ago
      const klines = await poloniexFuturesService.getKlines(symbol, '1h', startTime, endTime);

      // Calculate market condition metrics
      const volatility = this.calculateVolatility(klines);
      const trendStrength = this.calculateTrendStrength(klines);
      const liquidity = this.calculateLiquidity(orderBook);
      const momentum = this.calculateMomentum(klines);
      const marketPhase = this.determineMarketPhase(klines, volatility, trendStrength);

      const marketConditions = {
        symbol,
        timestamp: new Date(),
        price: parseFloat(ticker.last),
        volatility: {
          value: volatility,
          level: this.categorizeVolatility(volatility)
        },
        trend: {
          strength: trendStrength,
          direction: trendStrength > 0 ? 'bullish' : trendStrength < 0 ? 'bearish' : 'sideways'
        },
        liquidity: {
          value: liquidity,
          level: this.categorizeLiquidity(liquidity)
        },
        momentum: {
          value: momentum,
          level: this.categorizeMomentum(momentum)
        },
        marketPhase,
        riskLevel: this.calculateMarketRiskLevel(volatility, liquidity, trendStrength),
        
        // Additional Poloniex-specific metrics
        fundingRate: parseFloat(ticker.fundingRate || 0),
        openInterest: parseFloat(ticker.openInterest || 0),
        volume24h: parseFloat(ticker.volume || 0),
        priceChange24h: parseFloat(ticker.priceChangePercent || 0)
      };

      // Cache market conditions
      this.marketConditions.set(symbol, marketConditions);
      
      return marketConditions;

    } catch (error) {
      logger.error(`Error analyzing market conditions for ${symbol}:`, error);
      
      // Return default market conditions if analysis fails
      return {
        symbol,
        timestamp: new Date(),
        price: 0,
        volatility: { value: 0.5, level: 'unknown' },
        trend: { strength: 0, direction: 'unknown' },
        liquidity: { value: 0.5, level: 'unknown' },
        momentum: { value: 0, level: 'unknown' },
        marketPhase: 'unknown',
        riskLevel: 'high',
        fundingRate: 0,
        openInterest: 0,
        volume24h: 0,
        priceChange24h: 0
      };
    }
  }

  /**
   * Calculate performance score based on historical data
   */
  calculatePerformanceScore(performanceData) {
    try {
      const exitTrades = performanceData.trades.filter(t => t.pnl !== undefined && t.pnl !== null);
      
      if (exitTrades.length === 0) return 0;

      // Calculate basic performance metrics
      const totalPnl = exitTrades.reduce((sum, trade) => sum + parseFloat(trade.pnl), 0);
      const winningTrades = exitTrades.filter(t => parseFloat(t.pnl) > 0);
      const losingTrades = exitTrades.filter(t => parseFloat(t.pnl) <= 0);
      
      const winRate = winningTrades.length / exitTrades.length;
      const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + parseFloat(t.pnl), 0) / winningTrades.length : 0;
      const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, t) => sum + parseFloat(t.pnl), 0)) / losingTrades.length : 0;
      const profitFactor = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? 10 : 0);

      // Calculate performance score components
      const winRateScore = Math.min(winRate * 100, 100);
      const profitFactorScore = Math.min(profitFactor * 25, 100);
      const totalReturnScore = Math.min(Math.max(totalPnl / 1000 * 50, 0), 100);

      // Weight the components
      const performanceScore = (
        (winRateScore * 0.4) +
        (profitFactorScore * 0.4) +
        (totalReturnScore * 0.2)
      );

      return Math.min(Math.max(performanceScore, 0), 100);
    } catch (error) {
      logger.error('Error calculating performance score:', error);
      return 0;
    }
  }

  /**
   * Calculate consistency score
   */
  calculateConsistencyScore(performanceData) {
    try {
      const exitTrades = performanceData.trades.filter(t => t.pnl !== undefined && t.pnl !== null);
      
      if (exitTrades.length < 10) return 0;

      // Calculate rolling window performance
      const windowSize = Math.min(10, Math.floor(exitTrades.length / 3));
      const rollingReturns = [];
      
      for (let i = 0; i <= exitTrades.length - windowSize; i++) {
        const window = exitTrades.slice(i, i + windowSize);
        const windowReturn = window.reduce((sum, trade) => sum + parseFloat(trade.pnl), 0);
        rollingReturns.push(windowReturn);
      }

      // Calculate consistency metrics
      const avgReturn = rollingReturns.reduce((sum, ret) => sum + ret, 0) / rollingReturns.length;
      const variance = rollingReturns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / rollingReturns.length;
      const standardDeviation = Math.sqrt(variance);
      
      // Calculate coefficient of variation (lower is better)
      const coefficientOfVariation = avgReturn !== 0 ? Math.abs(standardDeviation / avgReturn) : 1;
      
      // Calculate positive periods percentage
      const positivePeriods = rollingReturns.filter(ret => ret > 0).length;
      const positivePeriodsPercent = positivePeriods / rollingReturns.length;

      // Calculate consistency score
      const cvScore = Math.max(0, 100 - (coefficientOfVariation * 50));
      const positiveScore = positivePeriodsPercent * 100;

      const consistencyScore = (cvScore * 0.6) + (positiveScore * 0.4);

      return Math.min(Math.max(consistencyScore, 0), 100);
    } catch (error) {
      logger.error('Error calculating consistency score:', error);
      return 0;
    }
  }

  /**
   * Calculate risk score
   */
  calculateRiskScore(performanceData) {
    try {
      const exitTrades = performanceData.trades.filter(t => t.pnl !== undefined && t.pnl !== null);
      
      if (exitTrades.length < 10) return 0;

      // Calculate drawdown
      let peak = 0;
      let maxDrawdown = 0;
      let runningPnl = 0;

      for (const trade of exitTrades) {
        runningPnl += parseFloat(trade.pnl);
        if (runningPnl > peak) {
          peak = runningPnl;
        }
        const drawdown = peak - runningPnl;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }

      // Calculate risk metrics
      const maxDrawdownPercent = peak > 0 ? (maxDrawdown / peak) * 100 : 0;
      const pnlValues = exitTrades.map(t => parseFloat(t.pnl));
      const avgPnl = pnlValues.reduce((sum, pnl) => sum + pnl, 0) / pnlValues.length;
      const stdDev = Math.sqrt(pnlValues.reduce((sum, pnl) => sum + Math.pow(pnl - avgPnl, 2), 0) / pnlValues.length);
      const sharpeRatio = stdDev > 0 ? avgPnl / stdDev : 0;

      // Calculate risk score components
      const drawdownScore = Math.max(0, 100 - (maxDrawdownPercent * 2));
      const sharpeScore = Math.min(sharpeRatio * 25, 100);
      const stabilityScore = Math.max(0, 100 - (stdDev * 10));

      // Weight the components
      const riskScore = (
        (drawdownScore * 0.5) +
        (sharpeScore * 0.3) +
        (stabilityScore * 0.2)
      );

      return Math.min(Math.max(riskScore, 0), 100);
    } catch (error) {
      logger.error('Error calculating risk score:', error);
      return 0;
    }
  }

  /**
   * Calculate market condition score
   */
  calculateMarketConditionScore(marketConditions, performanceData) {
    try {
      let score = 50; // Base score

      // Adjust for volatility
      if (marketConditions.volatility.level === 'low') {
        score += 20;
      } else if (marketConditions.volatility.level === 'high') {
        score -= 20;
      }

      // Adjust for trend strength
      if (Math.abs(marketConditions.trend.strength) > 0.7) {
        score += 15; // Strong trend is good
      } else if (Math.abs(marketConditions.trend.strength) < 0.3) {
        score -= 10; // Weak trend is challenging
      }

      // Adjust for liquidity
      if (marketConditions.liquidity.level === 'high') {
        score += 10;
      } else if (marketConditions.liquidity.level === 'low') {
        score -= 15;
      }

      // Adjust for market phase
      if (marketConditions.marketPhase === 'trending') {
        score += 10;
      } else if (marketConditions.marketPhase === 'volatile') {
        score -= 15;
      }

      // Adjust for funding rate (Poloniex specific)
      const fundingRate = Math.abs(marketConditions.fundingRate);
      if (fundingRate > 0.01) { // 1% funding rate is high
        score -= 10;
      }

      return Math.min(Math.max(score, 0), 100);
    } catch (error) {
      logger.error('Error calculating market condition score:', error);
      return 50;
    }
  }

  /**
   * Calculate recommended position size based on confidence.
   * Uses continuous scaling (confidence / 100) instead of threshold-based
   * discrete steps, eliminating the "threshold noise" problem where a 0.1%
   * difference in confidence triggers opposite sizing behaviour.
   */
  calculateRecommendedPositionSize(confidenceScore, marketConditions) {
    try {
      // Continuous scaling: position size is proportional to confidence [0-100]
      const clampedConfidence = Math.max(0, Math.min(100, confidenceScore));
      let baseSize = this.scoringParameters.basePositionSize * (clampedConfidence / 100);

      // Multiplicative market-condition adjustments
      if (marketConditions.volatility.level === 'high') {
        baseSize *= 0.7;
      } else if (marketConditions.volatility.level === 'low') {
        baseSize *= 1.2;
      }

      if (marketConditions.liquidity.level === 'low') {
        baseSize *= 0.8;
      }

      if (marketConditions.riskLevel === 'high') {
        baseSize *= 0.6;
      }

      // Apply limits
      const recommendedSize = Math.min(
        Math.max(baseSize, this.scoringParameters.minPositionSize),
        this.scoringParameters.maxPositionSize
      );

      return Math.round(recommendedSize * 10000) / 10000; // Round to 4 decimal places
    } catch (error) {
      logger.error('Error calculating recommended position size:', error);
      return this.scoringParameters.minPositionSize;
    }
  }

  /**
   * Generate warnings based on confidence and market conditions
   */
  generateWarnings(confidenceScore, marketConditions, performanceData, reliabilityWarning = false) {
    const warnings = [];

    if (reliabilityWarning) {
      warnings.push({
        type: 'censored_data_distortion',
        message: `Censored sessions are distorting the performance estimate (Sharpe divergence >${this.scoringParameters.censoredDivergenceThreshold * 100}%). Strategy reliability is uncertain.`,
        severity: 'high'
      });
    }

    if (confidenceScore < this.scoringParameters.lowConfidenceThreshold) {
      warnings.push({
        type: 'low_confidence',
        message: 'Strategy confidence is low. Consider reducing position size or stopping trading.',
        severity: 'high'
      });
    }

    if (marketConditions.volatility.level === 'high') {
      warnings.push({
        type: 'high_volatility',
        message: 'Market volatility is high. Increased risk of slippage and unexpected moves.',
        severity: 'medium'
      });
    }

    if (marketConditions.liquidity.level === 'low') {
      warnings.push({
        type: 'low_liquidity',
        message: 'Market liquidity is low. Orders may have higher slippage.',
        severity: 'medium'
      });
    }

    if (Math.abs(marketConditions.fundingRate) > 0.01) {
      warnings.push({
        type: 'high_funding_rate',
        message: `Funding rate is ${(marketConditions.fundingRate * 100).toFixed(3)}%. Consider funding costs.`,
        severity: 'low'
      });
    }

    if (performanceData && performanceData.trades.length < this.scoringParameters.minimumTrades) {
      warnings.push({
        type: 'insufficient_data',
        message: `Only ${performanceData.trades.length} trades analyzed. More data needed for reliable confidence.`,
        severity: 'medium'
      });
    }

    return warnings;
  }

  /**
   * Technical analysis helper functions
   */

  /**
   * Compute Sharpe ratio from an array of trades.
   * Returns 0 if there are fewer than 2 trades (insufficient data).
   */
  computeSharpe(trades) {
    const pnls = trades
      .filter(t => t.pnl !== undefined && t.pnl !== null)
      .map(t => parseFloat(t.pnl));
    if (pnls.length < 2) return 0;
    const avg = pnls.reduce((s, v) => s + v, 0) / pnls.length;
    const variance = pnls.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / pnls.length;
    const stdDev = Math.sqrt(variance);
    return stdDev > 0 ? avg / stdDev : 0;
  }

  /**
   * Append a new score to the per-strategy trajectory buffer,
   * capping at scoringParameters.trajectoryLength entries.
   */
  updateConfidenceTrajectory(cacheKey, score) {
    let buf = this.confidenceTrajectories.get(cacheKey);
    if (!buf) {
      // Evict oldest key if Map exceeds maxTrajectoryKeys
      if (this.confidenceTrajectories.size >= this.scoringParameters.maxTrajectoryKeys) {
        const oldestKey = this.confidenceTrajectories.keys().next().value;
        if (oldestKey !== undefined) {
          this.confidenceTrajectories.delete(oldestKey);
        }
      }
      buf = [];
    }
    buf.push(score);
    if (buf.length > this.scoringParameters.trajectoryLength) {
      buf.shift();
    }
    this.confidenceTrajectories.set(cacheKey, buf);
  }

  /**
   * Return a copy of the trajectory buffer for a strategy-symbol-timeframe key.
   */
  getConfidenceTrajectory(cacheKey) {
    return [...(this.confidenceTrajectories.get(cacheKey) || [])];
  }

  calculateVolatility(klines) {
    try {
      if (klines.length < 2) return 0.5;

      const returns = [];
      for (let i = 1; i < klines.length; i++) {
        const currentClose = parseFloat(klines[i].close);
        const previousClose = parseFloat(klines[i - 1].close);
        const return_ = (currentClose - previousClose) / previousClose;
        returns.push(return_);
      }

      const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
      const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
      const volatility = Math.sqrt(variance);

      return volatility;
    } catch (error) {
      logger.error('Error calculating volatility:', error);
      return 0.5;
    }
  }

  calculateTrendStrength(klines) {
    try {
      if (klines.length < 10) return 0;

      const closes = klines.map(k => parseFloat(k.close));
      const periods = Math.min(20, closes.length);
      const recentCloses = closes.slice(-periods);

      // Calculate linear regression slope
      const n = recentCloses.length;
      const sumX = (n * (n - 1)) / 2;
      const sumY = recentCloses.reduce((sum, price) => sum + price, 0);
      const sumXY = recentCloses.reduce((sum, price, i) => sum + (price * i), 0);
      const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const avgPrice = sumY / n;
      const trendStrength = slope / avgPrice;

      return Math.min(Math.max(trendStrength, -1), 1);
    } catch (error) {
      logger.error('Error calculating trend strength:', error);
      return 0;
    }
  }

  calculateLiquidity(orderBook) {
    try {
      if (!orderBook || !orderBook.bids || !orderBook.asks) return 0.5;

      const bids = orderBook.bids.slice(0, 10);
      const asks = orderBook.asks.slice(0, 10);

      const bidVolume = bids.reduce((sum, bid) => sum + parseFloat(bid.size), 0);
      const askVolume = asks.reduce((sum, ask) => sum + parseFloat(ask.size), 0);
      const totalVolume = bidVolume + askVolume;

      const midPrice = (parseFloat(bids[0].price) + parseFloat(asks[0].price)) / 2;
      const spread = parseFloat(asks[0].price) - parseFloat(bids[0].price);
      const spreadPercent = (spread / midPrice) * 100;

      // Liquidity score based on volume and spread
      const volumeScore = Math.min(totalVolume / 10000, 1);
      const spreadScore = Math.max(0, 1 - (spreadPercent / 0.5));

      return (volumeScore * 0.6) + (spreadScore * 0.4);
    } catch (error) {
      logger.error('Error calculating liquidity:', error);
      return 0.5;
    }
  }

  calculateMomentum(klines) {
    try {
      if (klines.length < 10) return 0;

      const closes = klines.map(k => parseFloat(k.close));
      const periods = Math.min(14, closes.length);
      const recentCloses = closes.slice(-periods);

      const currentPrice = recentCloses[recentCloses.length - 1];
      const pastPrice = recentCloses[0];
      const momentum = (currentPrice - pastPrice) / pastPrice;

      return Math.min(Math.max(momentum, -1), 1);
    } catch (error) {
      logger.error('Error calculating momentum:', error);
      return 0;
    }
  }

  determineMarketPhase(klines, volatility, trendStrength) {
    try {
      if (Math.abs(trendStrength) > 0.7) {
        return 'trending';
      } else if (volatility > 0.03) {
        return 'volatile';
      } else if (Math.abs(trendStrength) < 0.2 && volatility < 0.01) {
        return 'consolidating';
      } else {
        return 'mixed';
      }
    } catch (error) {
      logger.error('Error determining market phase:', error);
      return 'unknown';
    }
  }

  calculateMarketRiskLevel(volatility, liquidity, trendStrength) {
    try {
      let riskScore = 0;

      if (volatility > 0.03) riskScore += 3;
      else if (volatility > 0.02) riskScore += 2;
      else if (volatility > 0.01) riskScore += 1;

      if (liquidity < 0.3) riskScore += 2;
      else if (liquidity < 0.5) riskScore += 1;

      if (Math.abs(trendStrength) < 0.2) riskScore += 1;

      if (riskScore >= 4) return 'high';
      else if (riskScore >= 2) return 'medium';
      else return 'low';
    } catch (error) {
      logger.error('Error calculating market risk level:', error);
      return 'high';
    }
  }

  /**
   * Categorization helper functions
   */
  categorizeVolatility(volatility) {
    if (volatility < 0.01) return 'low';
    if (volatility < 0.03) return 'medium';
    return 'high';
  }

  categorizeLiquidity(liquidity) {
    if (liquidity < 0.3) return 'low';
    if (liquidity < 0.7) return 'medium';
    return 'high';
  }

  categorizeMomentum(momentum) {
    if (Math.abs(momentum) < 0.02) return 'weak';
    if (Math.abs(momentum) < 0.05) return 'moderate';
    return 'strong';
  }

  /**
   * Create low confidence score for insufficient data.
   *
   * When the full minimumTrades threshold has not been reached, we still return
   * partial sub-scores so that callers can see the direction of quality.  All
   * sub-scores default to 0 (not null) so that downstream code need not guard
   * against missing keys.
   */
  createLowConfidenceScore(strategyName, symbol, reason, performanceData = null) {
    // Compute whatever partial sub-scores are available
    const partialPerformance = performanceData &&
      performanceData.trades.length >= this.scoringParameters.minTradesForPerformanceScore
      ? Math.round(this.calculatePerformanceScore(performanceData))
      : 0;
    const partialConsistency = performanceData &&
      performanceData.trades.length >= this.scoringParameters.minTradesForConsistencyScore
      ? Math.round(this.calculateConsistencyScore(performanceData))
      : 0;
    const partialRisk = performanceData &&
      performanceData.trades.length >= this.scoringParameters.minTradesForConsistencyScore
      ? Math.round(this.calculateRiskScore(performanceData))
      : 0;

    return {
      strategyName,
      symbol,
      confidenceScore: 20,
      riskScore: 80,
      recommendedPositionSize: this.scoringParameters.minPositionSize,
      marketConditions: null,
      factors: {
        performance: partialPerformance,
        consistency: partialConsistency,
        risk: partialRisk,
        marketCondition: 0
      },
      censoringInfo: {
        hasCensoredData: false,
        censoredTradeCount: 0,
        confidenceWithCensored: null,
        confidenceWithoutCensored: null,
        estimateUnreliable: false
      },
      warnings: [{
        type: 'insufficient_data',
        message: `Cannot calculate reliable confidence score: ${reason}`,
        severity: 'high'
      }],
      calculatedAt: new Date(),
      tradesAnalyzed: performanceData?.trades.length ?? 0
    };
  }

  /**
   * Store confidence score in database
   */
  async storeConfidenceScore(assessment) {
    try {
      await query(`
        INSERT INTO confidence_scores (
          strategy_name, symbol, timeframe, market_conditions,
          historical_performance, confidence_score, risk_score,
          recommended_position_size, factors, calculated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        assessment.strategyName,
        assessment.symbol,
        assessment.timeframe,
        JSON.stringify(assessment.marketConditions),
        JSON.stringify({
          tradesAnalyzed: assessment.tradesAnalyzed,
          performancePeriod: assessment.performancePeriod
        }),
        assessment.confidenceScore,
        assessment.riskScore,
        assessment.recommendedPositionSize,
        JSON.stringify(assessment.factors),
        assessment.calculatedAt
      ]);
    } catch (error) {
      logger.error('Error storing confidence score:', error);
    }
  }

  /**
   * Load existing confidence scores
   */
  async loadExistingConfidenceScores() {
    try {
      const result = await query(`
        SELECT * FROM confidence_scores 
        WHERE calculated_at > NOW() - INTERVAL '1 hour'
        ORDER BY calculated_at DESC
      `);

      for (const row of result.rows) {
        const cacheKey = `${row.strategy_name}_${row.symbol}_${row.timeframe}`;
        this.confidenceScores.set(cacheKey, {
          strategyName: row.strategy_name,
          symbol: row.symbol,
          timeframe: row.timeframe,
          confidenceScore: row.confidence_score,
          riskScore: row.risk_score,
          recommendedPositionSize: row.recommended_position_size,
          marketConditions: JSON.parse(row.market_conditions),
          factors: JSON.parse(row.factors),
          calculatedAt: row.calculated_at
        });
      }

      logger.info(`📊 Loaded ${result.rows.length} existing confidence scores`);
    } catch (error) {
      logger.error('Error loading existing confidence scores:', error);
    }
  }

  /**
   * Load performance history
   */
  async loadPerformanceHistory() {
    try {
      const result = await query(`
        SELECT strategy_name, symbol, timeframe, 
               AVG(confidence_score) as avg_confidence,
               COUNT(*) as calculation_count,
               MAX(calculated_at) as last_calculation
        FROM confidence_scores 
        WHERE calculated_at > NOW() - INTERVAL '30 days'
        GROUP BY strategy_name, symbol, timeframe
        ORDER BY avg_confidence DESC
      `);

      for (const row of result.rows) {
        const key = `${row.strategy_name}_${row.symbol}_${row.timeframe}`;
        this.performanceHistory.set(key, {
          avgConfidence: row.avg_confidence,
          calculationCount: row.calculation_count,
          lastCalculation: row.last_calculation
        });
      }

      logger.info(`📈 Loaded performance history for ${result.rows.length} strategy-symbol combinations`);
    } catch (error) {
      logger.error('Error loading performance history:', error);
    }
  }

  /**
   * Set up periodic updates
   */
  setupPeriodicUpdates() {
    // Update confidence scores every 15 minutes
    setInterval(() => {
      this.updateAllConfidenceScores();
    }, 15 * 60 * 1000);

    // Update market conditions every 5 minutes
    setInterval(() => {
      this.updateMarketConditions();
    }, 5 * 60 * 1000);
  }

  /**
   * Update all confidence scores
   */
  async updateAllConfidenceScores() {
    try {
      const strategies = await query(`
        SELECT DISTINCT strategy_name, symbol, timeframe
        FROM backtest_results
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND strategy_name IS NOT NULL AND strategy_name <> ''
        
        UNION
        
        SELECT DISTINCT strategy_name, symbol, timeframe
        FROM paper_trading_sessions
        WHERE started_at > NOW() - INTERVAL '7 days'
          AND strategy_name IS NOT NULL AND strategy_name <> ''
      `);

      for (const strategy of strategies.rows) {
        try {
          await this.calculateConfidenceScore(
            strategy.strategy_name,
            strategy.symbol,
            strategy.timeframe
          );
        } catch (error) {
          logger.error(`Error updating confidence score for ${strategy.strategy_name}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error updating all confidence scores:', error);
    }
  }

  /**
   * Update market conditions for all symbols
   */
  async updateMarketConditions() {
    try {
      const symbols = await query(`
        SELECT DISTINCT symbol FROM confidence_scores
        WHERE calculated_at > NOW() - INTERVAL '24 hours'
      `);

      for (const { symbol } of symbols.rows) {
        try {
          await this.analyzeMarketConditions(symbol);
        } catch (error) {
          logger.error(`Error updating market conditions for ${symbol}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error updating market conditions:', error);
    }
  }

  /**
   * Get confidence score for strategy
   */
  getConfidenceScore(strategyName, symbol, timeframe) {
    const cacheKey = `${strategyName}_${symbol}_${timeframe}`;
    return this.confidenceScores.get(cacheKey);
  }

  /**
   * Get market conditions for symbol
   */
  getMarketConditions(symbol) {
    return this.marketConditions.get(symbol);
  }

  /**
   * Get all confidence scores
   */
  getAllConfidenceScores() {
    return Array.from(this.confidenceScores.values());
  }

  /**
   * Get confidence scores for strategy
   */
  getConfidenceScoresForStrategy(strategyName) {
    return Array.from(this.confidenceScores.values())
      .filter(score => score.strategyName === strategyName);
  }

  /**
   * Get service status
   */
  getServiceStatus() {
    return {
      isInitialized: this.isInitialized,
      confidenceScoresCount: this.confidenceScores.size,
      marketConditionsCount: this.marketConditions.size,
      lastUpdate: new Date()
    };
  }
}

export default new ConfidenceScoringService();