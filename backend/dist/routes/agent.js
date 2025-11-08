import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { autonomousTradingAgent } from '../services/autonomousTradingAgent.js';
import { pool } from '../db/connection.js';
const router = express.Router();
/**
 * POST /api/agent/start
 * Start the autonomous trading agent
 */
router.post('/start', authenticateToken, async (req, res) => {
    try {
        // Safely get user ID with fallback
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User ID not found in token'
            });
        }
        const config = req.body;
        const session = await autonomousTradingAgent.startAgent(userId, config);
        res.json({
            success: true,
            session
        });
    }
    catch (error) {
        console.error('Error starting agent:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to start agent'
        });
    }
});
/**
 * POST /api/agent/stop
 * Stop the autonomous trading agent
 */
router.post('/stop', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User ID not found in token'
            });
        }
        // Get active session
        const status = await autonomousTradingAgent.getAgentStatus(userId);
        if (!status) {
            return res.status(404).json({
                success: false,
                error: 'No active agent session found'
            });
        }
        await autonomousTradingAgent.stopAgent(status.id);
        res.json({
            success: true,
            message: 'Agent stopped successfully'
        });
    }
    catch (error) {
        console.error('Error stopping agent:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to stop agent'
        });
    }
});
/**
 * POST /api/agent/pause
 * Pause the autonomous trading agent
 */
router.post('/pause', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User ID not found in token'
            });
        }
        const status = await autonomousTradingAgent.getAgentStatus(userId);
        if (!status) {
            return res.status(404).json({
                success: false,
                error: 'No active agent session found'
            });
        }
        await autonomousTradingAgent.pauseAgent(status.id);
        res.json({
            success: true,
            message: 'Agent paused successfully'
        });
    }
    catch (error) {
        console.error('Error pausing agent:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to pause agent'
        });
    }
});
/**
 * GET /api/agent/status
 * Get current agent status
 */
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User ID not found in token'
            });
        }
        const status = await autonomousTradingAgent.getAgentStatus(userId);
        res.json({
            success: true,
            status: status || null
        });
    }
    catch (error) {
        console.error('Error getting agent status:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get agent status'
        });
    }
});
/**
 * GET /api/agent/activity
 * Get agent activity log
 */
router.get('/activity', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User ID not found in token'
            });
        }
        const limit = parseInt(req.query.limit) || 20;
        // Get user's active session
        const status = await autonomousTradingAgent.getAgentStatus(userId);
        if (!status) {
            return res.json({
                success: true,
                activity: []
            });
        }
        const result = await pool.query('SELECT * FROM agent_activity_log WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2', [status.id, limit]);
        res.json({
            success: true,
            activity: result.rows
        });
    }
    catch (error) {
        console.error('Error getting activity:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get activity'
        });
    }
});
/**
 * GET /api/agent/strategies
 * Get generated strategies
 */
router.get('/strategies', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User ID not found in token'
            });
        }
        // Get user's active session
        const status = await autonomousTradingAgent.getAgentStatus(userId);
        if (!status) {
            return res.json({
                success: true,
                strategies: []
            });
        }
        const result = await pool.query('SELECT * FROM agent_strategies WHERE session_id = $1 ORDER BY created_at DESC', [status.id]);
        res.json({
            success: true,
            strategies: result.rows
        });
    }
    catch (error) {
        console.error('Error getting strategies:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get strategies'
        });
    }
});
/**
 * GET /api/agent/performance
 * Get performance metrics
 */
router.get('/performance', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User ID not found in token'
            });
        }
        const status = await autonomousTradingAgent.getAgentStatus(userId);
        if (!status) {
            return res.json({
                success: true,
                performance: {
                    totalPnl: 0,
                    winRate: 0,
                    totalTrades: 0,
                    winningTrades: 0,
                    losingTrades: 0,
                    averageWin: 0,
                    averageLoss: 0,
                    sharpeRatio: 0,
                    maxDrawdown: 0
                }
            });
        }
        // Calculate performance metrics from trades
        const tradesResult = await pool.query(`SELECT 
        COUNT(*) as total_trades,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
        SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing_trades,
        SUM(pnl) as total_pnl,
        AVG(CASE WHEN pnl > 0 THEN pnl END) as avg_win,
        AVG(CASE WHEN pnl < 0 THEN pnl END) as avg_loss
      FROM trades 
      WHERE user_id = $1 AND created_at >= $2`, [userId, status.startedAt]);
        const metrics = tradesResult.rows[0];
        res.json({
            success: true,
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
                sharpeRatio: 0, // TODO: Calculate Sharpe ratio
                maxDrawdown: 0 // TODO: Calculate max drawdown
            }
        });
    }
    catch (error) {
        console.error('Error getting performance:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get performance'
        });
    }
});
/**
 * GET /api/agent/learnings
 * Get AI learnings
 */
router.get('/learnings', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User ID not found in token'
            });
        }
        const status = await autonomousTradingAgent.getAgentStatus(userId);
        if (!status) {
            return res.json({
                success: true,
                learnings: []
            });
        }
        const result = await pool.query('SELECT * FROM agent_learnings WHERE session_id = $1 ORDER BY created_at DESC LIMIT 10', [status.id]);
        res.json({
            success: true,
            learnings: result.rows
        });
    }
    catch (error) {
        console.error('Error getting learnings:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get learnings'
        });
    }
});
/**
 * PUT /api/agent/config
 * Update agent configuration
 */
router.put('/config', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User ID not found in token'
            });
        }
        const config = req.body;
        const status = await autonomousTradingAgent.getAgentStatus(userId);
        if (!status) {
            return res.status(404).json({
                success: false,
                error: 'No active agent session found'
            });
        }
        // Update config in database
        await pool.query('UPDATE agent_sessions SET config = $1 WHERE id = $2', [JSON.stringify(config), status.id]);
        res.json({
            success: true,
            message: 'Configuration updated successfully'
        });
    }
    catch (error) {
        console.error('Error updating config:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update configuration'
        });
    }
});
export default router;
