/**
 * QIG (Quantum Information Geometry) Enhanced ML Routes
 * 
 * Provides endpoints for QIG-enhanced predictions with telemetry
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import qigEnhancedMlService from '../services/qig/qigEnhancedMlService.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/qig/predictions/:symbol
 * Get QIG-enhanced predictions with full telemetry
 */
router.get('/predictions/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    logger.info(`QIG prediction request for ${symbol} by user ${userId}`);

    // Get historical OHLCV data (last 200 candles, 1h timeframe)
    let ohlcvData;
    
    try {
      ohlcvData = await poloniexFuturesService.getHistoricalData(symbol, '1h', 200);
      
      if (!ohlcvData || ohlcvData.length === 0) {
        throw new Error('No historical data available');
      }
    } catch (dataError: unknown) {
      logger.error('Failed to fetch historical data:', dataError);
      return res.status(503).json({
        error: 'Unable to fetch market data',
        message: dataError instanceof Error ? dataError.message : String(dataError)
      });
    }

    // Get QIG-enhanced predictions
    const result = await qigEnhancedMlService.getMultiHorizonPredictions(symbol, ohlcvData);

    // Get current price for reference
    let currentPrice = 0;
    try {
      const tickers = await poloniexFuturesService.getTickers(symbol);
      const ticker = Array.isArray(tickers) ? tickers[0] : tickers;
      currentPrice = parseFloat(ticker?.markPx || ticker?.markPrice || '0');
    } catch {
      currentPrice = ohlcvData[ohlcvData.length - 1]?.close || 0;
    }

    res.json({
      symbol,
      currentPrice,
      timestamp: Date.now(),
      predictions: result.predictions,
      qigMetrics: result.qigMetrics,
      explanation: result.explanation
    });

  } catch (error: unknown) {
    logger.error('QIG prediction error:', error);
    res.status(500).json({
      error: 'Failed to generate QIG predictions',
      message: error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)
    });
  }
});

/**
 * GET /api/qig/metrics/:symbol
 * Get only QIG metrics without predictions (lighter endpoint)
 */
router.get('/metrics/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Get historical data
    const ohlcvData = await poloniexFuturesService.getHistoricalData(symbol, '1h', 200);
    
    if (!ohlcvData || ohlcvData.length === 0) {
      return res.status(503).json({ success: false, error: 'No historical data available' });
    }

    // Get full predictions (includes metrics)
    const result = await qigEnhancedMlService.getMultiHorizonPredictions(symbol, ohlcvData);

    // Return only metrics
    res.json({
      symbol,
      timestamp: Date.now(),
      qigMetrics: result.qigMetrics,
      explanation: result.explanation
    });

  } catch (error: unknown) {
    logger.error('QIG metrics error:', error);
    res.status(500).json({
      error: 'Failed to compute QIG metrics',
      message: error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)
    });
  }
});

/**
 * GET /api/qig/compare/:symbol
 * Compare QIG-enhanced predictions with baseline predictions
 */
router.get('/compare/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    logger.info(`QIG comparison request for ${symbol} by user ${userId}`);

    // Get historical data
    const ohlcvData = await poloniexFuturesService.getHistoricalData(symbol, '1h', 200);
    
    if (!ohlcvData || ohlcvData.length === 0) {
      return res.status(503).json({ success: false, error: 'No historical data available' });
    }

    // Get QIG-enhanced predictions
    const qigResult = await qigEnhancedMlService.getMultiHorizonPredictions(symbol, ohlcvData);

    // Get baseline predictions (from simple ML service)
    const simpleMlService = (await import('../services/simpleMlService.js')).default;
    const baselinePredictions = await simpleMlService.getMultiHorizonPredictions(symbol, ohlcvData);

    // Get current price
    let currentPrice = 0;
    try {
      const tickers = await poloniexFuturesService.getTickers(symbol);
      const ticker = Array.isArray(tickers) ? tickers[0] : tickers;
      currentPrice = parseFloat(ticker?.markPx || ticker?.markPrice || '0');
    } catch {
      currentPrice = ohlcvData[ohlcvData.length - 1]?.close || 0;
    }

    res.json({
      symbol,
      currentPrice,
      timestamp: Date.now(),
      qigEnhanced: {
        predictions: qigResult.predictions,
        metrics: qigResult.qigMetrics,
        explanation: qigResult.explanation
      },
      baseline: {
        predictions: baselinePredictions
      },
      comparison: {
        confidenceDelta: {
          '1h': qigResult.predictions['1h'].confidence - baselinePredictions['1h'].confidence,
          '4h': qigResult.predictions['4h'].confidence - baselinePredictions['4h'].confidence,
          '24h': qigResult.predictions['24h'].confidence - baselinePredictions['24h'].confidence
        },
        directionAgreement: {
          '1h': qigResult.predictions['1h'].direction === baselinePredictions['1h'].direction,
          '4h': qigResult.predictions['4h'].direction === baselinePredictions['4h'].direction,
          '24h': qigResult.predictions['24h'].direction === baselinePredictions['24h'].direction
        }
      }
    });

  } catch (error: unknown) {
    logger.error('QIG comparison error:', error);
    res.status(500).json({
      error: 'Failed to compare predictions',
      message: error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)
    });
  }
});

/**
 * GET /api/qig/health
 * Health check for QIG service
 */
router.get('/health', async (req, res) => {
  try {
    const healthy = await qigEnhancedMlService.healthCheck();
    res.json({
      status: healthy ? 'healthy' : 'unhealthy',
      service: 'qig-enhanced-ml',
      timestamp: Date.now()
    });
  } catch (error: unknown) {
    res.status(500).json({
      status: 'unhealthy',
      service: 'qig-enhanced-ml',
      error: error instanceof Error ? error.message : String(error),
      timestamp: Date.now()
    });
  }
});

export default router;
