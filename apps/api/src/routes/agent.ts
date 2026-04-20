import type { Request, Response } from 'express';
import express from 'express';
import { pool } from '../db/connection.js';
import { authenticateToken } from '../middleware/auth.js';
import { agentSettingsService } from '../services/agentSettingsService.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';
import {
  getExecutionModeRecord,
  setExecutionMode,
  type ExecutionMode,
} from '../services/executionModeService.js';
import { fullyAutonomousTrader } from '../services/fullyAutonomousTrader.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { strategyLearningEngine } from '../services/strategyLearningEngine.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/** Check if an error is caused by a missing database table/relation */
function isTableMissingError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('does not exist') || msg.includes('relation');
}

/**
 * POST /api/agent/start
 * Start the autonomous trading agent (SLE + fullyAutonomousTrader)
 */
router.post('/start', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token',
        code: 'NO_USER_ID'
      });
    }

    // Check for API credentials first
    const { apiCredentialsService } = await import('../services/apiCredentialsService.js');
    const hasCredentials = await apiCredentialsService.hasCredentials(userId);

    if (!hasCredentials) {
      return res.status(400).json({
        success: false,
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        code: 'NO_CREDENTIALS',
        action: 'redirect_to_api_keys'
      });
    }

    const config = req.body;

    // Start the strategy learning engine (generates + evaluates strategies)
    await strategyLearningEngine.start();

    // Enable the execution engine in paper-trading mode by default
    await fullyAutonomousTrader.enableAutonomousTrading(userId, {
      paperTrading: config?.paperTrading !== undefined ? config.paperTrading : true,
      ...config
    });

    const traderStatus = await fullyAutonomousTrader.getStatus(userId);
    const sleStatus = await strategyLearningEngine.getEngineStatus();

    res.json({
      success: true,
      session: {
        status: 'running',
        sle: sleStatus,
        trader: traderStatus
      }
    });
  } catch (error: unknown) {
    logger.error('Error starting agent:', error);
    const errMsg = error instanceof Error ? error.message : String(error);

    if (errMsg.includes('already') || errMsg.includes('Already')) {
      try {
        const catchUserId = (req.user?.id || req.user?.userId)?.toString();
        const existingStatus = catchUserId ? await fullyAutonomousTrader.getStatus(catchUserId) : null;
        return res.status(409).json({
          success: false,
          error: 'An agent session is already active',
          code: 'ALREADY_RUNNING',
          existingState: existingStatus?.isRunning ? 'running' : 'unknown',
          resumeAllowed: false,
          takeoverAllowed: true
        });
      } catch {
        return res.status(409).json({
          success: false,
          error: 'An agent session is already active',
          code: 'ALREADY_RUNNING',
          existingState: 'unknown',
          resumeAllowed: false,
          takeoverAllowed: true
        });
      }
    }

    let errorCode = 'UNKNOWN_ERROR';
    let statusCode = 500;

    if (errMsg.includes('credentials')) {
      errorCode = 'CREDENTIALS_ERROR';
      statusCode = 400;
    } else if (errMsg.includes('API')) {
      errorCode = 'API_ERROR';
      statusCode = 503;
    }

    res.status(statusCode).json({
      success: false,
      error: errMsg,
      code: errorCode
    });
  }
});

router.post('/stop', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });
    // Global halt: flip execution mode to 'pause' so the risk kernel
    // vetoes every order submission (liveSignalEngine, fullyAutonomousTrader,
    // paperTradingService all cascade through this one switch).
    const operator = (req.user?.email || req.user?.id || req.user?.userId || 'header_stop').toString();
    await setExecutionMode('pause', operator, 'Header Stop button');
    try { await fullyAutonomousTrader.disableAutonomousTrading(userId); } catch { /* may not be enabled */ }
    res.json({ success: true, message: 'Agent stopped successfully', mode: 'pause' });
  } catch (error: unknown) {
    logger.error('Error stopping agent:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to stop agent' });
  }
});

