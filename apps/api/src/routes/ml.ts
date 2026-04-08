import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import mlPredictionService from '../services/mlPredictionService.js';
import simpleMlService from '../services/simpleMlService.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';

const router = express.Router();

// Flag to use simple ML service if ml-worker fails
let usePythonML = true;

/**
 * Get ML model performance and predictions
 */
router.get('/performance/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get historical OHLCV data (last 200 candles, 1h timeframe)
    let ohlcvData;
    let currentPrice = 0;
    
    try {
      ohlcvData = await poloniexFuturesService.getHistoricalData(symbol, '1h', 200);
      
      if (!ohlcvData || ohlcvData.length === 0) {
        throw new Error('No historical data available');
      }
      
      // Get current price from ticker
      const tickers = await poloniexFuturesService.getTickers(symbol);
      const ticker = Array.isArray(tickers) ? tickers[0] : tickers;
      currentPrice = parseFloat(ticker?.markPx || ticker?.markPrice || ticker?.lastPx || ticker?.lastPrice || '0');
      
      // If ticker fails, use last candle close price
      if (!currentPrice && ohlcvData.length > 0) {
        currentPrice = ohlcvData[ohlcvData.length - 1].close;
      }
    } catch (dataError: unknown) {
      console.error('Failed to fetch historical data:', dataError instanceof Error ? dataError.message : String(dataError));
      // Return fallback data instead of 503
      return res.json({
        symbol,
        predictions: {
          '1h': { price: 0, confidence: 0, direction: 'NEUTRAL' },
          '4h': { price: 0, confidence: 0, direction: 'NEUTRAL' },
          '24h': { price: 0, confidence: 0, direction: 'NEUTRAL' }
        },
        signal: {
          action: 'HOLD',
          confidence: 0,
          reason: 'Unable to fetch market data. Please check API credentials.'
        },
        currentPrice: 0,
        timestamp: new Date().toISOString(),
        error: 'Data unavailable',
        message: dataError instanceof Error ? dataError.message : String(dataError)
      });
    }

    // Get multi-horizon predictions
    let predictions, signal;
    
    try {
      // Try ml-worker (HTTP/Redis) first if enabled
      if (usePythonML) {
        try {
          predictions = await mlPredictionService.getMultiHorizonPredictions(symbol, ohlcvData);
          signal = await mlPredictionService.getTradingSignal(symbol, ohlcvData, currentPrice);
          usePythonML = true; // Re-enable on success (allows recovery after transient errors)
        } catch (workerError: unknown) {
          console.warn('ML worker failed, falling back to simple ML:', workerError instanceof Error ? workerError.message : String(workerError));
          usePythonML = false; // Disable for a while to avoid repeated timeouts
          throw workerError; // Re-throw to use fallback
        }
      } else {
        throw new Error('ML worker temporarily disabled, using simple ML');
      }
    } catch {
      console.warn('[ML] Using simpleMlService as fallback — ml-worker unavailable');
      // Use JavaScript-based simple ML service
      predictions = await simpleMlService.getMultiHorizonPredictions(symbol, ohlcvData);
      signal = await simpleMlService.getTradingSignal(symbol, ohlcvData, currentPrice);
    }

    res.json({
      symbol,
      predictions,
      signal,
      currentPrice,
      timestamp: new Date().toISOString()
    });

  } catch (error: unknown) {
    console.error('ML performance endpoint error:', error);
    
    // Return fallback data when ML models unavailable
    res.json({
      symbol: req.params.symbol,
      predictions: {
        '1h': { price: 0, confidence: 0, direction: 'NEUTRAL' },
        '4h': { price: 0, confidence: 0, direction: 'NEUTRAL' },
        '24h': { price: 0, confidence: 0, direction: 'NEUTRAL' }
      },
      signal: {
        action: 'HOLD',
        confidence: 0,
        reason: 'ML models not available - Python dependencies need to be installed on Railway'
      },
      currentPrice: 0,
      timestamp: new Date().toISOString(),
      error: 'ML models unavailable',
      message: error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)
    });
  }
});

/**
 * Train ML models on historical data
 */
router.post('/train/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get historical data for training (last 1000 candles)
    const ohlcvData = await poloniexFuturesService.getHistoricalData(symbol, '1h', 1000);
    
    if (!ohlcvData || ohlcvData.length < 100) {
      return res.status(400).json({ error: 'Insufficient historical data for training' });
    }

    let results;
    try {
      if (usePythonML) {
        results = await mlPredictionService.trainModels(symbol, ohlcvData);
      } else {
        throw new Error('ML worker temporarily disabled, using simple ML');
      }
    } catch (workerError: unknown) {
      console.warn('ML worker training failed, falling back to simple ML:', workerError instanceof Error ? workerError.message : String(workerError));
      usePythonML = false;
      results = {
        mode: 'fallback',
        message: 'Python ML unavailable. Using simple JavaScript ML for runtime predictions.',
        models_trained: [],
        fallback: true
      };
    }

    res.json({
      symbol,
      training_results: results,
      data_points: ohlcvData.length,
      timestamp: new Date().toISOString()
    });

  } catch (error: unknown) {
    console.error('ML training endpoint error:', error);
    res.status(500).json({
      error: 'Failed to train ML models',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Get ML service health status
 */
router.get('/health', async (req, res) => {
  try {
    const isHealthy = await mlPredictionService.healthCheck();
    
    res.json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      models: ['LSTM', 'Transformer', 'GBM', 'ARIMA', 'Prophet'],
      timestamp: new Date().toISOString()
    });

  } catch (error: unknown) {
    res.status(500).json({ 
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error) 
    });
  }
});

export default router;
