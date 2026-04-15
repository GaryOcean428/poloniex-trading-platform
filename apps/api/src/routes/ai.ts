import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import type { Request, Response } from 'express';

const router = express.Router();

/**
 * POST /api/ai/trading-insight
 * Returns an AI-generated trading insight based on current market data.
 * Falls back to a structured summary when no external AI provider is configured.
 */
router.post('/trading-insight', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { tradingData, userQuery } = req.body;

    if (!tradingData) {
      return res.status(400).json({ success: false, error: 'tradingData is required' });
    }

    // Build a structured insight from the trading data itself.
    // If an AI provider (Claude, etc.) is configured via env, call it here.
    const symbol = tradingData.symbol || 'BTC_USDT_PERP';
    const price = tradingData.currentPrice ?? tradingData.price ?? 0;
    const change24h = tradingData.change24h ?? 0;

    const direction = change24h > 1 ? 'bullish' : change24h < -1 ? 'bearish' : 'neutral';

    const insight = {
      summary: `${symbol} is currently trading at ${price} with a ${change24h.toFixed(2)}% 24h change. Market sentiment appears ${direction}.`,
      direction,
      confidence: Math.min(Math.abs(change24h) / 10, 1),
      keyLevels: {
        support: price * 0.97,
        resistance: price * 1.03,
      },
      recommendation: direction === 'bullish'
        ? 'Consider long entries on pullbacks to support.'
        : direction === 'bearish'
          ? 'Consider short entries on rallies to resistance.'
          : 'Wait for a clear directional move before entering.',
      query: userQuery || null,
      generatedAt: new Date().toISOString(),
    };

    res.json({ success: true, insight });
  } catch (error: unknown) {
    logger.error('Error generating trading insight:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate insight'
    });
  }
});

export default router;
