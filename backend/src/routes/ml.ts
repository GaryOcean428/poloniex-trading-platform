import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import mlPredictionService from '../services/mlPredictionService.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';

const router = express.Router();

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
    try {
      ohlcvData = await poloniexFuturesService.getHistoricalData(symbol, '1h', 200);
    } catch (dataError: any) {
      console.error('Failed to fetch historical data:', dataError.message);
      return res.status(503).json({ 
        error: 'ML models unavailable', 
        message: 'Unable to fetch market data. Please ensure API credentials are configured.',
        details: dataError.message 
      });
    }
    
    if (!ohlcvData || ohlcvData.length === 0) {
      return res.status(503).json({ 
        error: 'ML models unavailable',
        message: 'No historical data available for predictions'
      });
    }

    // Get current price
    const tickers = await poloniexFuturesService.getTickers(symbol);
    const ticker = Array.isArray(tickers) ? tickers[0] : tickers;
    const currentPrice = parseFloat(ticker?.markPrice || ticker?.lastPrice || '0');

    // Get multi-horizon predictions
    const predictions = await mlPredictionService.getMultiHorizonPredictions(symbol, ohlcvData);

    // Get trading signal
    const signal = await mlPredictionService.getTradingSignal(symbol, ohlcvData, currentPrice);

    res.json({
      symbol,
      predictions,
      signal,
      currentPrice,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
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
      message: error.message
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

    // Train models
    const results = await mlPredictionService.trainModels(symbol, ohlcvData);

    res.json({
      symbol,
      training_results: results,
      data_points: ohlcvData.length,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('ML training endpoint error:', error);
    res.status(500).json({ 
      error: 'Failed to train ML models',
      message: error.message 
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

  } catch (error: any) {
    res.status(500).json({ 
      status: 'unhealthy',
      error: error.message 
    });
  }
});

export default router;
