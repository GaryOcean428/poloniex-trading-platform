import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import backtestingEngine from '../services/backtestingEngine.js';
import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import type { Request, Response } from 'express';

interface BacktestConfig {
  strategyId: string;
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  timeframe: string;
}

interface BacktestRecord {
  id: string;
  userId: string;
  strategyId: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  timeframe: string;
  status: string;
  progress: number;
  startedAt: Date;
  results: unknown;
  error: string | null;
  completedAt?: Date;
}

interface StrategyRow {
  id: string;
  name: string;
  symbol: string;
  status: string;
  performance: Record<string, number> | null;
  timeframe: string;
  created_at: string;
  updated_at: string;
}

interface PipelineResultRow {
  strategy_id: string;
  strategy_name: string | null;
  symbol: string | null;
  timeframe: string | null;
  strategy_status: string | null;
  results: Record<string, unknown> | null;
  average_score: string | null;
  recommendation: string | null;
  reasoning: string | null;
  performance: Record<string, unknown> | null;
  pipeline_created_at: string;
}

interface PaperTradingSummary {
  totalSessions: number;
  activeSessions: number;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  totalTrades: number;
  winningTrades: number;
  winRate: number;
  averageReturnPct: number;
}

interface RecentEvent {
  strategyId: string;
  strategyName: string;
  symbol: string;
  status: string;
  updatedAt: string;
  createdAt: string;
}

interface StrategyBreakdown {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  status: string;
  performance: Record<string, number>;
}