router.post('/pause', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });
    // Global halt — same as /stop but keeps the per-user trader state
    // alive so it resumes cleanly on /resume.
    const operator = (req.user?.email || req.user?.id || req.user?.userId || 'header_pause').toString();
    await setExecutionMode('pause', operator, 'Header Pause button');
    res.json({ success: true, message: 'Agent paused successfully', mode: 'pause' });
  } catch (error: unknown) {
    logger.error('Error pausing agent:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to pause agent' });
  }
});

router.post('/resume', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });
    const operator = (req.user?.email || req.user?.id || req.user?.userId || 'header_resume').toString();
    await setExecutionMode('auto', operator, 'Header Resume button');
    await strategyLearningEngine.start();
    res.json({ success: true, message: 'Agent resumed successfully', mode: 'auto' });
  } catch (error: unknown) {
    logger.error('Error resuming agent:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to resume agent' });
  }
});

router.get('/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });
    const sleStatus = await strategyLearningEngine.getEngineStatus();
    const traderStatus = await fullyAutonomousTrader.getStatus(userId);
    const execMode = await getExecutionModeRecord();
    // Resolve a single user-facing status. When execution mode is
    // paused, surface that as the dominant state even if the SLE
    // generation loop happens to be mid-tick — this is what the
    // header Pause/Stop buttons advertise.
    const running = traderStatus.isRunning || sleStatus.isRunning;
    let status: 'running' | 'paused' | 'stopped';
    if (execMode?.mode === 'pause') status = 'paused';
    else if (running) status = 'running';
    else status = 'stopped';
    res.json({
      success: true,
      status: {
        id: userId,
        status,
        executionMode: execMode?.mode ?? null,
        startedAt: null,
        sle: sleStatus,
        trader: traderStatus
      }
    });
  } catch (error: unknown) {
    logger.error('Error getting agent status:', error);
    res.status(500).json({ success: false, error: 'Failed to get agent status' });
  }
});

router.get('/health', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });
    let dbHealthy = false;
    try { await pool.query('SELECT 1'); dbHealthy = true; } catch { /* DB down */ }
    let sleStatus = null;
    try { sleStatus = await strategyLearningEngine.getEngineStatus(); } catch { /* unavailable */ }
    let traderStatus = null;
    try { traderStatus = await fullyAutonomousTrader.getStatus(userId); } catch { /* unavailable */ }
    const agentAvailable = strategyLearningEngine != null && fullyAutonomousTrader != null;
    res.json({
      success: true, healthy: dbHealthy && agentAvailable,
      dependencies: {
        database: { healthy: dbHealthy, message: dbHealthy ? 'Connected' : 'Connection failed' },
        agentService: { healthy: agentAvailable, message: agentAvailable ? 'Available' : 'Unavailable' },
        sle: sleStatus ? { isRunning: sleStatus.isRunning, activeStrategies: sleStatus.activeStrategies } : null,
        trader: traderStatus ? { enabled: traderStatus.enabled, isRunning: traderStatus.isRunning, paperTrading: traderStatus.paperTrading, openPositions: traderStatus.openPositions } : null
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: unknown) {
    logger.error('Error checking agent health:', error);
    res.status(503).json({ success: false, error: 'Health check failed', code: 'HEALTH_CHECK_FAILED', dependencies: { database: { healthy: false, message: 'Unknown' }, agentService: { healthy: false, message: 'Unknown' } }, retryable: true, timestamp: new Date().toISOString() });
  }
});

