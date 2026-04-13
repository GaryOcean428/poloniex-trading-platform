import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { strategyLearningEngine } from '../services/strategyLearningEngine.js';
import { fullyAutonomousTrader } from '../services/fullyAutonomousTrader.js';
import { agentSettingsService } from '../services/agentSettingsService.js';
import type { Request, Response } from 'express';
import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/** Check if an error is caused by a missing database table/relation */
function isTableMissingError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('does not exist') || msg.includes('relation');
}

/**
 * POST /api/agent/start
 * Start the autonomous trading agent via SLE + fullyAutonomousTrader
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

    await strategyLearningEngine.start();
    await fullyAutonomousTrader.enableAutonomousTrading(userId, { paperTrading: true });

    res.json({
      success: true,
      message: 'Agent started successfully'
    });
  } catch (error: unknown) {
    logger.error('Error starting agent:', error);
    const errMsg = error instanceof Error ? error.message : String(error);

    if (errMsg.includes('already running') || errMsg.includes('Already running')) {
      return res.status(409).json({
        success: false,
        error: 'Agent is already running',
        code: 'ALREADY_RUNNING'
      });
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

/**
 * POST /api/agent/stop
 * Stop the autonomous trading agent via SLE + fullyAutonomousTrader
 */
router.post('/stop', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    await strategyLearningEngine.stop();
    await fullyAutonomousTrader.disableAutonomousTrading(userId);

    res.json({
      success: true,
      message: 'Agent stopped successfully'
    });
  } catch (error: unknown) {
    logger.error('Error stopping agent:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop agent'
    });
  }
});

/**
 * POST /api/agent/pause
 * Pause the autonomous trading agent (SLE has no pause, stop is equivalent)
 */
router.post('/pause', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    await strategyLearningEngine.stop();

    res.json({
      success: true,
      message: 'Agent paused successfully'
    });
  } catch (error: unknown) {
    logger.error('Error pausing agent:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to pause agent'
    });
  }
});

/**
 * POST /api/agent/resume
 * Resume the autonomous trading agent via SLE start
 */
router.post('/resume', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    await strategyLearningEngine.start();

    res.json({
      success: true,
      message: 'Agent resumed successfully'
    });
  } catch (error: unknown) {
    logger.error('Error resuming agent:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resume agent'
    });
  }
});

/**
 * GET /api/agent/status
 * Get current agent status (composite from SLE + fullyAutonomousTrader)
 */
router.get('/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    const engineStatus = await strategyLearningEngine.getEngineStatus();
    const traderStatus = await fullyAutonomousTrader.getStatus(userId);

    res.json({
      success: true,
      status: {
        engine: engineStatus,
        trader: traderStatus
      }
    });
  } catch (error: unknown) {
    logger.error('Error getting agent status:', error);
    res.json({
      success: true,
      status: null,
      _fallback: true
    });
  }
});

/**
 * GET /api/agent/health
 * Get agent service health with dependency statuses
 */
