import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import fullyAutonomousTrader from '../services/fullyAutonomousTrader.js';
import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';
const router = express.Router();
/**
 * POST /api/autonomous/enable
 * Enable fully autonomous trading
 */
router.post('/enable', authenticateToken, async (req, res) => {
    try {
        const userId = String(req.user.id);
        const config = req.body;
        await fullyAutonomousTrader.enableAutonomousTrading(userId, config);
        res.json({
            success: true,
            message: 'Autonomous trading enabled. The system will now trade automatically to profitability.',
            config
        });
    }
    catch (error) {
        logger.error('Error enabling autonomous trading:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to enable autonomous trading'
        });
    }
});
/**
 * POST /api/autonomous/disable
 * Disable autonomous trading and close all positions
 */
router.post('/disable', authenticateToken, async (req, res) => {
    try {
        const userId = String(req.user.id);
        await fullyAutonomousTrader.disableAutonomousTrading(userId);
        res.json({
            success: true,
            message: 'Autonomous trading disabled. All positions have been closed.'
        });
    }
    catch (error) {
        logger.error('Error disabling autonomous trading:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to disable autonomous trading'
        });
    }
});
/**
 * GET /api/autonomous/status
 * Get current autonomous trading status
 */
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const userId = String(req.user.id);
        // Get config
        const configResult = await pool.query('SELECT * FROM autonomous_trading_configs WHERE user_id = $1', [userId]);
        if (configResult.rows.length === 0) {
            return res.json({
                success: true,
                enabled: false,
                message: 'Autonomous trading not configured'
            });
        }
        const config = configResult.rows[0];
        // Get performance metrics
        const metrics = await fullyAutonomousTrader.getPerformanceMetrics(userId);
        // Get recent trades
        const tradesResult = await pool.query(`SELECT * FROM autonomous_trades 
       WHERE user_id = $1 
       ORDER BY entry_time DESC 
       LIMIT 10`, [userId]);
        // Get open positions count
        const openPositionsResult = await pool.query(`SELECT COUNT(*) as count FROM autonomous_trades 
       WHERE user_id = $1 AND status = 'open'`, [userId]);
        res.json({
            success: true,
            enabled: config.enabled,
            config: {
                initialCapital: parseFloat(config.initial_capital),
                maxRiskPerTrade: parseFloat(config.max_risk_per_trade),
                maxDrawdown: parseFloat(config.max_drawdown),
                targetDailyReturn: parseFloat(config.target_daily_return),
                symbols: config.symbols
            },
            metrics: metrics || {
                currentEquity: parseFloat(config.initial_capital),
                totalReturn: 0,
                drawdown: 0
            },
            openPositions: parseInt(openPositionsResult.rows[0].count),
            recentTrades: tradesResult.rows.map(trade => ({
                id: trade.id,
                symbol: trade.symbol,
                side: trade.side,
                entryPrice: parseFloat(trade.entry_price),
                exitPrice: trade.exit_price ? parseFloat(trade.exit_price) : null,
                quantity: parseFloat(trade.quantity),
                pnl: trade.pnl ? parseFloat(trade.pnl) : null,
                pnlPercentage: trade.pnl_percentage ? parseFloat(trade.pnl_percentage) : null,
                status: trade.status,
                exitReason: trade.exit_reason,
                entryTime: trade.entry_time,
                exitTime: trade.exit_time,
                confidence: trade.confidence ? parseFloat(trade.confidence) : null,
                reason: trade.reason
            }))
        });
    }
    catch (error) {
        logger.error('Error getting autonomous trading status:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get status'
        });
    }
});
/**
 * GET /api/autonomous/performance
 * Get detailed performance metrics
 */
router.get('/performance', authenticateToken, async (req, res) => {
    try {
        const userId = String(req.user.id);
        const days = parseInt(req.query.days) || 30;
        // Get performance history
        const performanceResult = await pool.query(`SELECT * FROM autonomous_performance 
       WHERE user_id = $1 
       AND timestamp > NOW() - INTERVAL '${days} days'
       ORDER BY timestamp ASC`, [userId]);
        // Get trade statistics
        const statsResult = await pool.query(`SELECT 
         COUNT(*) as total_trades,
         COUNT(*) FILTER (WHERE status = 'closed' AND pnl > 0) as winning_trades,
         COUNT(*) FILTER (WHERE status = 'closed' AND pnl < 0) as losing_trades,
         AVG(pnl) FILTER (WHERE status = 'closed') as avg_pnl,
         SUM(pnl) FILTER (WHERE status = 'closed') as total_pnl,
         MAX(pnl) FILTER (WHERE status = 'closed') as best_trade,
         MIN(pnl) FILTER (WHERE status = 'closed') as worst_trade
       FROM autonomous_trades 
       WHERE user_id = $1`, [userId]);
        const stats = statsResult.rows[0];
        const winRate = stats.total_trades > 0
            ? (parseInt(stats.winning_trades) / parseInt(stats.total_trades)) * 100
            : 0;
        res.json({
            success: true,
            performance: performanceResult.rows.map(p => ({
                currentEquity: parseFloat(p.current_equity),
                totalReturn: parseFloat(p.total_return),
                drawdown: parseFloat(p.drawdown),
                timestamp: p.timestamp
            })),
            statistics: {
                totalTrades: parseInt(stats.total_trades),
                winningTrades: parseInt(stats.winning_trades),
                losingTrades: parseInt(stats.losing_trades),
                winRate: winRate.toFixed(2),
                avgPnL: stats.avg_pnl ? parseFloat(stats.avg_pnl) : 0,
                totalPnL: stats.total_pnl ? parseFloat(stats.total_pnl) : 0,
                bestTrade: stats.best_trade ? parseFloat(stats.best_trade) : 0,
                worstTrade: stats.worst_trade ? parseFloat(stats.worst_trade) : 0
            }
        });
    }
    catch (error) {
        logger.error('Error getting performance metrics:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get performance'
        });
    }
});
/**
 * GET /api/autonomous/trades
 * Get trade history
 */
router.get('/trades', authenticateToken, async (req, res) => {
    try {
        const userId = String(req.user.id);
        const limit = parseInt(req.query.limit) || 50;
        const status = req.query.status;
        let query = `
      SELECT * FROM autonomous_trades 
      WHERE user_id = $1
    `;
        const params = [userId];
        if (status) {
            query += ` AND status = $2`;
            params.push(status);
        }
        query += ` ORDER BY entry_time DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        const result = await pool.query(query, params);
        res.json({
            success: true,
            trades: result.rows.map(trade => ({
                id: trade.id,
                symbol: trade.symbol,
                side: trade.side,
                entryPrice: parseFloat(trade.entry_price),
                exitPrice: trade.exit_price ? parseFloat(trade.exit_price) : null,
                quantity: parseFloat(trade.quantity),
                leverage: trade.leverage,
                stopLoss: parseFloat(trade.stop_loss),
                takeProfit: parseFloat(trade.take_profit),
                pnl: trade.pnl ? parseFloat(trade.pnl) : null,
                pnlPercentage: trade.pnl_percentage ? parseFloat(trade.pnl_percentage) : null,
                status: trade.status,
                exitReason: trade.exit_reason,
                entryTime: trade.entry_time,
                exitTime: trade.exit_time,
                confidence: trade.confidence ? parseFloat(trade.confidence) : null,
                reason: trade.reason
            }))
        });
    }
    catch (error) {
        logger.error('Error getting trades:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get trades'
        });
    }
});
export default router;
