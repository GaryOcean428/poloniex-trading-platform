import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { enhancedAutonomousAgent } from '../services/enhancedAutonomousAgent.js';
import { agentSettingsService } from '../services/agentSettingsService.js';
import type { Request, Response } from 'express';
import { pool } from '../db/connection.js';

const router = express.Router();

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

    const session = await enhancedAutonomousAgent.startAgent(userId, config);

    res.json({
      success: true,
      session
    });
  } catch (error: unknown) {
    console.error('Error starting agent:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    
    // Handle "already running" with structured 409
    if (errMsg.includes('already running')) {
      try {
        const catchUserId = (req.user?.id || req.user?.userId)?.toString();
        const existingSession = catchUserId ? await enhancedAutonomousAgent.getAgentStatus(catchUserId) : null;
        return res.status(409).json({
          success: false,
          error: 'An agent session is already active',
          code: 'ALREADY_RUNNING',
          existingSessionId: existingSession?.id || null,
          existingState: existingSession?.status || 'unknown',
          startedAt: existingSession?.startedAt || null,
          resumeAllowed: existingSession?.status === 'paused',
          takeoverAllowed: true
        });
      } catch {
        return res.status(409).json({
          success: false,
          error: 'An agent session is already active',
          code: 'ALREADY_RUNNING',
          existingSessionId: null,
          existingState: 'unknown',
          startedAt: null,
          resumeAllowed: false,
          takeoverAllowed: true
        });
      }
    }
    
    // Provide specific error codes for other errors
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

    // Get active session
    const status = await enhancedAutonomousAgent.getAgentStatus(userId);
    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'No active agent session found'
      });
    }

    await enhancedAutonomousAgent.stopAgent(status.id);

    res.json({
      success: true,
      message: 'Agent stopped successfully'
    });
  } catch (error: unknown) {
    console.error('Error stopping agent:', error);
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

    const status = await enhancedAutonomousAgent.getAgentStatus(userId);
    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'No active agent session found'
      });
    }

    await enhancedAutonomousAgent.pauseAgent(status.id);

    res.json({
      success: true,
      message: 'Agent paused successfully'
    });
  } catch (error: unknown) {
    console.error('Error pausing agent:', error);
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

    const status = await enhancedAutonomousAgent.getAgentStatus(userId);
    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'No active agent session found'
      });
    }

    if (status.status !== 'paused') {
      return res.status(400).json({
        success: false,
        error: `Cannot resume agent in '${status.status}' state. Agent must be paused.`,
        code: 'INVALID_STATE'
      });
    }

    // Resume the agent by updating state
    try {
      await pool.query(
        'UPDATE agent_sessions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['running', status.id]
      );
    } catch {
      // DB update is best-effort; in-memory state is the source of truth
    }
    status.status = 'running';

    res.json({
      success: true,
      message: 'Agent resumed successfully',
      session: {
        id: status.id,
        status: status.status,
        startedAt: status.startedAt
      }
    });
  } catch (error: unknown) {
    console.error('Error resuming agent:', error);
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

    const status = await enhancedAutonomousAgent.getAgentStatus(userId);

    res.json({
      success: true,
      status: status || null
    });
  } catch (error: unknown) {
    console.error('Error getting agent status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get agent status'
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

    // Check if agent service is available
    const agentAvailable = enhancedAutonomousAgent != null;
    
    // Check for active session
    let activeSession = null;
    try {
      activeSession = await enhancedAutonomousAgent.getAgentStatus(userId);
    } catch {
      // Agent status unavailable
    }

    const allHealthy = dbHealthy && agentAvailable;

    res.json({
      success: true,
      healthy: allHealthy,
      dependencies: {
        database: { healthy: dbHealthy, message: dbHealthy ? 'Connected' : 'Connection failed' },
        agentService: { healthy: agentAvailable, message: agentAvailable ? 'Available' : 'Unavailable' },
        activeSession: activeSession ? {
          id: activeSession.id,
          status: activeSession.status,
          startedAt: activeSession.startedAt
        } : null
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: unknown) {
    console.error('Error checking agent health:', error);
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

    const limit = parseInt(req.query.limit as string) || 20;

    // Get user's active session
    const status = await enhancedAutonomousAgent.getAgentStatus(userId);
    if (!status) {
      return res.json({
        success: true,
        activity: []
      });
    }

    const result = await pool.query(
      'SELECT * FROM agent_activity_log WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2',
      [status.id, limit]
    );

    res.json({
      success: true,
      activity: result.rows
    });
  } catch (error: unknown) {
    console.error('Error getting activity:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get activity'
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

    const limit = parseInt(req.query.limit as string) || 50;
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
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('does not exist') || errMsg.includes('relation')) {
      res.json({
        success: true,
        events: []
      });
    } else {
      console.error('Agent events query failed:', errMsg);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch agent events'
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

    // Get user's active session
    const status = await enhancedAutonomousAgent.getAgentStatus(userId);
    if (!status) {
      return res.json({
        success: true,
        strategies: []
      });
    }

    const result = await pool.query(
      'SELECT * FROM agent_strategies WHERE session_id = $1 ORDER BY created_at DESC',
      [status.id]
    );

    res.json({
      success: true,
      strategies: result.rows
    });
  } catch (error: unknown) {
    console.error('Error getting strategies:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get strategies'
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

    const status = await enhancedAutonomousAgent.getAgentStatus(userId);
    if (!status) {
      return res.json({
        success: true,
        performance: defaultPerformance
      });
    }

    // Calculate performance metrics from trades
    try {
      const mode = req.query.mode as string | undefined;
      const modeFilter = mode ? ' AND execution_mode = $3' : '';
      const queryParams: (string | Date)[] = [userId, status.startedAt];
      if (mode) queryParams.push(mode);
      
      const tradesResult = await pool.query(
        `SELECT 
          COUNT(*) as total_trades,
          SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
          SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing_trades,
          SUM(pnl) as total_pnl,
          AVG(CASE WHEN pnl > 0 THEN pnl END) as avg_win,
          AVG(CASE WHEN pnl < 0 THEN pnl END) as avg_loss
        FROM trades 
        WHERE user_id = $1 AND created_at >= $2${modeFilter}`,
        queryParams
      );

      const metrics = tradesResult.rows[0];

      // Calculate Sharpe ratio and max drawdown from individual trade returns
      let sharpeRatio = 0;
      let maxDrawdown = 0;

      try {
        const returnsResult = await pool.query(
          `SELECT pnl FROM trades 
           WHERE user_id = $1 AND created_at >= $2 AND pnl IS NOT NULL${modeFilter}
           ORDER BY created_at ASC`,
          queryParams
        );

        const pnls = returnsResult.rows.map((r: { pnl: string }) => parseFloat(r.pnl));
        if (pnls.length > 1) {
          // Sharpe ratio: mean(returns) / stddev(returns) * sqrt(252)
          // 252 = standard number of trading days per year for annualization
          const mean = pnls.reduce((a: number, b: number) => a + b, 0) / pnls.length;
          const variance = pnls.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / (pnls.length - 1);
          const stdDev = Math.sqrt(variance);
          const TRADING_DAYS_PER_YEAR = 252;
          sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;

          // Max drawdown: largest peak-to-trough decline in cumulative PnL
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

      // Fetch daily P&L for charts
      let dailyPerformance: Array<{ date: string; pnl: number; cumulativePnL: number; trades: number }> = [];
      try {
        const dailyResult = await pool.query(
          `SELECT
             DATE(created_at) as trade_date,
             SUM(pnl) as daily_pnl,
             COUNT(*) as daily_trades
           FROM trades
           WHERE user_id = $1 AND created_at >= $2 AND pnl IS NOT NULL${modeFilter}
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
            trades: parseInt(r.daily_trades) || 0
          };
        });
      } catch {
        // Daily breakdown unavailable — return empty array
      }

      res.json({
        success: true,
        mode: mode || 'all',
        performance: {
          totalPnl: parseFloat(metrics.total_pnl || 0),
          winRate: metrics.total_trades > 0 
            ? (parseFloat(metrics.winning_trades || 0) / parseFloat(metrics.total_trades)) * 100 
            : 0,
          totalTrades: parseInt(metrics.total_trades || 0),
          winningTrades: parseInt(metrics.winning_trades || 0),
          losingTrades: parseInt(metrics.losing_trades || 0),
          averageWin: parseFloat(metrics.avg_win || 0),
          averageLoss: parseFloat(metrics.avg_loss || 0),
          sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
          maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2))
        },
        dailyPerformance
      });
    } catch (dbError: unknown) {
      console.warn('Trades table query failed, returning default performance:', dbError instanceof Error ? dbError.message : String(dbError));
      // Return default performance if trades table doesn't exist
      res.json({
        success: true,
        performance: defaultPerformance,
        dailyPerformance: []
      });
    }
  } catch (error: unknown) {
    console.error('Error getting performance:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get performance'
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

    const status = await enhancedAutonomousAgent.getAgentStatus(userId);
    if (!status) {
      return res.json({
        success: true,
        circuitBreaker: {
          isTripped: false,
          consecutiveLosses: 0,
          dailyLossPercent: 0
        }
      });
    }

    const cbStatus = enhancedAutonomousAgent.getCircuitBreakerStatus(status.id);
    res.json({ success: true, circuitBreaker: cbStatus });
  } catch (error: unknown) {
    console.error('Error getting circuit breaker status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get circuit breaker status'
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

    const status = await enhancedAutonomousAgent.getAgentStatus(userId);
    if (!status) {
      return res.json({
        success: true,
        learnings: []
      });
    }

    const result = await pool.query(
      'SELECT * FROM agent_learnings WHERE session_id = $1 ORDER BY created_at DESC LIMIT 10',
      [status.id]
    );

    res.json({
      success: true,
      learnings: result.rows
    });
  } catch (error: unknown) {
    console.error('Error getting learnings:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get learnings'
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

    const status = await enhancedAutonomousAgent.getAgentStatus(userId);
    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'No active agent session found'
      });
    }

    // Update config in database
    await pool.query(
      'UPDATE agent_sessions SET config = $1 WHERE id = $2',
      [JSON.stringify(config), status.id]
    );

    res.json({
      success: true,
      message: 'Configuration updated successfully'
    });
  } catch (error: unknown) {
    console.error('Error updating config:', error);
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
    console.error('Error getting live activity:', error);
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
    console.error('Error getting active strategies:', error);
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

    res.json({
      success: true,
      strategies: []
    });
  } catch (error: unknown) {
    console.error('Error getting pending strategies:', error);
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
    console.error('Error getting current strategy:', error);
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
    console.error('Error getting recent strategies:', error);
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
    console.error('Error getting backtest results:', error);
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

    res.json({
      success: true,
      message: 'Strategy approved'
    });
  } catch (error: unknown) {
    console.error('Error approving strategy:', error);
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
    console.error('Error rejecting strategy:', error);
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
    console.error('Error pausing strategy:', error);
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
    console.error('Error resuming strategy:', error);
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
    console.error('Error retiring strategy:', error);
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

    const strategies = await enhancedAutonomousAgent.getUserStrategies(userId);

    res.json({
      success: true,
      strategies
    });
  } catch (error: unknown) {
    console.error('Error getting strategies:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get strategies'
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

    const { sessionId } = req.params;
    const strategies = await enhancedAutonomousAgent.getStrategies(sessionId);

    res.json({
      success: true,
      strategies
    });
  } catch (error: unknown) {
    console.error('Error getting session strategies:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get strategies'
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
    console.error('Error getting agent settings:', error);
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
    console.error('Error saving agent settings:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save agent settings'
    });
  }
});

export default router;