router.get('/health', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    // Check database connectivity
    let dbHealthy = false;
    try {
      await pool.query('SELECT 1');
      dbHealthy = true;
    } catch {
      // DB is down
    }

    // Check SLE status
    const engineStatus = await strategyLearningEngine.getEngineStatus();
    const sleHealthy = engineStatus != null;

    // Check fullyAutonomousTrader status
    let traderStatus = null;
    try {
      traderStatus = await fullyAutonomousTrader.getStatus(userId);
    } catch {
      // Trader status unavailable
    }

    const allHealthy = dbHealthy && sleHealthy;

    res.json({
      success: true,
      healthy: allHealthy,
      dependencies: {
        database: { healthy: dbHealthy, message: dbHealthy ? 'Connected' : 'Connection failed' },
        strategyLearningEngine: { healthy: sleHealthy, isRunning: engineStatus?.isRunning ?? false, message: sleHealthy ? 'Available' : 'Unavailable' },
        fullyAutonomousTrader: traderStatus ? {
          healthy: true,
          enabled: traderStatus.enabled,
          isRunning: traderStatus.isRunning,
          paperTrading: traderStatus.paperTrading
        } : { healthy: false, message: 'Unavailable' }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: unknown) {
    logger.error('Error checking agent health:', error);
    res.status(503).json({
      success: false,
      error: 'Health check failed',
      code: 'HEALTH_CHECK_FAILED',
      dependencies: {
        database: { healthy: false, message: 'Unknown' },
        strategyLearningEngine: { healthy: false, message: 'Unknown' },
        fullyAutonomousTrader: { healthy: false, message: 'Unknown' }
      },
      retryable: true,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/agent/activity
 * Get agent activity log (can stay empty until audit logging is wired)
 */
router.get('/activity', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    res.json({
      success: true,
      activity: []
    });
  } catch (error: unknown) {
    logger.error('Error getting activity:', error);
    res.json({
      success: true,
      activity: [],
      _fallback: true
    });
  }
});

/**
 * GET /api/agent/events
 * Get agent events/audit trail with filters
 */
router.get('/events', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    const limit = parseInt(req.query.limit as string, 10) || 50;
    const eventType = req.query.type as string | undefined;
    const mode = req.query.mode as string | undefined;

    let queryText = `SELECT * FROM agent_events WHERE user_id = $1`;
    const params: (string | number)[] = [userId];

    if (eventType) {
      params.push(eventType);
      queryText += ` AND event_type = $${params.length}`;
    }
    if (mode) {
      params.push(mode);
      queryText += ` AND execution_mode = $${params.length}`;
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(queryText, params);

    res.json({
      success: true,
      events: result.rows
    });
  } catch (error: unknown) {
    // Return empty array if table doesn't exist yet
    if (isTableMissingError(error)) {
      res.json({
        success: true,
        events: []
      });
    } else {
      logger.error('Agent events query failed:', error instanceof Error ? error.message : String(error));
      res.json({
        success: true,
        events: [],
        _fallback: true
      });
    }
  }
});

/**
 * GET /api/agent/strategies
 * Get top performing strategies from SLE
 */
router.get('/strategies', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    const strategies = await strategyLearningEngine.getTopPerformers();

    res.json({
      success: true,
      strategies
    });
  } catch (error: unknown) {
    logger.error('Error getting strategies:', error);
    res.json({
      success: true,
      strategies: [],
      _fallback: true
    });
  }
});

/**
 * GET /api/agent/performance
 * Get performance metrics from autonomous_trades + autonomous_performance
 */
router.get('/performance', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    const defaultPerformance = {
      totalPnl: 0,
      winRate: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      averageWin: 0,
      averageLoss: 0,
      sharpeRatio: 0,
      maxDrawdown: 0
    };

    try {
      const mode = req.query.mode as string | undefined;
      const modeFilter = mode ? ' AND execution_mode = $2' : '';
      const queryParams: string[] = [userId];
      if (mode) queryParams.push(mode);

      const tradesResult = await pool.query(
        `SELECT 
          COUNT(*) as total_trades,
          SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
          SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing_trades,
          SUM(pnl) as total_pnl,
          AVG(CASE WHEN pnl > 0 THEN pnl END) as avg_win,
          AVG(CASE WHEN pnl < 0 THEN pnl END) as avg_loss
        FROM autonomous_trades 
        WHERE user_id = $1${modeFilter}`,
        queryParams
      );

      const metrics = tradesResult.rows[0];

      let sharpeRatio = 0;
      let maxDrawdown = 0;

      try {
        const returnsResult = await pool.query(
          `SELECT pnl FROM autonomous_trades 
           WHERE user_id = $1 AND pnl IS NOT NULL${modeFilter}
           ORDER BY created_at ASC`,
          queryParams
        );

        const pnls = returnsResult.rows.map((r: { pnl: string }) => parseFloat(r.pnl));
        if (pnls.length > 1) {
          const mean = pnls.reduce((a: number, b: number) => a + b, 0) / pnls.length;
          const variance = pnls.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / (pnls.length - 1);
          const stdDev = Math.sqrt(variance);
          const TRADING_DAYS_PER_YEAR = 252;
          sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;

          let peak = 0;
          let cumPnl = 0;
          for (const pnl of pnls) {
            cumPnl += pnl;
            if (cumPnl > peak) peak = cumPnl;
            const drawdown = peak > 0 ? (peak - cumPnl) / peak : 0;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
          }
        }
      } catch {
        // Keep defaults of 0 if calculation fails
      }

      let dailyPerformance: Array<{ date: string; pnl: number; cumulativePnL: number; trades: number }> = [];
      try {
        const dailyResult = await pool.query(
          `SELECT
             DATE(created_at) as trade_date,
             SUM(pnl) as daily_pnl,
             COUNT(*) as daily_trades
           FROM autonomous_trades
           WHERE user_id = $1 AND pnl IS NOT NULL${modeFilter}
           GROUP BY DATE(created_at)
           ORDER BY trade_date ASC`,
          queryParams
        );
        let cumPnl = 0;
        dailyPerformance = dailyResult.rows.map((r: { trade_date: string; daily_pnl: string; daily_trades: string }) => {
          const dayPnl = parseFloat(r.daily_pnl) || 0;
          cumPnl += dayPnl;
          return {
            date: new Date(r.trade_date).toISOString().slice(0, 10),
            pnl: parseFloat(dayPnl.toFixed(2)),
            cumulativePnL: parseFloat(cumPnl.toFixed(2)),
            trades: parseInt(r.daily_trades, 10) || 0
          };
        });
      } catch {
        // Daily breakdown unavailable
      }

      res.json({
        success: true,
        mode: mode || 'all',
        performance: {
          totalPnl: parseFloat(metrics.total_pnl || 0),
          winRate: metrics.total_trades > 0
            ? (parseFloat(metrics.winning_trades || 0) / parseFloat(metrics.total_trades)) * 100
            : 0,
          totalTrades: parseInt(metrics.total_trades || 0, 10),
          winningTrades: parseInt(metrics.winning_trades || 0, 10),
          losingTrades: parseInt(metrics.losing_trades || 0, 10),
          averageWin: parseFloat(metrics.avg_win || 0),
          averageLoss: parseFloat(metrics.avg_loss || 0),
          sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
          maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2))
        },
        dailyPerformance
      });
    } catch (dbError: unknown) {
      logger.warn('autonomous_trades table query failed, returning default performance: ' + (dbError instanceof Error ? dbError.message : String(dbError)));
      res.json({
        success: true,
        performance: defaultPerformance,
        dailyPerformance: []
      });
    }
  } catch (error: unknown) {
    logger.error('Error getting performance:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get performance'
    });
  }
});

