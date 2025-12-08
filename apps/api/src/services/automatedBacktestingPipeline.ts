/**
 * Automated Backtesting Pipeline
 * Automatically tests AI-generated strategies and evaluates performance
 */

import backtestingEngine from './backtestingEngine.js';
import { getLLMStrategyGenerator } from './llmStrategyGenerator.js';
import { pool } from '../db/connection.js';
import logger from '../utils/logger.js';

export interface BacktestConfig {
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  leverage?: number;
}

export interface BacktestResult {
  strategyId: string;
  strategyName: string;
  performance: {
    totalTrades: number;
    winRate: number;
    profitLoss: number;
    profitLossPercent: number;
    maxDrawdown: number;
    sharpeRatio: number;
    avgWinAmount: number;
    avgLossAmount: number;
    profitFactor: number;
  };
  trades: Array<{
    entryTime: Date;
    exitTime: Date;
    side: 'long' | 'short';
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    pnl: number;
    pnlPercent: number;
  }>;
  passed: boolean;
  score: number;
}

export interface PipelineResult {
  strategyId: string;
  backtestResults: BacktestResult[];
  averageScore: number;
  recommendation: 'deploy' | 'optimize' | 'reject';
  reasoning: string;
}

export class AutomatedBacktestingPipeline {
  private backtestingEngine: any;
  private minWinRate = 0.55; // 55% minimum win rate
  private minProfitFactor = 1.5; // 1.5:1 profit factor
  private maxDrawdown = 0.20; // 20% max drawdown

  constructor() {
    this.backtestingEngine = backtestingEngine;
  }

