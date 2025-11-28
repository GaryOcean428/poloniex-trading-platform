import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import backtestingEngine from '../services/backtestingEngine.js';
import { logger } from '../utils/logger.js';
import type { Request, Response } from 'express';

const router = express.Router();

// Store running backtests
const runningBacktests = new Map<string, any>();

/**
 * POST /api/backtest/run
 * Start a new backtest
 */
router.post('/run', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    const { strategyId, symbol, startDate, endDate, initialCapital, timeframe } = req.body;
    
    // Validate inputs
    if (!strategyId || !symbol || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: strategyId, symbol, startDate, endDate'
      });
    }
    
    // Generate backtest ID
    const backtestId = `backtest_${Date.now()}_${userId}`;
    
    // Initialize backtest status
    runningBacktests.set(backtestId, {
      id: backtestId,
      userId,
      strategyId,
      symbol,
      startDate,
      endDate,
      initialCapital: initialCapital || 10000,
      timeframe: timeframe || '1h',
      status: 'running',
      progress: 0,
      startedAt: new Date(),
      results: null,
      error: null
    });
    
    // Run backtest asynchronously
    runBacktestAsync(backtestId, {
      strategyId,
      symbol,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      initialCapital: initialCapital || 10000,
      timeframe: timeframe || '1h'
    });
    
    res.json({
      success: true,
      id: backtestId,
      message: 'Backtest started'
    });
    
  } catch (error: any) {
    logger.error('Error starting backtest:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start backtest'
    });
  }
});

/**
 * GET /api/backtest/status/:id
 * Get backtest status and results
 */
router.get('/status/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const backtest = runningBacktests.get(id);
    
    if (!backtest) {
      return res.status(404).json({
        success: false,
        error: 'Backtest not found'
      });
    }
    
    // Check if user owns this backtest
    if (backtest.userId !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    res.json({
      success: true,
      ...backtest
    });
    
  } catch (error: any) {
    logger.error('Error fetching backtest status:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch backtest status'
    });
  }
});

/**
 * GET /api/backtest/history
 * Get user's backtest history
 */
router.get('/history', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    const limit = parseInt(req.query.limit as string) || 20;
    
    // Get user's backtests
    const userBacktests = Array.from(runningBacktests.values())
      .filter(bt => bt.userId === userId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
    
    res.json({
      success: true,
      backtests: userBacktests
    });
    
  } catch (error: any) {
    logger.error('Error fetching backtest history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch backtest history'
    });
  }
});

/**
 * DELETE /api/backtest/:id
 * Delete a backtest
 */
router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const backtest = runningBacktests.get(id);
    
    if (!backtest) {
      return res.status(404).json({
        success: false,
        error: 'Backtest not found'
      });
    }
    
    // Check if user owns this backtest
    if (backtest.userId !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    runningBacktests.delete(id);
    
    res.json({
      success: true,
      message: 'Backtest deleted'
    });
    
  } catch (error: any) {
    logger.error('Error deleting backtest:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete backtest'
    });
  }
});

/**
 * Run backtest asynchronously
 */
async function runBacktestAsync(backtestId: string, config: any) {
  const backtest = runningBacktests.get(backtestId);
  if (!backtest) return;
  
  try {
    logger.info(`Running backtest ${backtestId}`, config);
    
    // Update progress
    backtest.progress = 10;
    
    // Get strategy (mock for now)
    const strategy = {
      id: config.strategyId,
      name: 'Test Strategy',
      type: 'trend_following',
      parameters: {
        fastPeriod: 10,
        slowPeriod: 30
      }
    };
    
    backtest.progress = 30;
    
    // Run backtest using backtesting engine
    const results = await backtestingEngine.runBacktest(strategy.name, {
      symbol: config.symbol,
      startDate: config.startDate,
      endDate: config.endDate,
      initialCapital: config.initialCapital,
      timeframe: config.timeframe
    });
    
    backtest.progress = 90;
    
    // Store results
    backtest.status = 'completed';
    backtest.progress = 100;
    backtest.results = results;
    backtest.completedAt = new Date();
    
    logger.info(`Backtest ${backtestId} completed`, { results });
    
  } catch (error: any) {
    logger.error(`Backtest ${backtestId} failed:`, error);
    backtest.status = 'failed';
    backtest.error = error.message || 'Backtest failed';
    backtest.completedAt = new Date();
  }
}

export default router;