interface BacktestResultRow {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  start_date: string;
  end_date: string;
  initial_capital: string;
  timeframe: string;
  status: string;
  progress: string;
  results: string | Record<string, unknown> | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

const router = express.Router();

// Pipeline readiness thresholds
const MIN_CONFIDENCE_THRESHOLD = 60;
const MIN_WIN_RATE_THRESHOLD = 45;

// Store running backtests in-memory for active progress tracking
// Completed results are persisted to the database
const runningBacktests = new Map<string, BacktestRecord>();

/**
 * Persist a completed/failed backtest to the database for cross-restart survival.
 */
async function persistBacktestToDB(backtest: BacktestRecord): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO backtest_results
        (id, user_id, strategy_id, symbol, start_date, end_date, initial_capital, timeframe, status, progress, results, error, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        progress = EXCLUDED.progress,
        results = EXCLUDED.results,
        error = EXCLUDED.error,
        completed_at = EXCLUDED.completed_at`,
      [
        backtest.id,
        backtest.userId,
        backtest.strategyId,
        backtest.symbol,
        backtest.startDate,
        backtest.endDate,
        backtest.initialCapital,
        backtest.timeframe,
        backtest.status,
        backtest.progress,
        JSON.stringify(backtest.results),
        backtest.error,
        backtest.startedAt,
        backtest.completedAt || null
      ]
    );
  } catch (err: unknown) {
    // Table may not exist yet — log and continue using in-memory only
    logger.warn('Could not persist backtest to DB (table may not exist):', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Load a backtest from the database if it's not in the in-memory map.
 */
async function loadBacktestFromDB(backtestId: string): Promise<BacktestRecord | null> {
  try {
    const result = await pool.query(
      `SELECT * FROM backtest_results WHERE id = $1`,
      [backtestId]
    );
    if (result.rows.length === 0) return null;
    const row: BacktestResultRow = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      strategyId: row.strategy_id,
      symbol: row.symbol,
      startDate: row.start_date,
      endDate: row.end_date,
      initialCapital: parseFloat(row.initial_capital) || 10000,
      timeframe: row.timeframe,
      status: row.status,
      progress: parseInt(row.progress) || 0,
      startedAt: new Date(row.started_at),
      results: typeof row.results === 'string' ? JSON.parse(row.results) : row.results,
      error: row.error,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined
    };
  } catch {
    return null;
  }
}

/**
 * POST /api/backtest/run
 * Start a new backtest
 */
router.post('/run', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    const { strategyId, symbol, startDate, endDate, initialCapital, timeframe } = req.body;
    
    // Validate inputs
    if (!strategyId || !symbol || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: strategyId, symbol, startDate, endDate'
      });
    }
    
    // Generate backtest ID
    const backtestId = `backtest_${Date.now()}_${userId}`;
    
    // Initialize backtest status
    runningBacktests.set(backtestId, {
      id: backtestId,
      userId,
      strategyId,
      symbol,
      startDate,
      endDate,
      initialCapital: initialCapital || 10000,
      timeframe: timeframe || '1h',
      status: 'running',
      progress: 0,
      startedAt: new Date(),
      results: null,
      error: null
    });
    
    // Run backtest asynchronously
    runBacktestAsync(backtestId, {
      strategyId,
      symbol,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      initialCapital: initialCapital || 10000,
      timeframe: timeframe || '1h'
    });
    
    res.json({
      success: true,
      id: backtestId,
      message: 'Backtest started'
    });
    
  } catch (error: unknown) {
    logger.error('Error starting backtest:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errMsg || 'Failed to start backtest'
    });
  }
});

/**
 * GET /api/backtest/status/:id
 * Get backtest status and results
 */
router.get('/status/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let backtest = runningBacktests.get(id);
    
    // Fall back to database if not in memory (e.g., after server restart)
    if (!backtest) {
      backtest = await loadBacktestFromDB(id) ?? undefined;
    }

    if (!backtest) {
      return res.status(404).json({
        success: false,
        error: 'Backtest not found'
      });
    }
    
    // Check if user owns this backtest
    if (backtest.userId !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    res.json({
      success: true,
      ...backtest
    });
    
  } catch (error: unknown) {
    logger.error('Error fetching backtest status:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errMsg || 'Failed to fetch backtest status'
    });
  }
});

/**
 * GET /api/backtest/history
 * Get user's backtest history
 */
router.get('/history', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    const limit = parseInt(req.query.limit as string) || 20;
    
    // Merge in-memory running backtests with persisted DB backtests
    const inMemory = Array.from(runningBacktests.values())
      .filter(bt => bt.userId === userId);

    let dbBacktests: BacktestRecord[] = [];
    try {
      const dbResult = await pool.query(
        `SELECT * FROM backtest_results WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2`,
        [userId, limit]
      );
      dbBacktests = dbResult.rows.map((row: BacktestResultRow) => ({
        id: row.id,
        userId: row.user_id,
        strategyId: row.strategy_id,
        symbol: row.symbol,
        startDate: row.start_date,
        endDate: row.end_date,
        initialCapital: parseFloat(row.initial_capital) || 10000,
        timeframe: row.timeframe,
        status: row.status,
        progress: parseInt(row.progress) || 0,
        startedAt: new Date(row.started_at),
        results: typeof row.results === 'string' ? JSON.parse(row.results) : row.results,
        error: row.error,
        completedAt: row.completed_at ? new Date(row.completed_at) : undefined
      }));
    } catch {
      // DB table may not exist — fallback to in-memory only
    }

    // Deduplicate: in-memory takes priority (more recent data)
    const seenIds = new Set(inMemory.map(bt => bt.id));
    const merged = [
      ...inMemory,
      ...dbBacktests.filter(bt => !seenIds.has(bt.id))
    ]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);

    res.json({
      success: true,
      backtests: merged
    });
    
  } catch (error: unknown) {
    logger.error('Error fetching backtest history:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errMsg || 'Failed to fetch backtest history'
    });
  }
});

/**
 * DELETE /api/backtest/:id
 * Delete a backtest
 */
router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const backtest = runningBacktests.get(id);
    
    if (!backtest) {
      return res.status(404).json({
        success: false,
        error: 'Backtest not found'
      });
    }
    
    // Check if user owns this backtest
    if (backtest.userId !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    runningBacktests.delete(id);
    
    // Also delete from DB
    try {
      await pool.query('DELETE FROM backtest_results WHERE id = $1', [id]);
    } catch {
      // DB table may not exist — in-memory delete is sufficient
    }

    res.json({
      success: true,
      message: 'Backtest deleted'
    });
    
  } catch (error: unknown) {
    logger.error('Error deleting backtest:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errMsg || 'Failed to delete backtest'
    });
  }
});

/**
 * Run backtest asynchronously
 */
async function runBacktestAsync(backtestId: string, config: BacktestConfig): Promise<void> {
  const backtest = runningBacktests.get(backtestId);
  if (!backtest) return;
  
  try {
    logger.info(`Running backtest ${backtestId}`, config);
    
    // Update progress
    backtest.progress = 10;
    
    // Get strategy (mock for now)
    const strategy = {
      id: config.strategyId,
      name: 'Test Strategy',
      type: 'trend_following',
      parameters: {
        fastPeriod: 10,
        slowPeriod: 30
      }
    };
    
    backtest.progress = 30;
    
    // Run backtest using backtesting engine
    const results = await backtestingEngine.runBacktest(strategy.name, {
      symbol: config.symbol,
      startDate: config.startDate,
      endDate: config.endDate,
      initialCapital: config.initialCapital,
      timeframe: config.timeframe
    });
    
    backtest.progress = 90;
    
    // Store results
    backtest.status = 'completed';
    backtest.progress = 100;
    backtest.results = results;
    backtest.completedAt = new Date();

    // Persist completed backtest to database
    await persistBacktestToDB(backtest);
    
    logger.info(`Backtest ${backtestId} completed`, { results });
    
  } catch (error: unknown) {
    logger.error(`Backtest ${backtestId} failed:`, error);
    const errMsg = error instanceof Error ? error.message : String(error);
    backtest.status = 'failed';
    backtest.error = errMsg || 'Backtest failed';
    backtest.completedAt = new Date();

    // Persist failed backtest to database
    await persistBacktestToDB(backtest);
  }
}

/**
 * GET /api/backtest/pipeline/results
 * Get automated agent-driven backtest pipeline results with confidence assessment
 */
router.get('/pipeline/results', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    const limit = parseInt(req.query.limit as string) || 20;
    const strategyId = req.query.strategy_id as string | undefined;

    let pipelineResults: Array<Record<string, unknown>> = [];

    try {
      let queryText = `
        SELECT
          bpr.strategy_id,
          bpr.results,
          bpr.average_score,
          bpr.recommendation,
          bpr.reasoning,
          bpr.created_at AS pipeline_created_at,
          ast.name AS strategy_name,
          ast.symbol,
          ast.status AS strategy_status,
          ast.performance,
          ast.timeframe
        FROM backtest_pipeline_results bpr
        LEFT JOIN agent_strategies ast ON bpr.strategy_id = ast.id::text
        LEFT JOIN agent_sessions asess ON ast.session_id = asess.id
        WHERE asess.user_id = $1
      `;
      const params: (string | number)[] = [userId];

      if (strategyId) {
        params.push(strategyId);
        queryText += ` AND bpr.strategy_id = $${params.length}`;
      }

      queryText += ` ORDER BY bpr.created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await pool.query(queryText, params);
      pipelineResults = result.rows.map((row: PipelineResultRow) => ({
        strategyId: row.strategy_id,
        strategyName: row.strategy_name || 'Unknown Strategy',
        symbol: row.symbol || 'N/A',
        timeframe: row.timeframe || '1h',
        status: row.strategy_status || 'unknown',
        results: row.results || {},
        averageScore: parseFloat(row.average_score) || 0,
        recommendation: row.recommendation || 'pending',
        reasoning: row.reasoning || '',
        performance: row.performance || {},
        confidence: {
          score: parseFloat(row.average_score) || 0,
          level: getConfidenceLevel(parseFloat(row.average_score) || 0),
          assessedAt: row.pipeline_created_at
        },
        createdAt: row.pipeline_created_at
      }));
    } catch (dbError: unknown) {
      logger.warn('Pipeline results tables not available yet, returning empty results', {
        error: dbError instanceof Error ? dbError.message : String(dbError)
      });
    }