/**
 * GET /api/agent/capabilities
 * Get composite capability profile from SLE strategy data
 */
router.get('/capabilities', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    const strategies = await strategyLearningEngine.getTopPerformers();
    const summary = {
      totalStrategies: strategies.length,
      backtesting: strategies.filter(s => s.status === 'backtesting').length,
      paperTrading: strategies.filter(s => s.status === 'paper_trading').length,
      recommended: strategies.filter(s => s.status === 'recommended').length,
      live: strategies.filter(s => s.status === 'live').length
    };

    res.json({
      success: true,
      capabilitySummary: summary,
      strategies
    });
  } catch (error: unknown) {
    logger.error('Error getting agent capability profiles:', error);
    res.json({
      success: true,
      capabilitySummary: {
        totalStrategies: 0,
        backtesting: 0,
        paperTrading: 0,
        recommended: 0,
        live: 0
      },
      strategies: [],
      _fallback: true
    });
  }
});

/**
 * GET /api/agent/circuit-breaker
 * Get the circuit breaker status from fullyAutonomousTrader
 */
router.get('/circuit-breaker', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found in token' });
    }

    const cbStatus = fullyAutonomousTrader.getCircuitBreakerStatus(userId);
    res.json({ success: true, circuitBreaker: cbStatus });
  } catch (error: unknown) {
    logger.error('Error getting circuit breaker status:', error);
    res.json({
      success: true,
      circuitBreaker: {
        isTripped: false,
        consecutiveLosses: 0,
        dailyLossPercent: 0
      },
      _fallback: true
    });
  }
});

/**
 * GET /api/agent/learnings
 * Get AI learnings
 */
router.get('/learnings', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    res.json({
      success: true,
      learnings: []
    });
  } catch (error: unknown) {
    logger.error('Error getting learnings:', error);
    res.json({
      success: true,
      learnings: [],
      _fallback: true
    });
  }
});