router.get('/activity', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });
    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1), 100);
    const result = await pool.query(
      `SELECT * FROM agent_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    res.json({ success: true, activity: result.rows });
  } catch (error: unknown) {
    if (isTableMissingError(error)) return res.json({ success: true, activity: [] });
    logger.error('Agent activity query failed:', error instanceof Error ? error.message : String(error));
    res.json({ success: true, activity: [], _fallback: true });
  }
});

router.get('/events', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });
    const rawEventsLimit = parseInt(req.query.limit as string, 10);
    const limit = Math.min(Math.max(Number.isFinite(rawEventsLimit) ? rawEventsLimit : 50, 1), 500);
    const eventType = req.query.type as string | undefined;
    const mode = req.query.mode as string | undefined;
    let queryText = `SELECT * FROM agent_events WHERE user_id = $1`;
    const params: (string | number)[] = [userId];
    if (eventType) { params.push(eventType); queryText += ` AND event_type = $${params.length}`; }
    if (mode) { params.push(mode); queryText += ` AND execution_mode = $${params.length}`; }
    queryText += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    const result = await pool.query(queryText, params);
    res.json({ success: true, events: result.rows });
  } catch (error: unknown) {
    if (isTableMissingError(error)) return res.json({ success: true, events: [] });
    logger.error('Agent events query failed:', error instanceof Error ? error.message : String(error));
    res.json({ success: true, events: [], _fallback: true });
  }
});

router.get('/strategies', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const strategies = await strategyLearningEngine.getTopPerformers();
    res.json({ success: true, strategies });
  } catch (error: unknown) {
    logger.error('Error getting strategies:', error);
    res.json({ success: true, strategies: [], _fallback: true });
  }
});

router.get('/performance', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });
    const defaultPerformance = { totalPnl: 0, winRate: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0, averageWin: 0, averageLoss: 0, sharpeRatio: 0, maxDrawdown: 0 };
    const traderStatus = await fullyAutonomousTrader.getStatus(userId);
    if (!traderStatus.enabled && !traderStatus.metrics) return res.json({ success: true, performance: defaultPerformance, dailyPerformance: [] });
    try {
      const mode = req.query.mode as string | undefined;
      const modeFilter = mode === 'paper' ? " AND order_id LIKE 'paper_%'" : mode === 'live' ? " AND (order_id IS NULL OR order_id NOT LIKE 'paper_%')" : '';
      const tradesResult = await pool.query(`SELECT COUNT(*) as total_trades, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades, SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing_trades, SUM(pnl) as total_pnl, AVG(CASE WHEN pnl > 0 THEN pnl END) as avg_win, AVG(CASE WHEN pnl < 0 THEN pnl END) as avg_loss FROM autonomous_trades WHERE user_id = $1${modeFilter}`, [userId]);
      const metrics = tradesResult.rows[0];
      let sharpeRatio = 0; let maxDrawdown = 0;
      try {
        const returnsResult = await pool.query(`SELECT pnl FROM autonomous_trades WHERE user_id = $1 AND pnl IS NOT NULL${modeFilter} ORDER BY created_at ASC`, [userId]);
        const pnls = returnsResult.rows.map((r: { pnl: string }) => parseFloat(r.pnl));
        if (pnls.length > 1) {
          const mean = pnls.reduce((a: number, b: number) => a + b, 0) / pnls.length;
          const variance = pnls.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / (pnls.length - 1);
          const stdDev = Math.sqrt(variance);
          sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
          let peak = 0; let cumPnl = 0;
          for (const pnl of pnls) { cumPnl += pnl; if (cumPnl > peak) peak = cumPnl; const dd = peak > 0 ? (peak - cumPnl) / peak : 0; if (dd > maxDrawdown) maxDrawdown = dd; }
        }
      } catch { /* keep defaults */ }
      let dailyPerformance: Array<{ date: string; pnl: number; cumulativePnL: number; trades: number }> = [];
      try {
        const dailyResult = await pool.query(`SELECT DATE(created_at) as trade_date, SUM(pnl) as daily_pnl, COUNT(*) as daily_trades FROM autonomous_trades WHERE user_id = $1 AND pnl IS NOT NULL${modeFilter} GROUP BY DATE(created_at) ORDER BY trade_date ASC`, [userId]);
        let cumPnl = 0;
        dailyPerformance = dailyResult.rows.map((r: { trade_date: string; daily_pnl: string; daily_trades: string }) => { const dayPnl = parseFloat(r.daily_pnl) || 0; cumPnl += dayPnl; return { date: new Date(r.trade_date).toISOString().slice(0, 10), pnl: parseFloat(dayPnl.toFixed(2)), cumulativePnL: parseFloat(cumPnl.toFixed(2)), trades: parseInt(r.daily_trades, 10) || 0 }; });
      } catch { /* daily unavailable */ }
      res.json({ success: true, mode: mode || 'all', performance: { totalPnl: parseFloat(metrics.total_pnl || 0), winRate: metrics.total_trades > 0 ? (parseFloat(metrics.winning_trades || 0) / parseFloat(metrics.total_trades)) * 100 : 0, totalTrades: parseInt(metrics.total_trades || 0, 10), winningTrades: parseInt(metrics.winning_trades || 0, 10), losingTrades: parseInt(metrics.losing_trades || 0, 10), averageWin: parseFloat(metrics.avg_win || 0), averageLoss: parseFloat(metrics.avg_loss || 0), sharpeRatio: parseFloat(sharpeRatio.toFixed(2)), maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)) }, dailyPerformance });
    } catch (dbError: unknown) {
      logger.warn('Autonomous trades table query failed: ' + (dbError instanceof Error ? dbError.message : String(dbError)));
      res.json({ success: true, performance: defaultPerformance, dailyPerformance: [] });
    }
  } catch (error: unknown) {
    logger.error('Error getting performance:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get performance' });
  }
});

router.get('/capabilities', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const strategies = await strategyLearningEngine.getTopPerformers();
    res.json({ success: true, capabilitySummary: { totalStrategies: strategies.length, tier1: 0, tier2: 0, tier3: 0, averageCompositeScore: 0 }, strategies: [] });
  } catch (error: unknown) {
    logger.error('Error getting capabilities:', error);
    res.json({ success: true, capabilitySummary: { totalStrategies: 0, tier1: 0, tier2: 0, tier3: 0, averageCompositeScore: 0 }, strategies: [], _fallback: true });
  }
});

router.get('/circuit-breaker', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });
    const cbStatus = fullyAutonomousTrader.getCircuitBreakerStatus(userId);
    res.json({ success: true, circuitBreaker: cbStatus });
  } catch (error: unknown) {
    logger.error('Error getting circuit breaker status:', error);
    res.json({ success: true, circuitBreaker: { isTripped: false, consecutiveLosses: 0, dailyLossPercent: 0 }, _fallback: true });
  }
});

router.get('/learnings', authenticateToken, async (_req: Request, res: Response) => {
  res.json({ success: true, learnings: [] });
});

router.put('/config', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });
    const config = req.body;
    const traderStatus = await fullyAutonomousTrader.getStatus(userId);
    if (!traderStatus.enabled) return res.status(404).json({ success: false, error: 'No active trading session found' });
    await fullyAutonomousTrader.enableAutonomousTrading(userId, config);
    res.json({ success: true, message: 'Configuration updated successfully' });
  } catch (error: unknown) {
    logger.error('Error updating config:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to update configuration' });
  }
});

router.get('/activity/live', authenticateToken, async (_req: Request, res: Response) => {
  res.json({ success: true, activities: [] });
});

router.get('/strategies/active', authenticateToken, async (_req: Request, res: Response) => {
  res.json({ success: true, strategies: [] });
});

router.get('/strategies/pending-approval', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const recommendations = await strategyLearningEngine.getLiveRecommendations();
    res.json({ success: true, strategies: recommendations });
  } catch (error: unknown) {
    logger.error('Error getting pending strategies:', error);
    res.json({ success: true, strategies: [], _fallback: true });
  }
});

router.get('/settings', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });
    const settings = await agentSettingsService.getSettings(userId);
    res.json({ success: true, settings: settings || { runMode: 'manual', autoStartOnLogin: false, continueWhenLoggedOut: false, config: {} } });
  } catch (error: unknown) {
    logger.error('Error getting agent settings:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to get agent settings' });
  }
});

router.post('/settings', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });
    const { runMode, autoStartOnLogin, continueWhenLoggedOut, config } = req.body;
    if (!['never', 'manual', 'always'].includes(runMode)) return res.status(400).json({ success: false, error: 'Invalid run mode. Must be: never, manual, or always' });
    const settings = await agentSettingsService.saveSettings(userId, { runMode, autoStartOnLogin: autoStartOnLogin || false, continueWhenLoggedOut: continueWhenLoggedOut || false, config: config || {} });
    res.json({ success: true, settings });
  } catch (error: unknown) {
    logger.error('Error saving agent settings:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to save agent settings' });
  }
});

// ─────────────────── Frontend-expected endpoints ───────────────────

/**
 * GET /api/agent/strategy/current
 * Returns the current SLE generation info and actively running strategies.
 */
router.get('/strategy/current', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const sle = strategyLearningEngine as any;
    const strategies = Array.from(sle.strategies?.values?.() ?? []);
    const running = strategies.filter((s: any) => ['paper_trading', 'live', 'recommended'].includes(s.status));
    const isRunning = sle.isRunning as boolean;

    res.json({
      success: true,
      generation: {
        id: `gen-${sle.generationCount ?? 0}`,
        strategy_name: `Generation ${sle.generationCount ?? 0}`,
        number: sle.generationCount ?? 0,
        status: isRunning ? 'analyzing' : 'completed',
        progress: isRunning ? 50 : 100,
        current_step: isRunning ? 'Evaluating strategies' : 'Idle',
        strategiesActive: running.length,
        totalStrategies: strategies.length,
        lastCycleAt: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }
    });
  } catch (error: unknown) {
    logger.error('Error fetching current generation:', error);
    res.json({ success: false, generation: null });
  }
});

/**
 * GET /api/agent/strategy/recent?limit=N
 * Returns recently created/updated strategies from DB.
 */
router.get('/strategy/recent', authenticateToken, async (req: Request, res: Response) => {
  try {
    const rawRecentLimit = parseInt(req.query.limit as string, 10);
    const limit = Math.min(Math.max(Number.isFinite(rawRecentLimit) ? rawRecentLimit : 10, 1), 50);
    const result = await pool.query(
      `SELECT strategy_id, strategy_name, symbol, timeframe, strategy_type,
              regime_at_creation, backtest_sharpe, backtest_wr, backtest_max_dd,
              paper_sharpe, paper_wr, paper_pnl, paper_trades,
              live_sharpe, live_pnl, live_trades,
              is_censored, censor_reason, status, confidence_score,
              generation, created_at, signal_genome
       FROM strategy_performance
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ success: true, strategies: result.rows });
  } catch (error: unknown) {
    if (isTableMissingError(error)) return res.json({ success: true, strategies: [] });
    logger.error('Error fetching recent strategies:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch recent strategies' });
  }
});

