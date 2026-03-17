import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import paperTradingService from '../services/paperTradingService.js';
import { logger } from '../utils/logger.js';
import type { Request, Response } from 'express';

const router = express.Router();

/**
 * POST /api/paper-trading/start
 * Start paper trading for a strategy
 */
router.post('/start', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    const { strategyId, symbol, initialCapital } = req.body;
    
    if (!strategyId) {
      return res.status(400).json({
        success: false,
        error: 'Strategy ID is required'
      });
    }
    
    // Start paper trading
    const session = await paperTradingService.createSession({
      userId,
      strategyId,
      symbol: symbol || 'BTC_USDT',
      initialCapital: initialCapital || 10000,
      name: `Paper Trading - ${strategyId}`
    });
    
    res.json({
      success: true,
      session
    });
    
  } catch (error: unknown) {
    logger.error('Error starting paper trading:', error);
    res.status(500).json({
      success: false,
      error: (error instanceof Error ? error.message : String(error)) || 'Failed to start paper trading'
    });
  }
});

/**
 * POST /api/paper-trading/stop
 * Stop paper trading for a strategy
 */
router.post('/stop', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { strategyId } = req.body;
    
    if (!strategyId) {
      return res.status(400).json({
        success: false,
        error: 'Strategy ID is required'
      });
    }
    
    // Stop paper trading
    await paperTradingService.stopSession(strategyId);
    
    res.json({
      success: true,
      message: 'Paper trading stopped'
    });
    
  } catch (error: unknown) {
    logger.error('Error stopping paper trading:', error);
    res.status(500).json({
      success: false,
      error: (error instanceof Error ? error.message : String(error)) || 'Failed to stop paper trading'
    });
  }
});

/**
 * GET /api/paper-trading/status
 * Get paper trading status
 */
router.get('/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { strategyId } = req.query;
    
    // Get status
    const session = paperTradingService.getSession(strategyId as string);
    const status = session ? {
      active: true,
      session: {
        id: session.id,
        strategyId: session.strategyName || strategyId,
        symbol: session.symbol,
        initialCapital: session.initialCapital,
        currentCapital: session.currentCapital,
        totalPnL: session.totalPnl,
        realizedPnL: session.realizedPnl,
        unrealizedPnL: session.unrealizedPnl,
        winRate: session.winRate,
        totalTrades: session.totalTrades,
        winningTrades: session.winningTrades,
        losingTrades: session.losingTrades
      }
    } : {
      active: false
    };
    
    res.json({
      success: true,
      status
    });
    
  } catch (error: unknown) {
    logger.error('Error fetching paper trading status:', error);
    res.status(500).json({
      success: false,
      error: (error instanceof Error ? error.message : String(error)) || 'Failed to fetch status'
    });
  }
});

/**
 * GET /api/paper-trading/trades
 * Get paper trading trade history
 */
router.get('/trades', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { strategyId } = req.query;
    
    // Get trades
    const session = paperTradingService.getSession(strategyId as string);
    const trades = session ? Array.from(session.trades.values()) : [];
    
    res.json({
      success: true,
      trades
    });
    
  } catch (error: unknown) {
    logger.error('Error fetching paper trading trades:', error);
    res.status(500).json({
      success: false,
      error: (error instanceof Error ? error.message : String(error)) || 'Failed to fetch trades'
    });
  }
});

/**
 * GET /api/paper-trading/pnl
 * Get paper trading P&L data
 */
router.get('/pnl', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { strategyId } = req.query;
    
    // Get P&L
    const session = paperTradingService.getSession(strategyId as string);
    const pnl = session ? {
      totalPnL: session.totalPnl,
      realizedPnL: session.realizedPnl,
      unrealizedPnL: session.unrealizedPnl,
      winRate: session.winRate,
      totalTrades: session.totalTrades,
      initialCapital: session.initialCapital,
      currentValue: session.currentValue,
      fees: session.trades
        .filter((t: any) => t.fees)
        .reduce((sum: number, t: any) => sum + (t.fees || 0), 0)
    } : null;
    
    res.json({
      success: true,
      pnl
    });
    
  } catch (error: unknown) {
    logger.error('Error fetching paper trading P&L:', error);
    res.status(500).json({
      success: false,
      error: (error instanceof Error ? error.message : String(error)) || 'Failed to fetch P&L'
    });
  }
});

export default router;
