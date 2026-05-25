import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import type { Request, Response } from 'express';
import { pool } from '../db/connection.js';

const router = express.Router();

/**
 * GET /api/risk/settings
 *
 * Read-only view of the operator's risk profile. The only field the
 * kernel still reads is `maxLeverage` (audited 15× safety ceiling,
 * clamped in loop.ts:~2621). The other fields are returned for backward
 * compatibility with telemetry consumers that still read them.
 *
 * The matching PUT endpoint and the GET /status / GET /alerts endpoints
 * were removed 2026-05-25 with the operator-halt strip (PR #908) and the
 * dead UI cleanup. The kernel is autonomous; operator halts that
 * suppressed entries are gone — losses feed back through the
 * neurochemistry layer instead. See [[polytrade_autonomy_doctrine]].
 */
router.get('/settings', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);

    // Try to get from database
    try {
      const result = await pool.query(
        'SELECT * FROM risk_settings WHERE user_id = $1',
        [userId],
      );

      if (result.rows.length > 0) {
        // Map snake_case columns → the camelCase shape the dashboard
        // expects.
        const row = result.rows[0];
        return res.json({
          success: true,
          settings: {
            userId,
            maxDrawdown: Number(row.max_drawdown),
            maxPositionSize: Number(row.max_position_size),
            maxConcurrentPositions: Number(row.max_concurrent_positions),
            stopLoss: Number(row.stop_loss),
            takeProfit: Number(row.take_profit),
            dailyLossLimit: Number(row.daily_loss_limit),
            maxLeverage: Number(row.max_leverage),
            riskLevel: row.risk_level,
          },
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
        riskLevel: 'moderate',
      },
    });
  } catch (error: unknown) {
    logger.error('Error fetching risk settings:', error);
    res.status(500).json({
      success: false,
      error: (error instanceof Error ? error.message : String(error)) || 'Failed to fetch risk settings',
    });
  }
});

export default router;