/**
 * GET /api/agent/backtest/results?strategy_id=X&limit=N
 * Returns backtest results, optionally filtered by strategy.
 *
 * Unit conventions for columns returned by `SELECT *` from backtest_results
 * (verified 2026-04-19 against production rows with engine_version set —
 * see the PnL units canonical form PR):
 *   - total_return        : PERCENT form (e.g. 0.0248 = 0.0248%). Engine
 *                           writes `((totalValue - initial) / initial) * 100`.
 *                           NOTE: canonical going forward is DECIMAL; new
 *                           rows from backtestingEngine.js now store decimal
 *                           form. Legacy rows with PERCENT form are fenced
 *                           off by `engine_version IS NOT NULL` plus the
 *                           pre-insert validator in backtestingEngine.js.
 *   - win_rate            : PERCENT form (e.g. 42.86 = 42.86%).
 *   - profit_factor       : RATIO (e.g. 1.55 = 1.55x gross win / gross loss).
 *   - max_drawdown        : DOLLARS (absolute drawdown amount — peak-trough).
 *   - max_drawdown_percent: PERCENT form (e.g. 5.89 = 5.89%).
 *   - sharpe_ratio        : RATIO (annualised).
 *   - initial_capital / final_value : DOLLARS.
 *
 * Frontend contract: treat `total_return` and `max_drawdown_percent` as
 * already-percent — do NOT multiply by 100. The `agent_strategies.performance`
 * JSON served by /api/backtest/pipeline/summary follows a DIFFERENT convention
 * (decimal) and must be multiplied by 100 at render. Legacy rows with percent
 * form are coerced to decimal by `normalizeAgentStrategyPerformance` on the
 * backtest-pipeline route; new canonical rows go through the pre-write
 * `validateAgentStrategyPerformance` guard in
 * `apps/api/src/services/agentStrategyPerformance.ts`.
 */
