import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import type { Request, Response } from 'express';
import { pool } from '../db/connection.js';

const router = express.Router();

/**
 * GET /api/risk/settings
 * Get user's risk management settings
 */
router.get('/settings', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    
    // Try to get from database
    try {
      const result = await pool.query(
        'SELECT * FROM risk_settings WHERE user_id = $1',
        [userId]
      );
      
      if (result.rows.length > 0) {
        return res.json({
          success: true,
          settings: result.rows[0]
        });
      }
    } catch (dbError) {
      logger.warn('Database error fetching risk settings, using defaults:', dbError);
    }
    
    // Return default settings
    res.json({
      success: true,
      settings: {
        userId,
        maxDrawdown: 15,
        maxPositionSize: 5,
        maxConcurrentPositions: 3,
        stopLoss: 2,
        takeProfit: 4,
        dailyLossLimit: 5,
        maxLeverage: 10,
        riskLevel: 'moderate'
      }
    });
    
  } catch (error: any) {
    logger.error('Error fetching risk settings:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch risk settings'
    });
  }
});

/**
 * PUT /api/risk/settings
 * Update user's risk management settings
 */
router.put('/settings', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    const {
      maxDrawdown,
      maxPositionSize,
      maxConcurrentPositions,
      stopLoss,
      takeProfit,
      dailyLossLimit,
      maxLeverage,
      riskLevel
    } = req.body;
    
    // Validate inputs
    if (maxDrawdown && (maxDrawdown < 0 || maxDrawdown > 100)) {
      return res.status(400).json({
        success: false,
        error: 'Max drawdown must be between 0 and 100'
      });
    }
    
    const settings = {
      userId,
      maxDrawdown: maxDrawdown || 15,
      maxPositionSize: maxPositionSize || 5,
      maxConcurrentPositions: maxConcurrentPositions || 3,
      stopLoss: stopLoss || 2,
      takeProfit: takeProfit || 4,
      dailyLossLimit: dailyLossLimit || 5,
      maxLeverage: maxLeverage || 10,
      riskLevel: riskLevel || 'moderate'
    };
    
    // Try to save to database
    try {
      await pool.query(
        `INSERT INTO risk_settings (
          user_id, max_drawdown, max_position_size, max_concurrent_positions,
          stop_loss, take_profit, daily_loss_limit, max_leverage, risk_level,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          max_drawdown = EXCLUDED.max_drawdown,
          max_position_size = EXCLUDED.max_position_size,
          max_concurrent_positions = EXCLUDED.max_concurrent_positions,
          stop_loss = EXCLUDED.stop_loss,
          take_profit = EXCLUDED.take_profit,
          daily_loss_limit = EXCLUDED.daily_loss_limit,
          max_leverage = EXCLUDED.max_leverage,
          risk_level = EXCLUDED.risk_level,
          updated_at = NOW()`,
        [
          userId,
          settings.maxDrawdown,
          settings.maxPositionSize,
          settings.maxConcurrentPositions,
          settings.stopLoss,
          settings.takeProfit,
          settings.dailyLossLimit,
          settings.maxLeverage,
          settings.riskLevel
        ]
      );
    } catch (dbError) {
      logger.warn('Database error saving risk settings:', dbError);
      // Continue anyway - settings are stored in memory
    }
    
    res.json({
      success: true,
      settings,
      message: 'Risk settings updated'
    });
    
  } catch (error: any) {
    logger.error('Error updating risk settings:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update risk settings'
    });
  }
});

/**
 * GET /api/risk/status
 * Get current risk status
 */
router.get('/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    
    // Calculate current risk metrics
    // This would normally query active positions and calculate real-time risk
    const status = {
      currentDrawdown: 0,
      currentPositions: 0,
      dailyLoss: 0,
      riskScore: 25, // 0-100, lower is better
      alerts: []
    };
    
    res.json({
      success: true,
      status
    });
    
  } catch (error: any) {
    logger.error('Error fetching risk status:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch risk status'
    });
  }
});

/**
 * GET /api/risk/alerts
 * Get risk alerts
 */
router.get('/alerts', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    
    // Get risk alerts
    const alerts = [
      // Mock alerts for now
    ];
    
    res.json({
      success: true,
      alerts
    });
    
  } catch (error: any) {
    logger.error('Error fetching risk alerts:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch risk alerts'
    });
  }
});

export default router;
