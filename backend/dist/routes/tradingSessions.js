/**
 * Trading Sessions Routes
 * Endpoints for managing persistent autonomous trading sessions
 */
import express from 'express';
import { persistentTradingEngine } from '../services/persistentTradingEngine.js';
import { authenticateToken } from '../middleware/auth.js';
import { pool } from '../db/connection.js';
const router = express.Router();
/**
 * Start a new trading session
 * POST /api/trading-sessions
 */
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { strategyConfig, riskConfig, sessionName } = req.body;
        const userId = req.user.userId;
        if (!strategyConfig) {
            return res.status(400).json({ error: 'Strategy configuration is required' });
        }
        const sessionId = await persistentTradingEngine.startSession(userId, strategyConfig, riskConfig, sessionName);
        res.json({
            success: true,
            sessionId,
            message: 'Trading session started successfully'
        });
    }
    catch (error) {
        console.error('Error starting trading session:', error);
        res.status(500).json({ error: error.message || 'Failed to start trading session' });
    }
});
/**
 * Stop a trading session
 * POST /api/trading-sessions/:sessionId/stop
 */
router.post('/:sessionId/stop', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.userId;
        // Verify session belongs to user
        const result = await pool.query('SELECT user_id FROM trading_sessions WHERE id = $1', [sessionId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Trading session not found' });
        }
        if (result.rows[0].user_id !== userId) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        await persistentTradingEngine.stopSession(sessionId);
        res.json({
            success: true,
            message: 'Trading session stopped successfully'
        });
    }
    catch (error) {
        console.error('Error stopping trading session:', error);
        res.status(500).json({ error: error.message || 'Failed to stop trading session' });
    }
});
/**
 * Get all trading sessions for current user
 * GET /api/trading-sessions
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const result = await pool.query(`SELECT id, session_name, is_active, strategy_config, risk_config, 
              performance_metrics, started_at, stopped_at, last_heartbeat_at
       FROM trading_sessions 
       WHERE user_id = $1 
       ORDER BY started_at DESC`, [userId]);
        res.json({
            sessions: result.rows
        });
    }
    catch (error) {
        console.error('Error fetching trading sessions:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch trading sessions' });
    }
});
/**
 * Get trading session details
 * GET /api/trading-sessions/:sessionId
 */
router.get('/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.userId;
        const result = await pool.query(`SELECT * FROM trading_sessions 
       WHERE id = $1 AND user_id = $2`, [sessionId, userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Trading session not found' });
        }
        res.json({
            session: result.rows[0]
        });
    }
    catch (error) {
        console.error('Error fetching trading session:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch trading session' });
    }
});
/**
 * Get trading engine status
 * GET /api/trading-sessions/engine/status
 */
router.get('/engine/status', authenticateToken, async (req, res) => {
    try {
        const isRunning = persistentTradingEngine.isEngineRunning();
        const activeSessions = persistentTradingEngine.getActiveSessionsStatus();
        res.json({
            isRunning,
            activeSessionsCount: activeSessions.length,
            activeSessions
        });
    }
    catch (error) {
        console.error('Error fetching engine status:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch engine status' });
    }
});
export default router;