router.get('/backtest/results', authenticateToken, async (req: Request, res: Response) => {
  try {
    const strategyId = req.query.strategy_id as string;
    const rawBtLimit = parseInt(req.query.limit as string, 10);
    const limit = Math.min(Math.max(Number.isFinite(rawBtLimit) ? rawBtLimit : 10, 1), 100);
    // engine_version IS NOT NULL: drop the 1,791 legacy rows that
    // pre-date the engine_version migration (PR #496). They have
    // unit-mismatched total_return values that pollute aggregates
    // (e.g. −733% avg, −23581% worst) and are scheduled for hard
    // delete in the separate legacy-purge PR.
    let result;
    if (strategyId) {
      result = await pool.query(
        `SELECT * FROM backtest_results
          WHERE strategy_name = $1 AND engine_version IS NOT NULL
          ORDER BY created_at DESC LIMIT $2`,
        [strategyId, limit],
      );
    } else {
      result = await pool.query(
        `SELECT * FROM backtest_results
          WHERE engine_version IS NOT NULL
          ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
    }
    res.json({ success: true, results: result.rows });
  } catch (error: unknown) {
    if (isTableMissingError(error)) return res.json({ success: true, results: [] });
    logger.error('Error fetching backtest results:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch backtest results' });
  }
});

/**
 * GET /api/agent/state-of-bot
 *
 * Single-payload "what is the bot doing right now?" view used by the
 * new State-of-the-Bot card. Aggregates real-time posture (phase,
 * execution mode, last tick), P&L for 24h/7d/30d/all-time, activity
 * stats (trades/hr, recent win rate), exchange vs DB position count
 * (divergence = phantom state — the class of bug we caught on
 * 2026-04-18 where 6 DB rows stayed "open" while the exchange showed
 * zero positions), balance, and current leverage.
 *
 * Phase precedence (priority order — first match wins):
 *   1. paused       → execution_mode = 'pause'
 *   2. degraded     → Poloniex unreachable OR no tick in > 5 min
 *   3. skipping     → last tick produced a signal, no order placed
 *   4. trading      → a trade opened within the last tick interval
 *   5. evaluating   → tick fired, no qualifying signal
 */
router.get('/state-of-bot', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) return res.status(401).json({ success: false, error: 'User ID not found in token' });

    // Execution mode (cached in executionModeService, so this is cheap).
    const modeRecord = await getExecutionModeRecord();
    const executionMode = modeRecord?.mode ?? 'auto';

    // P&L buckets from autonomous_trades. Closed + pnl IS NOT NULL.
    // Both live_signal|% AND monkey|% rows count — the dashboard is the
    // whole bot, not just one engine. Legacy/paper rows stay excluded.
    const pnlResult = await pool.query(
      `SELECT
         COALESCE(SUM(pnl) FILTER (WHERE exit_time > NOW() - INTERVAL '24 hours'), 0) AS pnl_24h,
         COUNT(*)          FILTER (WHERE exit_time > NOW() - INTERVAL '24 hours')      AS trades_24h,
         COALESCE(SUM(pnl) FILTER (WHERE exit_time > NOW() - INTERVAL '7 days'), 0)    AS pnl_7d,
         COUNT(*)          FILTER (WHERE exit_time > NOW() - INTERVAL '7 days')        AS trades_7d,
         COALESCE(SUM(pnl) FILTER (WHERE exit_time > NOW() - INTERVAL '30 days'), 0)   AS pnl_30d,
         COUNT(*)          FILTER (WHERE exit_time > NOW() - INTERVAL '30 days')       AS trades_30d,
         COALESCE(SUM(pnl), 0) AS pnl_all,
         COUNT(*)               AS trades_all
       FROM autonomous_trades
       WHERE status = 'closed' AND pnl IS NOT NULL
         AND (reason LIKE 'live_signal|%' OR reason LIKE 'monkey|%')
         AND user_id = $1`,
      [userId],
    );
    const pnl = pnlResult.rows[0] as Record<string, string>;

    // Win rate over last 20 closed trades (both engines).
    const lastTradesResult = await pool.query(
      `SELECT pnl FROM autonomous_trades
        WHERE status = 'closed' AND pnl IS NOT NULL
          AND (reason LIKE 'live_signal|%' OR reason LIKE 'monkey|%')
          AND user_id = $1
        ORDER BY exit_time DESC LIMIT 20`,
      [userId],
    );
    const lastTrades = lastTradesResult.rows as Array<{ pnl: string }>;
    const winRateLast20 =
      lastTrades.length === 0
        ? 0
        : lastTrades.filter((r) => Number(r.pnl) > 0).length / lastTrades.length;

    // Open-trade counts: exchange-authoritative vs DB-authoritative.
    // Divergence = phantom state — should alarm.
    // Count BOTH live_signal AND monkey trades — otherwise the divergence
    // alert false-triggers as soon as Monkey opens a position (2026-04-20
    // 10:31 UTC was the first, and state-of-bot immediately flagged as
    // out-of-sync because Monkey's row wasn't in the count).
    const dbOpenResult = await pool.query(
      `SELECT COUNT(*) AS n FROM autonomous_trades
        WHERE status = 'open'
          AND (reason LIKE 'live_signal|%' OR reason LIKE 'monkey|%')
          AND user_id = $1
          AND deleted_at IS NULL`,
      [userId],
    );
    const dbOpenPositions = parseInt((dbOpenResult.rows[0] as { n: string }).n, 10) || 0;

    let exchangeOpenPositions = 0;
    let balance = { equity: 0, currency: 'USDT' as const };
    let currentLeverage = 0;
    let poloniexReachable = true;
    try {
      const credentials = await apiCredentialsService.getCredentials(userId, 'poloniex');
      if (credentials) {
        const [positions, bal] = await Promise.all([
          poloniexFuturesService.getPositions(credentials),
          poloniexFuturesService.getAccountBalance(credentials),
        ]);
        const positionsList = Array.isArray(positions) ? positions : [];
        exchangeOpenPositions = positionsList.filter((p: Record<string, unknown>) => {
          const qty = Math.abs(Number(p.qty ?? p.size ?? p.positionAmt ?? 0));
          return qty > 0;
        }).length;
        // Derive leverage from the largest open position; 0 when flat.
        currentLeverage = positionsList.reduce(
          (max: number, p: Record<string, unknown>) => Math.max(max, Number(p.leverage ?? 0)),
          0,
        );
        balance = {
          equity: Number(bal?.totalBalance ?? bal?.eq ?? 0),
          currency: 'USDT',
        };
      }
    } catch (err) {
      poloniexReachable = false;
      logger.warn('[state-of-bot] Poloniex unreachable', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Last tick + phase derivation from strategyLearningEngine +
    // monitoringService heartbeat. We treat > 5 min silence as degraded.
    const engineStatus = await strategyLearningEngine.getEngineStatus().catch(() => null);
    const lastTickAt = (engineStatus as { lastActivityAt?: string } | null)?.lastActivityAt ?? null;
    const lastTickAgeMs = lastTickAt ? Date.now() - new Date(lastTickAt).getTime() : null;
    const stale = lastTickAgeMs !== null && lastTickAgeMs > 5 * 60_000;

    // Trades placed in the last tick interval (~60s). If > 0, phase = trading.
    // Both engines count.
    const recentOpenResult = await pool.query(
      `SELECT COUNT(*) AS n FROM autonomous_trades
        WHERE (reason LIKE 'live_signal|%' OR reason LIKE 'monkey|%') AND user_id = $1
          AND (entry_time > NOW() - INTERVAL '90 seconds' OR created_at > NOW() - INTERVAL '90 seconds')`,
      [userId],
    );
    const recentlyOpened = parseInt((recentOpenResult.rows[0] as { n: string }).n, 10) || 0;

    let phase: 'paused' | 'degraded' | 'skipping' | 'trading' | 'evaluating';
    let phaseReason: string;
    if (executionMode === 'pause') {
      phase = 'paused';
      phaseReason = modeRecord?.reason || 'Execution mode set to pause';
    } else if (!poloniexReachable || stale) {
      phase = 'degraded';
      phaseReason = !poloniexReachable
        ? 'Poloniex exchange unreachable'
        : `Last tick ${Math.round((lastTickAgeMs ?? 0) / 60_000)} min ago — expected every minute`;
    } else if (recentlyOpened > 0) {
      phase = 'trading';
      phaseReason = `${recentlyOpened} order${recentlyOpened === 1 ? '' : 's'} placed in last 90s`;
    } else if (dbOpenPositions > 0) {
      phase = 'skipping';
      phaseReason = `${dbOpenPositions} open position${dbOpenPositions === 1 ? '' : 's'} (live-signal + monkey) — stacking guard blocks new entries until they close`;
    } else {
      phase = 'evaluating';
      phaseReason = 'No qualifying signal this tick — watching';
    }

    // Trades/hr = closed + opened in last 24h, normalized.
    const tradesPerHour = Number(pnl.trades_24h) / 24;

    res.json({
      success: true,
      phase,
      phaseReason,
      executionMode,
      lastTickAt,
      pnl: {
        '24h': { realized: Number(pnl.pnl_24h), trades: parseInt(pnl.trades_24h, 10) || 0 },
        '7d':  { realized: Number(pnl.pnl_7d),  trades: parseInt(pnl.trades_7d, 10)  || 0 },
        '30d': { realized: Number(pnl.pnl_30d), trades: parseInt(pnl.trades_30d, 10) || 0 },
        all:   { realized: Number(pnl.pnl_all), trades: parseInt(pnl.trades_all, 10) || 0 },
      },
      tradesPerHour,
      winRateLast20,
      exchangeOpenPositions,
      dbOpenPositions,
      positionStateInSync: exchangeOpenPositions === dbOpenPositions,
      balance,
      currentLeverage,
    });
  } catch (error: unknown) {
    logger.error('Error building state-of-bot:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to build state-of-bot',
    });
  }
});

/**
 * GET /api/agent/execution-mode
 * Returns the current global execution mode + metadata.
 */
router.get('/execution-mode', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const record = await getExecutionModeRecord();
    if (!record) {
      return res.status(500).json({ success: false, error: 'Execution mode singleton missing' });
    }
    return res.json({
      success: true,
      mode: record.mode,
      updatedAt: record.updatedAt.toISOString(),
      updatedBy: record.updatedBy,
      reason: record.reason,
    });
  } catch (error: unknown) {
    logger.error('Error reading execution mode:', error);
    return res.status(500).json({ success: false, error: 'Failed to read execution mode' });
  }
});

/**
 * PUT /api/agent/execution-mode
 * Update the global execution mode. Body: { mode, reason? }
 * mode ∈ { 'auto', 'paper_only', 'pause' }.
 */
router.put('/execution-mode', authenticateToken, async (req: Request, res: Response) => {
  const { mode, reason } = (req.body ?? {}) as { mode?: string; reason?: string };
  if (mode !== 'auto' && mode !== 'paper_only' && mode !== 'pause') {
    return res.status(400).json({
      success: false,
      error: `mode must be one of: auto, paper_only, pause`,
    });
  }
  const operator = (req.user?.email || req.user?.id || req.user?.userId || 'unknown').toString();
  try {
    const record = await setExecutionMode(mode as ExecutionMode, operator, reason ?? null);
    return res.json({
      success: true,
      mode: record.mode,
      updatedAt: record.updatedAt.toISOString(),
      updatedBy: record.updatedBy,
      reason: record.reason,
    });
  } catch (error: unknown) {
    logger.error('Error updating execution mode:', error);
    return res.status(500).json({ success: false, error: 'Failed to update execution mode' });
  }
});

export default router;