  /**
   * Run automated backtest pipeline for an AI-generated strategy
   */
  async runPipeline(
    strategyCode: string,
    strategyName: string,
    configs: BacktestConfig[]
  ): Promise<PipelineResult> {
    logger.info('Starting automated backtesting pipeline', {
      strategyName,
      configCount: configs.length,
    });

    const strategyId = `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const backtestResults: BacktestResult[] = [];

    // Run backtests across multiple configurations in parallel
    const backtestPromises = configs.map(config => 
      this.runSingleBacktest(
        strategyId,
        strategyName,
        strategyCode,
        config
      ).catch(error => {
        logger.error('Backtest failed for config', { config, error });
        return null; // Return null for failed backtests
      })
    );

    const results = await Promise.all(backtestPromises);
    
    // Filter out null results from failed backtests
    backtestResults.push(...results.filter(r => r !== null));

    if (backtestResults.length === 0) {
      throw new Error('All backtests failed');
    }

    // Calculate average score
    const averageScore = backtestResults.reduce((sum, r) => sum + r.score, 0) / backtestResults.length;

    // Determine recommendation
    const recommendation = this.determineRecommendation(backtestResults, averageScore);

    // Generate reasoning
    const reasoning = this.generateReasoning(backtestResults, recommendation);

    // Save pipeline results to database
    await this.savePipelineResults(strategyId, {
      strategyId,
      backtestResults,
      averageScore,
      recommendation,
      reasoning,
    });

    logger.info('Automated backtesting pipeline completed', {
      strategyId,
      averageScore,
      recommendation,
    });

    return {
      strategyId,
      backtestResults,
      averageScore,
      recommendation,
      reasoning,
    };
  }

  /**
   * Run a single backtest
   */
  private async runSingleBacktest(
    strategyId: string,
    strategyName: string,
    strategyCode: string,
    config: BacktestConfig
  ): Promise<BacktestResult> {
    // Execute backtest using the backtesting engine
    const result = await this.backtestingEngine.runBacktest({
      strategyCode,
      symbol: config.symbol,
      startDate: config.startDate,
      endDate: config.endDate,
      initialCapital: config.initialCapital,
      leverage: config.leverage || 1,
    });

    // Calculate performance metrics
    const performance = this.calculatePerformanceMetrics(result);

    // Evaluate if strategy passed criteria
    const passed = this.evaluateStrategy(performance);

    // Calculate score (0-100)
    const score = this.calculateScore(performance);

    return {
      strategyId,
      strategyName,
      performance,
      trades: result.trades,
      passed,
      score,
    };
  }

  /**
   * Calculate comprehensive performance metrics
   */
  private calculatePerformanceMetrics(backtestResult: any) {
    const trades = backtestResult.trades || [];
    const totalTrades = trades.length;
    const winningTrades = trades.filter((t: any) => t.pnl > 0);
    const losingTrades = trades.filter((t: any) => t.pnl < 0);

    const winRate = totalTrades > 0 ? winningTrades.length / totalTrades : 0;
    const totalPnL = trades.reduce((sum: number, t: any) => sum + t.pnl, 0);
    const profitLossPercent = (totalPnL / backtestResult.initialCapital) * 100;

    const avgWinAmount = winningTrades.length > 0
      ? winningTrades.reduce((sum: number, t: any) => sum + t.pnl, 0) / winningTrades.length
      : 0;

    const avgLossAmount = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum: number, t: any) => sum + t.pnl, 0) / losingTrades.length)
      : 0;

    const profitFactor = avgLossAmount > 0 ? avgWinAmount / avgLossAmount : 0;

    // Calculate max drawdown
    let peak = backtestResult.initialCapital;
    let maxDrawdown = 0;
    let currentCapital = backtestResult.initialCapital;

    for (const trade of trades) {
      currentCapital += trade.pnl;
      if (currentCapital > peak) {
        peak = currentCapital;
      }
      const drawdown = (peak - currentCapital) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // Calculate Sharpe ratio (simplified)
    const returns = trades.map((t: any) => t.pnlPercent);
    const avgReturn = returns.reduce((sum: number, r: number) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum: number, r: number) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

    return {
      totalTrades,
      winRate,
      profitLoss: totalPnL,
      profitLossPercent,
      maxDrawdown,
      sharpeRatio,
      avgWinAmount,
      avgLossAmount,
      profitFactor,
    };
  }

  /**
   * Evaluate if strategy meets minimum criteria
   */
  private evaluateStrategy(performance: any): boolean {
    return (
      performance.winRate >= this.minWinRate &&
      performance.profitFactor >= this.minProfitFactor &&
      performance.maxDrawdown <= this.maxDrawdown &&
      performance.profitLossPercent > 0
    );
  }

  /**
   * Calculate overall score (0-100)
   */
  private calculateScore(performance: any): number {
    const winRateScore = Math.min(performance.winRate / 0.7, 1) * 30; // 30 points max
    const profitFactorScore = Math.min(performance.profitFactor / 3, 1) * 25; // 25 points max
    const drawdownScore = Math.max(1 - performance.maxDrawdown / 0.3, 0) * 20; // 20 points max
    const sharpeScore = Math.min(Math.max(performance.sharpeRatio, 0) / 2, 1) * 15; // 15 points max
    const profitScore = Math.min(Math.max(performance.profitLossPercent, 0) / 50, 1) * 10; // 10 points max

    return Math.round(winRateScore + profitFactorScore + drawdownScore + sharpeScore + profitScore);
  }

  /**
   * Determine recommendation based on results
   */
  private determineRecommendation(
    results: BacktestResult[],
    averageScore: number
  ): 'deploy' | 'optimize' | 'reject' {
    const passedCount = results.filter((r) => r.passed).length;
    const passRate = passedCount / results.length;

    if (averageScore >= 75 && passRate >= 0.8) {
      return 'deploy';
    } else if (averageScore >= 50 && passRate >= 0.5) {
      return 'optimize';
    } else {
      return 'reject';
    }
  }

  /**
   * Generate human-readable reasoning
   */
  private generateReasoning(
    results: BacktestResult[],
    recommendation: string
  ): string {
    const avgWinRate = results.reduce((sum, r) => sum + r.performance.winRate, 0) / results.length;
    const avgProfitFactor = results.reduce((sum, r) => sum + r.performance.profitFactor, 0) / results.length;
    const avgDrawdown = results.reduce((sum, r) => sum + r.performance.maxDrawdown, 0) / results.length;

    if (recommendation === 'deploy') {
      return `Strategy shows strong performance across ${results.length} backtests with ${(avgWinRate * 100).toFixed(1)}% average win rate, ${avgProfitFactor.toFixed(2)} profit factor, and ${(avgDrawdown * 100).toFixed(1)}% max drawdown. Ready for live deployment.`;
    } else if (recommendation === 'optimize') {
      return `Strategy shows potential but needs optimization. Current metrics: ${(avgWinRate * 100).toFixed(1)}% win rate, ${avgProfitFactor.toFixed(2)} profit factor. Consider adjusting parameters or risk management.`;
    } else {
      return `Strategy failed to meet minimum criteria across backtests. Win rate: ${(avgWinRate * 100).toFixed(1)}%, Profit factor: ${avgProfitFactor.toFixed(2)}. Recommend generating a new strategy.`;
    }
  }

  /**
   * Save pipeline results to database
   */
  private async savePipelineResults(strategyId: string, results: PipelineResult): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO backtest_pipeline_results 
         (strategy_id, results, average_score, recommendation, reasoning, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (strategy_id) DO UPDATE
         SET results = $2, average_score = $3, recommendation = $4, reasoning = $5, updated_at = NOW()`,
        [
          strategyId,
          JSON.stringify(results.backtestResults),
          results.averageScore,
          results.recommendation,
          results.reasoning,
        ]
      );
    } catch (error) {
      logger.error('Failed to save pipeline results', { error });
    }
  }

  /**
   * Get pipeline results for a strategy
   */
  async getPipelineResults(strategyId: string): Promise<PipelineResult | null> {
    try {
      const result = await pool.query(
        'SELECT * FROM backtest_pipeline_results WHERE strategy_id = $1',
        [strategyId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        strategyId: row.strategy_id,
        backtestResults: JSON.parse(row.results),
        averageScore: row.average_score,
        recommendation: row.recommendation,
        reasoning: row.reasoning,
      };
    } catch (error) {
      logger.error('Failed to get pipeline results', { error });
      return null;
    }
  }
}

export const automatedBacktestingPipeline = new AutomatedBacktestingPipeline();
