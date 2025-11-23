import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { autonomousTradingAgent } from '../services/autonomousTradingAgent.js';
import { enhancedAutonomousAgent } from '../services/enhancedAutonomousAgent.js';
import { agentSettingsService } from '../services/agentSettingsService.js';
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
        // Use enhanced agent if AI strategies are enabled
        const useEnhancedAgent = config.enableAIStrategies !== false;
        const session = useEnhancedAgent
            ? await enhancedAutonomousAgent.startAgent(userId, config)
            : await autonomousTradingAgent.startAgent(userId, config);
        res.json({
            success: true,
            session
        });
    }
    catch (error) {
        console.error('Error starting agent:', error);
        // Provide specific error codes
        let errorCode = 'UNKNOWN_ERROR';
        let statusCode = 500;
        if (error.message.includes('credentials')) {
            errorCode = 'CREDENTIALS_ERROR';
            statusCode = 400;
        }
        else if (error.message.includes('already running')) {
            errorCode = 'ALREADY_RUNNING';
            statusCode = 409;
        }
        else if (error.message.includes('API')) {
            errorCode = 'API_ERROR';
            statusCode = 503;
        }
        res.status(statusCode).json({
            success: false,
            error: error.message || 'Failed to start agent',
            code: errorCode
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
        const status = await autonomousTradingAgent.getAgentStatus(userId);
        if (!status) {
            return res.json({
                success: true,
                performance: defaultPerformance
            });
        }
        // Calculate performance metrics from trades
        try {
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
        catch (dbError) {
            console.warn('Trades table query failed, returning default performance:', dbError.message);
            // Return default performance if trades table doesn't exist
            res.json({
                success: true,
                performance: defaultPerformance
            });
        }
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
/**
 * GET /api/agent/activity/live
 * Get live activity feed (real-time updates)
 */
router.get('/activity/live', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User ID not found' });
        }
        const limit = parseInt(req.query.limit) || 50;
        // Return empty array for now - will be populated when agent is running
        res.json({
            success: true,
            activities: []
        });
    }
    catch (error) {
        console.error('Error getting live activity:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/agent/strategies/active
 * Get currently active trading strategies
 */
router.get('/strategies/active', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        console.error('Error getting active strategies:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/agent/strategies/pending-approval
 * Get strategies awaiting manual approval
 */
router.get('/strategies/pending-approval', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User ID not found' });
        }
        res.json({
            success: true,
            strategies: []
        });
    }
    catch (error) {
        console.error('Error getting pending strategies:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/agent/strategy/current
 * Get currently generating strategy
 */
router.get('/strategy/current', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User ID not found' });
        }
        res.json({
            success: true,
            generation: null
        });
    }
    catch (error) {
        console.error('Error getting current strategy:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/agent/strategy/recent
 * Get recently generated strategies
 */
router.get('/strategy/recent', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User ID not found' });
        }
        const limit = parseInt(req.query.limit) || 5;
        res.json({
            success: true,
            strategies: []
        });
    }
    catch (error) {
        console.error('Error getting recent strategies:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/agent/backtest/results
 * Get backtest results
 */
router.get('/backtest/results', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User ID not found' });
        }
        const limit = parseInt(req.query.limit) || 10;
        const strategyId = req.query.strategy_id;
        res.json({
            success: true,
            results: []
        });
    }
    catch (error) {
        console.error('Error getting backtest results:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/agent/strategy/:id/approve
 * Approve a strategy for trading
 */
router.post('/strategy/:id/approve', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User ID not found' });
        }
        const strategyId = req.params.id;
        res.json({
            success: true,
            message: 'Strategy approved'
        });
    }
    catch (error) {
        console.error('Error approving strategy:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/agent/strategy/:id/reject
 * Reject a strategy
 */
router.post('/strategy/:id/reject', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User ID not found' });
        }
        const strategyId = req.params.id;
        res.json({
            success: true,
            message: 'Strategy rejected'
        });
    }
    catch (error) {
        console.error('Error rejecting strategy:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/agent/strategy/:id/pause
 * Pause a running strategy
 */
router.post('/strategy/:id/pause', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User ID not found' });
        }
        const strategyId = req.params.id;
        res.json({
            success: true,
            message: 'Strategy paused'
        });
    }
    catch (error) {
        console.error('Error pausing strategy:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/agent/strategy/:id/resume
 * Resume a paused strategy
 */
router.post('/strategy/:id/resume', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User ID not found' });
        }
        const strategyId = req.params.id;
        res.json({
            success: true,
            message: 'Strategy resumed'
        });
    }
    catch (error) {
        console.error('Error resuming strategy:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * POST /api/agent/strategy/:id/retire
 * Retire a strategy
 */
router.post('/strategy/:id/retire', authenticateToken, async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?.userId)?.toString();
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User ID not found' });
        }
        const strategyId = req.params.id;
        res.json({
            success: true,
            message: 'Strategy retired'
        });
    }
    catch (error) {
        console.error('Error retiring strategy:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/agent/strategies
 * Get all strategies for the user
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
        const strategies = await enhancedAutonomousAgent.getUserStrategies(userId);
        res.json({
            success: true,
            strategies
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
 * GET /api/agent/strategies/:sessionId
 * Get strategies for a specific session
 */
router.get('/strategies/:sessionId', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        console.error('Error getting session strategies:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get strategies'
        });
    }
});
/**
 * GET /api/agent/settings
 * Get agent settings for the user
 */
router.get('/settings', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        console.error('Error getting agent settings:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get agent settings'
        });
    }
});
/**
 * POST /api/agent/settings
 * Save agent settings
 */
router.post('/settings', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        console.error('Error saving agent settings:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to save agent settings'
        });
    }
});
export default router;
