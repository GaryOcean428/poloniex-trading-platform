import express, { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/autonomous/trades — trade history.
 *
 * Reads the `autonomous_trades` table (the Monkey kernel's trade rows).
 * The FAT / LiveSignal / Persistent engines that historically also wrote
 * here were stripped 2026-05-21; the FAT-control endpoints on this route
 * (`/enable`, `/disable`, `/status`, `/config`, `/heartbeat`,
 * `/performance`) went with them. This is the surviving trade-history
 * read for the TradeHistory UI.
 */
router.get('/trades', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const status = req.query.status as string;

    let query = `
      SELECT * FROM autonomous_trades
      WHERE user_id = $1
    `;

    const params: (string | number)[] = [userId];

    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
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
        stopLoss: trade.stop_loss ? parseFloat(trade.stop_loss) : null,
        takeProfit: trade.take_profit ? parseFloat(trade.take_profit) : null,
        pnl: trade.pnl ? parseFloat(trade.pnl) : null,
        status: trade.status,
        exitReason: trade.exit_reason,
        entryTime: trade.entry_time ?? trade.created_at,
        exitTime: trade.exit_time,
        confidence: trade.confidence ? parseFloat(trade.confidence) : null,
        reason: trade.reason,
        agent: trade.agent ?? null,
        // 2026-05-11 — surface exchange order IDs so the TradeHistory
        // UI can dedup against /api/dashboard/trades fills.
        // orderId = OPEN fill, exitOrderId = CLOSE fill.
        orderId: trade.order_id ?? null,
        exitOrderId: trade.exit_order_id ?? null,
      })),
    });
  } catch (error: unknown) {
    logger.error('Error getting trades:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get trades'
    });
  }
});

export default router;