/**
 * PUT /api/agent/config
 * Update agent configuration
 */
router.put('/config', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    const config = req.body;

    // Update config in autonomous_trading_configs table
    try {
      await pool.query(
        `UPDATE autonomous_trading_configs SET
          max_drawdown = COALESCE($2, max_drawdown),
          max_risk_per_trade = COALESCE($3, max_risk_per_trade),
          updated_at = NOW()
        WHERE user_id = $1`,
        [userId, config.maxDrawdown, config.maxRiskPerTrade]
      );
    } catch {
      // DB update is best-effort
    }

    res.json({
      success: true,
      message: 'Configuration updated successfully'
    });
  } catch (error: unknown) {
    logger.error('Error updating config:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update configuration'
    });
  }
});

/**
 * GET /api/agent/activity/live
 * Get live activity feed (real-time updates)
 */
router.get('/activity/live', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    // Return empty array for now - will be populated when agent is running
    res.json({
      success: true,
      activities: []
    });
  } catch (error: unknown) {
    logger.error('Error getting live activity:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /api/agent/strategies/active
 * Get currently active trading strategies
 */
router.get('/strategies/active', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    // Return empty array for now
    res.json({
      success: true,
      strategies: []
    });
  } catch (error: unknown) {
    logger.error('Error getting active strategies:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /api/agent/strategies/pending-approval
 * Get strategies recommended for live trading (pending user approval)
 */
router.get('/strategies/pending-approval', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    const strategies = await strategyLearningEngine.getLiveRecommendations();

    res.json({
      success: true,
      strategies
    });
  } catch (error: unknown) {
    logger.error('Error getting pending strategies:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/agent/strategy/:id/approve
 * Approve a recommended strategy for live trading.
 * Calls SLE confirmLivePromotion then starts fullyAutonomousTrader in live mode.
 */
router.post('/strategy/:id/approve', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    const strategyId = req.params.id;

    // Confirm live promotion in SLE (validates strategy is in 'recommended' status)
    const strategy = await strategyLearningEngine.confirmLivePromotion(strategyId);

    // Enable live trading via fullyAutonomousTrader with strategy parameters
    await fullyAutonomousTrader.enableAutonomousTrading(userId, {
      paperTrading: false,
      symbols: [strategy.symbol],
      leverage: strategy.leverage
    });

    res.json({
      success: true,
      strategy: { ...strategy, status: 'live' as const }
    });
  } catch (error: unknown) {
    logger.error('Error approving strategy:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/agent/strategy/:id/reject
 * Reject a recommended strategy by marking it as retired
 */
router.post('/strategy/:id/reject', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    const strategyId = req.params.id;

    const result = await pool.query(
      `UPDATE strategy_performance SET status = 'retired' WHERE strategy_id = $1 AND status = 'recommended'`,
      [strategyId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Strategy not found or not in recommended status'
      });
    }

    res.json({
      success: true,
      message: 'Strategy rejected'
    });
  } catch (error: unknown) {
    logger.error('Error rejecting strategy:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /api/agent/settings
 * Get agent settings for the user
 */
router.get('/settings', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    const settings = await agentSettingsService.getSettings(userId);

    res.json({
      success: true,
      settings: settings || {
        runMode: 'manual',
        autoStartOnLogin: false,
        continueWhenLoggedOut: false,
        config: {}
      }
    });
  } catch (error: unknown) {
    logger.error('Error getting agent settings:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get agent settings'
    });
  }
});

/**
 * POST /api/agent/settings
 * Save agent settings
 */
router.post('/settings', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    const { runMode, autoStartOnLogin, continueWhenLoggedOut, config } = req.body;

    // Validate run mode
    if (!['never', 'manual', 'always'].includes(runMode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid run mode. Must be: never, manual, or always'
      });
    }

    const settings = await agentSettingsService.saveSettings(userId, {
      runMode,
      autoStartOnLogin: autoStartOnLogin || false,
      continueWhenLoggedOut: continueWhenLoggedOut || false,
      config: config || {}
    });

    res.json({
      success: true,
      settings
    });
  } catch (error: unknown) {
    logger.error('Error saving agent settings:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save agent settings'
    });
  }
});

export default router;
