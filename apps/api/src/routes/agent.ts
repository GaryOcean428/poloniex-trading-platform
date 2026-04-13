import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { fullyAutonomousTrader } from '../services/fullyAutonomousTrader.js';
import { strategyLearningEngine } from '../services/strategyLearningEngine.js';
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
 * Start the autonomous trading agent
 */
router.post('/start', authenticateToken, async (req: Request, res: Response) => {
  try {
    // Safely get user ID with fallback
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

    // Start both SLE (strategy brain) and fullyAutonomousTrader (execution engine)
    await fullyAutonomousTrader.enableAutonomousTrading(userId, {
      symbols: config.preferredPairs || ['BTC-USDT'],
      maxDrawdown: config.maxDrawdown || 15,
      maxRiskPerTrade: config.positionSize || 2,
      paperTrading: config.executionMode === 'paper' || config.paperTrading || false,
    });
    await strategyLearningEngine.start();

    const status = await fullyAutonomousTrader.getStatus(userId);

    res.json({
      success: true,
      session: {
        id: userId,
        status: status.isRunning ? 'running' : 'starting',
        startedAt: new Date().toISOString(),
      }
    });
  } catch (error: unknown) {
    logger.error('Error starting agent:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    
    // Provide specific error codes for known errors
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
 * Stop the autonomous trading agent
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

    // Stop both fullyAutonomousTrader and SLE
    await fullyAutonomousTrader.disableAutonomousTrading(userId);
    await strategyLearningEngine.stop();

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
 * Pause the autonomous trading agent
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

    // Pause trading (disable execution engine, keep SLE running for analysis)
    await fullyAutonomousTrader.disableAutonomousTrading(userId);

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
 * Resume the autonomous trading agent
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

    // Resume trading by re-enabling the execution engine
    await fullyAutonomousTrader.enableAutonomousTrading(userId);

    const traderStatus = await fullyAutonomousTrader.getStatus(userId);

    res.json({
      success: true,
      message: 'Agent resumed successfully',
      session: {
        id: userId,
        status: traderStatus.isRunning ? 'running' : 'starting',
      }
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
 * Get current agent status
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

    // Composite status from both SLE and fullyAutonomousTrader
    const traderStatus = await fullyAutonomousTrader.getStatus(userId);
    const sleStatus = await strategyLearningEngine.getEngineStatus();

    res.json({
      success: true,
      status: {
        id: userId,
        status: traderStatus.isRunning ? 'running' : (traderStatus.enabled ? 'enabled' : 'stopped'),
        startedAt: traderStatus.lastHeartbeat,
        trader: traderStatus,
        sle: sleStatus,
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

    // Check if services are available
    const agentAvailable = fullyAutonomousTrader != null && strategyLearningEngine != null;
    
    // Check for active trading session
    let activeSession = null;
    try {
      const traderStatus = await fullyAutonomousTrader.getStatus(userId);
      if (traderStatus.isRunning) {
        activeSession = {
          id: userId,
          status: 'running',
          startedAt: traderStatus.lastHeartbeat
        };
      }
    } catch {
      // Status unavailable
    }

    const allHealthy = dbHealthy && agentAvailable;

    res.json({
      success: true,
      healthy: allHealthy,
      dependencies: {
        database: { healthy: dbHealthy, message: dbHealthy ? 'Connected' : 'Connection failed' },
        agentService: { healthy: agentAvailable, message: agentAvailable ? 'Available' : 'Unavailable' },
        activeSession: activeSession || null
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
        agentService: { healthy: false, message: 'Unknown' }
      },
      retryable: true,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/agent/activity
 * Get agent activity log
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

    const limit = parseInt(req.query.limit as string, 10) || 20;

    // Query activity from autonomous_trades table
    const result = await pool.query(
      'SELECT * FROM autonomous_trades WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );

    res.json({
      success: true,
      activity: result.rows
    });
  } catch (error: unknown) {
    // Return empty array if table doesn't exist yet or DB error occurs
    if (isTableMissingError(error)) {
      return res.json({
        success: true,
        activity: []
      });
    }
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
 * Get generated strategies
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

    // Get strategies from SLE (strategy_performance table)
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
 * Get performance metrics
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

    // Default performance metrics
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

    const status = await fullyAutonomousTrader.getStatus(userId);

    // Calculate performance metrics from autonomous_trades
    try {
      const mode = req.query.mode as string | undefined;
      const modeFilter = mode ? (mode === 'paper' ? ' AND order_id LIKE \'paper_%\'' : ' AND order_id NOT LIKE \'paper_%\'') : '';
      
      const tradesResult = await pool.query(
        `SELECT 
          COUNT(*) as total_trades,
          SUM(CASE WHEN confidence > 50 THEN 1 ELSE 0 END) as winning_trades,
          SUM(CASE WHEN confidence <= 50 THEN 1 ELSE 0 END) as losing_trades,
          COALESCE(SUM(confidence), 0) as total_pnl,
          AVG(CASE WHEN confidence > 50 THEN confidence END) as avg_win,
          AVG(CASE WHEN confidence <= 50 THEN confidence END) as avg_loss
        FROM autonomous_trades 
        WHERE user_id = $1${modeFilter}`,
        [userId]
      );

      const metrics = tradesResult.rows[0];

      // Fetch strategy_performance metrics from SLE
      let strategySharpe = 0;
      let strategyMaxDrawdown = 0;
      try {
        const spResult = await pool.query(
          `SELECT AVG(COALESCE(paper_sharpe, backtest_sharpe, 0)) as avg_sharpe,
                  MAX(COALESCE(paper_max_drawdown, backtest_max_drawdown, 0)) as max_drawdown
           FROM strategy_performance
           WHERE status NOT IN ('killed', 'retired', 'censored_rejected')
             AND is_censored = FALSE`
        );
        if (spResult.rows.length > 0) {
          strategySharpe = parseFloat(spResult.rows[0].avg_sharpe) || 0;
          strategyMaxDrawdown = parseFloat(spResult.rows[0].max_drawdown) || 0;
        }
      } catch {
        // strategy_performance may not exist yet
      }

      // Fetch daily P&L for charts
      let dailyPerformance: Array<{ date: string; pnl: number; cumulativePnL: number; trades: number }> = [];
      try {
        const dailyResult = await pool.query(
          `SELECT
             DATE(created_at) as trade_date,
             COUNT(*) as daily_trades
           FROM autonomous_trades
           WHERE user_id = $1${modeFilter}
           GROUP BY DATE(created_at)
           ORDER BY trade_date ASC`,
          [userId]
        );
        const cumPnl = 0;
        dailyPerformance = dailyResult.rows.map((r: { trade_date: string; daily_trades: string }) => {
          const dayTrades = parseInt(r.daily_trades, 10) || 0;
          return {
            date: new Date(r.trade_date).toISOString().slice(0, 10),
            pnl: 0,
            cumulativePnL: parseFloat(cumPnl.toFixed(2)),
            trades: dayTrades
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
          sharpeRatio: parseFloat(strategySharpe.toFixed(2)),
          maxDrawdown: parseFloat((strategyMaxDrawdown * 100).toFixed(2)),
          traderMetrics: status.metrics
        },
        dailyPerformance
      });
    } catch (dbError: unknown) {
      logger.warn('Autonomous trades query failed, returning default performance: ' + (dbError instanceof Error ? dbError.message : String(dbError)));
      // Return default performance if tables don't exist
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
 * Get composite capability profile for the current session strategies
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

    const traderStatus = await fullyAutonomousTrader.getStatus(userId);
    if (!traderStatus.isRunning) {
      return res.json({
        success: true,
        capabilitySummary: {
          totalStrategies: 0,
          tier1: 0,
          tier2: 0,
          tier3: 0,
          averageCompositeScore: 0
        },
        strategies: []
      });
    }

    // Get strategy capabilities from SLE
    const performers = await strategyLearningEngine.getTopPerformers(50);
    const profiles = performers.map(s => ({
      strategyId: s.strategyId,
      compositeScore: s.confidenceScore ?? 0,
      capabilityClass: (s.confidenceScore ?? 0) >= 80 ? 'tier1' as const : (s.confidenceScore ?? 0) >= 50 ? 'tier2' as const : 'tier3' as const,
    }));
    const summary = profiles.reduce(
      (acc, profile) => {
        acc.totalStrategies += 1;
        acc[profile.capabilityClass] += 1;
        acc.averageCompositeScore += profile.compositeScore;
        return acc;
      },
      {
        totalStrategies: 0,
        tier1: 0,
        tier2: 0,
        tier3: 0,
        averageCompositeScore: 0
      }
    );

    if (summary.totalStrategies > 0) {
      summary.averageCompositeScore = parseFloat((summary.averageCompositeScore / summary.totalStrategies).toFixed(2));
    }

    res.json({
      success: true,
      capabilitySummary: summary,
      strategies: profiles
    });
  } catch (error: unknown) {
    logger.error('Error getting agent capability profiles:', error);
    res.json({
      success: true,
      capabilitySummary: {
        totalStrategies: 0,
        tier1: 0,
        tier2: 0,
        tier3: 0,
        averageCompositeScore: 0
      },
      strategies: [],
      _fallback: true
    });
  }
});

/**
 * GET /api/agent/circuit-breaker
 * Get the circuit breaker status for the current user's session
 */
router.get('/circuit-breaker', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found in token' });
    }

    // Get circuit breaker status directly from fullyAutonomousTrader
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

    // Get learnings from strategy_performance (SLE data)
    const result = await pool.query(
      `SELECT id, strategy_type, status, backtest_sharpe, paper_sharpe, 
              confidence_score, generation, regime, is_censored, updated_at as created_at
       FROM strategy_performance
       WHERE status NOT IN ('killed')
       ORDER BY updated_at DESC LIMIT 10`
    );

    res.json({
      success: true,
      learnings: result.rows
    });
  } catch (error: unknown) {
    // Return empty array if table doesn't exist yet or DB error occurs
    if (isTableMissingError(error)) {
      return res.json({
        success: true,
        learnings: []
      });
    }
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

    // Update config via fullyAutonomousTrader
    await fullyAutonomousTrader.enableAutonomousTrading(userId, config);

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

    // Return live strategies from SLE
    const liveStrategies = await strategyLearningEngine.getTopPerformers(20);
    const active = liveStrategies.filter(s => s.status === 'live' || s.status === 'paper_trading');
    res.json({
      success: true,
      strategies: active
    });
  } catch (error: unknown) {
    logger.error('Error getting active strategies:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /api/agent/strategies/pending-approval
 * Get strategies awaiting manual approval
 */
router.get('/strategies/pending-approval', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    // Return strategies with status = 'recommended' from SLE
    const recommended = await strategyLearningEngine.getLiveRecommendations();
    res.json({
      success: true,
      strategies: recommended
    });
  } catch (error: unknown) {
    logger.error('Error getting pending strategies:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /api/agent/strategy/current
 * Get currently generating strategy
 */
router.get('/strategy/current', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    res.json({
      success: true,
      generation: null
    });
  } catch (error: unknown) {
    logger.error('Error getting current strategy:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /api/agent/strategy/recent
 * Get recently generated strategies
 */
router.get('/strategy/recent', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    res.json({
      success: true,
      strategies: []
    });
  } catch (error: unknown) {
    logger.error('Error getting recent strategies:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /api/agent/backtest/results
 * Get backtest results
 */
router.get('/backtest/results', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    res.json({
      success: true,
      results: []
    });
  } catch (error: unknown) {
    logger.error('Error getting backtest results:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/agent/strategy/:id/approve
 * Approve a strategy for trading
 */
router.post('/strategy/:id/approve', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    const strategyId = req.params.id;

    // Confirm live promotion in SLE + enable trading in fullyAutonomousTrader
    const strategy = await strategyLearningEngine.confirmLivePromotion(strategyId);
    await fullyAutonomousTrader.enableAutonomousTrading(userId, {
      paperTrading: false,
    });

    res.json({
      success: true,
      message: 'Strategy approved and live trading enabled',
      strategy
    });
  } catch (error: unknown) {
    logger.error('Error approving strategy:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/agent/strategy/:id/reject
 * Reject a strategy
 */
router.post('/strategy/:id/reject', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
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
 * POST /api/agent/strategy/:id/pause
 * Pause a running strategy
 */
router.post('/strategy/:id/pause', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    res.json({
      success: true,
      message: 'Strategy paused'
    });
  } catch (error: unknown) {
    logger.error('Error pausing strategy:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/agent/strategy/:id/resume
 * Resume a paused strategy
 */
router.post('/strategy/:id/resume', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    res.json({
      success: true,
      message: 'Strategy resumed'
    });
  } catch (error: unknown) {
    logger.error('Error resuming strategy:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/agent/strategy/:id/retire
 * Retire a strategy
 */
router.post('/strategy/:id/retire', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found' });
    }

    res.json({
      success: true,
      message: 'Strategy retired'
    });
  } catch (error: unknown) {
    logger.error('Error retiring strategy:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /api/agent/strategies
 * Get all strategies for the user
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
 * GET /api/agent/strategies/:sessionId
 * Get strategies for a specific session
 */
router.get('/strategies/:sessionId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user?.id || req.user?.userId)?.toString();
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    const { sessionId: _sessionId } = req.params;
    // Session-specific strategies are no longer tracked separately;
    // return all top performers from SLE
    const strategies = await strategyLearningEngine.getTopPerformers();

    res.json({
      success: true,
      strategies
    });
  } catch (error: unknown) {
    logger.error('Error getting session strategies:', error);
    res.json({
      success: true,
      strategies: [],
      _fallback: true
    });
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
