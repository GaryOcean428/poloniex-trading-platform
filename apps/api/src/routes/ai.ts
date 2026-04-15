import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import type { Request, Response } from 'express';

const router = express.Router();

/**
 * POST /api/ai/trading-insight
 * Returns a trading insight matching the frontend TradingInsight interface:
 *   { type, title, content, confidence (0-100), timeframe }
 */
router.post('/trading-insight', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { tradingData, userQuery } = req.body;

    if (!tradingData) {
      return res.status(400).json({ success: false, error: 'tradingData is required' });
    }

    const symbol = tradingData.symbol || 'BTC_USDT_PERP';
    const price = tradingData.currentPrice ?? tradingData.price ?? 0;
    const change24h = tradingData.change24h ?? 0;
    const rsi = tradingData.technicalIndicators?.rsi;

    const direction = change24h > 1 ? 'bullish' : change24h < -1 ? 'bearish' : 'neutral';
    const confidence = Math.min(Math.abs(change24h) * 10, 95); // 0-100 scale

    // Determine insight type based on what data is available
    let type: 'analysis' | 'recommendation' | 'risk_assessment' | 'market_outlook' = 'analysis';
    let title = 'Market Analysis';
    let content = `${symbol} is trading at ${price} with a ${change24h.toFixed(2)}% 24h change. Sentiment appears ${direction}.`;
    let timeframe = '24h';

    if (userQuery) {
      type = 'recommendation';
      title = 'Custom Analysis';
      content += ` Query: ${userQuery}`;
    } else if (Math.abs(change24h) > 3) {
      type = 'recommendation';
      title = 'Trading Recommendation';
      content = direction === 'bullish'
        ? `${symbol} up ${change24h.toFixed(2)}% — consider long entries on pullbacks. Support near ${(price * 0.97).toFixed(2)}.`
        : `${symbol} down ${Math.abs(change24h).toFixed(2)}% — consider short entries on rallies. Resistance near ${(price * 1.03).toFixed(2)}.`;
      timeframe = '4h-24h';
    } else if (rsi !== undefined) {
      type = 'risk_assessment';
      title = 'Risk Assessment';
      const rsiSignal = rsi > 70 ? 'overbought' : rsi < 30 ? 'oversold' : 'neutral';
      content = `RSI at ${rsi.toFixed(0)} (${rsiSignal}). ${rsiSignal === 'overbought' ? 'Pullback risk elevated.' : rsiSignal === 'oversold' ? 'Bounce potential.' : 'No extreme readings.'} Current price: ${price}.`;
      timeframe = 'Current';
    } else if (Math.abs(change24h) < 0.5) {
      type = 'market_outlook';
      title = 'Market Outlook';
      content = `${symbol} is range-bound (${change24h.toFixed(2)}%). Wait for a directional breakout before entering new positions.`;
      timeframe = '1h-4h';
    }

    const insight = {
      type,
      title,
      content,
      confidence: Math.round(confidence),
      timeframe,
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