    res.json({
      success: true,
      results: pipelineResults
    });

  } catch (error: unknown) {
    logger.error('Error fetching pipeline results:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errMsg || 'Failed to fetch pipeline results',
      results: []
    });
  }
});

/**
 * GET /api/backtest/pipeline/summary
 * Get summary dashboard of all agent backtested strategies
 */
router.get('/pipeline/summary', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);

    // Defaults for when tables don't exist yet
    let totalGenerated = 0;
    let totalBacktested = 0;
    let totalPaperTrading = 0;
    let totalLive = 0;
    let overallConfidence = 0;
    let averageMaxDrawdown = 0;
    let paperTradingSummary: PaperTradingSummary | null = null;
    let recentEvents: RecentEvent[] = [];
    let strategyBreakdown: StrategyBreakdown[] = [];

    // Query agent_strategies for status counts and performance
    try {
      const strategiesResult = await pool.query(
        `SELECT ast.id, ast.name, ast.symbol, ast.status, ast.performance, ast.timeframe, ast.created_at, ast.updated_at
         FROM agent_strategies ast
         JOIN agent_sessions asess ON ast.session_id = asess.id
         WHERE asess.user_id = $1
         ORDER BY ast.updated_at DESC`,
        [userId]
      );

      const strategies = strategiesResult.rows;
      totalGenerated = strategies.length;
      totalBacktested = strategies.filter((s: StrategyRow) =>
        ['backtested', 'paper_trading', 'live', 'deployed'].includes(s.status)
      ).length;
      totalPaperTrading = strategies.filter((s: StrategyRow) => s.status === 'paper_trading').length;
      totalLive = strategies.filter((s: StrategyRow) => ['live', 'deployed'].includes(s.status)).length;

      // Collect max drawdowns from performance data
      const drawdowns: number[] = [];
      for (const s of strategies) {
        const perf = s.performance;
        if (perf && typeof perf === 'object' && typeof perf.maxDrawdown === 'number') {
          drawdowns.push(perf.maxDrawdown);
        }
      }
      if (drawdowns.length > 0) {
        averageMaxDrawdown = drawdowns.reduce((a: number, b: number) => a + b, 0) / drawdowns.length;
      }

      // Build recent lifecycle events from the last 10 updated strategies
      recentEvents = strategies.slice(0, 10).map((s: StrategyRow) => ({
        strategyId: s.id,
        strategyName: s.name,
        symbol: s.symbol,
        status: s.status,
        updatedAt: s.updated_at,
        createdAt: s.created_at
      }));

      strategyBreakdown = strategies.map((s: StrategyRow) => ({
        id: s.id,
        name: s.name,
        symbol: s.symbol,
        timeframe: s.timeframe,
        status: s.status,
        performance: s.performance || {}
      }));
    } catch (dbError: unknown) {
      logger.warn('agent_strategies table not available yet', { error: dbError instanceof Error ? dbError.message : String(dbError) });
    }

    // Query pipeline results for overall confidence
    try {
      const pipelineScores = await pool.query(
        `SELECT bpr.average_score
         FROM backtest_pipeline_results bpr
         JOIN agent_strategies ast ON bpr.strategy_id = ast.id::text
         JOIN agent_sessions asess ON ast.session_id = asess.id
         WHERE asess.user_id = $1 AND bpr.average_score IS NOT NULL`,
        [userId]
      );

      if (pipelineScores.rows.length > 0) {
        const scores = pipelineScores.rows.map((r: { average_score: string }) => parseFloat(r.average_score));
        overallConfidence = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
      }
    } catch (dbError: unknown) {
      logger.warn('backtest_pipeline_results table not available yet', { error: dbError instanceof Error ? dbError.message : String(dbError) });
    }

    // Query paper trading sessions summary
    try {
      const paperResult = await pool.query(
        `SELECT
           COUNT(*) AS total_sessions,
           COUNT(*) FILTER (WHERE status = 'active') AS active_sessions,
           COALESCE(SUM(realized_pnl), 0) AS total_realized_pnl,
           COALESCE(SUM(unrealized_pnl), 0) AS total_unrealized_pnl,
           COALESCE(SUM(total_trades), 0) AS total_trades,
           COALESCE(SUM(winning_trades), 0) AS total_winning_trades,
           COALESCE(AVG((current_value - initial_capital) / NULLIF(initial_capital, 0) * 100), 0) AS avg_return_pct
         FROM paper_trading_sessions
         WHERE strategy_name IN (
           SELECT ast.name FROM agent_strategies ast
           JOIN agent_sessions asess ON ast.session_id = asess.id
           WHERE asess.user_id = $1
         )`,
        [userId]
      );

      const paper = paperResult.rows[0];
      const paperSessionCount = parseInt(paper?.total_sessions) || 0;
      if (paperSessionCount > 0) {
        const totalTrades = parseInt(paper.total_trades) || 0;
        const winningTrades = parseInt(paper.total_winning_trades) || 0;
        paperTradingSummary = {
          totalSessions: paperSessionCount,
          activeSessions: parseInt(paper.active_sessions) || 0,
          totalRealizedPnl: parseFloat(paper.total_realized_pnl) || 0,
          totalUnrealizedPnl: parseFloat(paper.total_unrealized_pnl) || 0,
          totalTrades,
          winningTrades,
          winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
          averageReturnPct: parseFloat(paper.avg_return_pct) || 0
        };
      }
    } catch (dbError: unknown) {
      logger.warn('paper_trading_sessions table not available yet', { error: dbError instanceof Error ? dbError.message : String(dbError) });
    }

    const riskRating = getRiskRating(averageMaxDrawdown);
    const liveReadiness = assessLiveReadiness(
      totalBacktested,
      overallConfidence,
      riskRating,
      paperTradingSummary
    );

    res.json({
      success: true,
      summary: {
        strategyCounts: {
          generated: totalGenerated,
          backtested: totalBacktested,
          paperTrading: totalPaperTrading,
          live: totalLive
        },
        confidence: {
          score: Math.round(overallConfidence * 100) / 100,
          level: getConfidenceLevel(overallConfidence)
        },
        risk: {
          rating: riskRating,
          averageMaxDrawdown: Math.round(averageMaxDrawdown * 100) / 100
        },
        paperTrading: paperTradingSummary,
        liveReadiness,
        recentEvents,
        strategyBreakdown
      }
    });

  } catch (error: unknown) {
    logger.error('Error fetching pipeline summary:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errMsg || 'Failed to fetch pipeline summary',
      summary: {
        strategyCounts: { generated: 0, backtested: 0, paperTrading: 0, live: 0 },
        confidence: { score: 0, level: 'insufficient_data' },
        risk: { rating: 'unknown', averageMaxDrawdown: 0 },
        paperTrading: null,
        liveReadiness: { ready: false, reasons: ['Unable to load pipeline data'] },
        recentEvents: [],
        strategyBreakdown: []
      }
    });
  }
});

/**
 * Map a numeric confidence score to a human-readable level
 */
function getConfidenceLevel(score: number): string {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  if (score >= 40) return 'low';
  if (score > 0) return 'very_low';
  return 'insufficient_data';
}

/**
 * Derive a risk rating from the average max drawdown percentage
 */
function getRiskRating(avgMaxDrawdown: number): string {
  const dd = Math.abs(avgMaxDrawdown);
  if (dd >= 30) return 'very_high';
  if (dd >= 20) return 'high';
  if (dd >= 10) return 'medium';
  if (dd > 0) return 'low';
  return 'unknown';
}

/**
 * Assess whether the portfolio of strategies is ready for live trading
 */
function assessLiveReadiness(
  totalBacktested: number,
  confidence: number,
  riskRating: string,
  paperTradingSummary: PaperTradingSummary | null
): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (totalBacktested === 0) {
    reasons.push('No strategies have been backtested yet');
  }
  if (confidence < MIN_CONFIDENCE_THRESHOLD) {
    reasons.push(`Overall confidence score is below the recommended threshold (${MIN_CONFIDENCE_THRESHOLD})`);
  }
  if (riskRating === 'very_high' || riskRating === 'high') {
    reasons.push(`Risk rating is ${riskRating} — consider reducing exposure or adjusting strategy parameters`);
  }
  if (!paperTradingSummary) {
    reasons.push('No paper trading data available — paper trading validation is recommended before going live');
  } else if (paperTradingSummary.winRate < MIN_WIN_RATE_THRESHOLD) {
    reasons.push(`Paper trading win rate (${paperTradingSummary.winRate.toFixed(1)}%) is below the recommended minimum (${MIN_WIN_RATE_THRESHOLD}%)`);
  }

  return {
    ready: reasons.length === 0,
    reasons: reasons.length > 0 ? reasons : ['All readiness checks passed']
  };
}

export default router;
