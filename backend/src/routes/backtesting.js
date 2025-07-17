import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import backtestingEngine from '../services/backtestingEngine.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * Register a new trading strategy
 * POST /api/backtesting/strategies
 */
router.post('/strategies', authenticateToken, async (req, res) => {
  try {
    const { name, type, description, parameters, risk_parameters } = req.body;
    
    // Validate required fields
    if (!name || !type || !parameters) {
      return res.status(400).json({
        error: 'Missing required fields: name, type, parameters'
      });
    }

    // Validate strategy type
    const validTypes = ['momentum', 'mean_reversion', 'breakout', 'custom'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        error: `Invalid strategy type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const strategy = {
      name,
      type,
      description,
      parameters,
      risk_parameters: risk_parameters || {
        stopLossPercent: 0.02,
        takeProfitPercent: 0.04,
        riskPerTrade: 0.02,
        maxPositionSize: 0.1
      }
    };

    // Register strategy with backtesting engine
    backtestingEngine.registerStrategy(name, strategy);

    res.json({
      success: true,
      message: `Strategy ${name} registered successfully`,
      strategy
    });
  } catch (error) {
    logger.error('Error registering strategy:', error);
    res.status(500).json({
      error: 'Failed to register strategy',
      details: error.message
    });
  }
});

/**
 * Get all registered strategies
 * GET /api/backtesting/strategies
 */
router.get('/strategies', authenticateToken, async (req, res) => {
  try {
    const status = backtestingEngine.getBacktestStatus();
    
    res.json({
      success: true,
      strategies: status.strategies,
      total: status.strategies.length
    });
  } catch (error) {
    logger.error('Error fetching strategies:', error);
    res.status(500).json({
      error: 'Failed to fetch strategies',
      details: error.message
    });
  }
});

/**
 * Run a backtest
 * POST /api/backtesting/run
 */
router.post('/run', authenticateToken, async (req, res) => {
  try {
    const {
      strategyName,
      symbol,
      timeframe,
      startDate,
      endDate,
      initialCapital,
      stopLossPercent,
      takeProfitPercent,
      riskPerTrade,
      maxPositionSize
    } = req.body;

    // Validate required fields
    if (!strategyName || !symbol || !timeframe || !startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required fields: strategyName, symbol, timeframe, startDate, endDate'
      });
    }

    // Validate date range
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start >= end) {
      return res.status(400).json({
        error: 'Start date must be before end date'
      });
    }

    // Check if backtest is already running
    const status = backtestingEngine.getBacktestStatus();
    if (status.isRunning) {
      return res.status(409).json({
        error: 'Another backtest is already running',
        currentBacktest: status.currentBacktest?.strategyName
      });
    }

    const config = {
      symbol,
      timeframe,
      startDate: start,
      endDate: end,
      initialCapital: initialCapital || 100000,
      stopLossPercent: stopLossPercent || 0.02,
      takeProfitPercent: takeProfitPercent || 0.04,
      riskPerTrade: riskPerTrade || 0.02,
      maxPositionSize: maxPositionSize || 0.1
    };

    // Start backtest (non-blocking)
    setTimeout(async () => {
      try {
        await backtestingEngine.runBacktest(strategyName, config);
      } catch (error) {
        logger.error('Backtest execution error:', error);
      }
    }, 0);

    res.json({
      success: true,
      message: 'Backtest started successfully',
      config
    });
  } catch (error) {
    logger.error('Error starting backtest:', error);
    res.status(500).json({
      error: 'Failed to start backtest',
      details: error.message
    });
  }
});

/**
 * Get backtest status
 * GET /api/backtesting/status
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const status = backtestingEngine.getBacktestStatus();
    
    res.json({
      success: true,
      status
    });
  } catch (error) {
    logger.error('Error fetching backtest status:', error);
    res.status(500).json({
      error: 'Failed to fetch backtest status',
      details: error.message
    });
  }
});

/**
 * Stop running backtest
 * POST /api/backtesting/stop
 */
router.post('/stop', authenticateToken, async (req, res) => {
  try {
    backtestingEngine.stopBacktest();
    
    res.json({
      success: true,
      message: 'Backtest stopped successfully'
    });
  } catch (error) {
    logger.error('Error stopping backtest:', error);
    res.status(500).json({
      error: 'Failed to stop backtest',
      details: error.message
    });
  }
});

/**
 * Get backtest results
 * GET /api/backtesting/results
 */
router.get('/results', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const results = await backtestingEngine.getBacktestResults(limit);
    
    res.json({
      success: true,
      results,
      total: results.length
    });
  } catch (error) {
    logger.error('Error fetching backtest results:', error);
    res.status(500).json({
      error: 'Failed to fetch backtest results',
      details: error.message
    });
  }
});

/**
 * Get detailed backtest results
 * GET /api/backtesting/results/:backtestId
 */
router.get('/results/:backtestId', authenticateToken, async (req, res) => {
  try {
    const { backtestId } = req.params;
    const details = await backtestingEngine.getBacktestDetails(backtestId);
    
    if (!details) {
      return res.status(404).json({
        error: 'Backtest not found'
      });
    }
    
    res.json({
      success: true,
      details
    });
  } catch (error) {
    logger.error('Error fetching backtest details:', error);
    res.status(500).json({
      error: 'Failed to fetch backtest details',
      details: error.message
    });
  }
});

/**
 * Load historical data for a symbol
 * POST /api/backtesting/historical-data
 */
router.post('/historical-data', authenticateToken, async (req, res) => {
  try {
    const { symbol, timeframe, startDate, endDate } = req.body;
    
    // Validate required fields
    if (!symbol || !timeframe || !startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required fields: symbol, timeframe, startDate, endDate'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start >= end) {
      return res.status(400).json({
        error: 'Start date must be before end date'
      });
    }

    const data = await backtestingEngine.loadHistoricalData(symbol, timeframe, start, end);
    
    res.json({
      success: true,
      data,
      count: data.length,
      symbol,
      timeframe,
      startDate: start,
      endDate: end
    });
  } catch (error) {
    logger.error('Error loading historical data:', error);
    res.status(500).json({
      error: 'Failed to load historical data',
      details: error.message
    });
  }
});

/**
 * Get predefined strategy templates
 * GET /api/backtesting/strategy-templates
 */
router.get('/strategy-templates', authenticateToken, async (req, res) => {
  try {
    const templates = {
      momentum: {
        name: 'Momentum Trading',
        type: 'momentum',
        description: 'Trend-following strategy using RSI and MACD indicators',
        parameters: {
          rsi_oversold: 30,
          rsi_overbought: 70,
          macd_threshold: 0,
          lookback: 20
        },
        risk_parameters: {
          stopLossPercent: 0.02,
          takeProfitPercent: 0.04,
          riskPerTrade: 0.02,
          maxPositionSize: 0.1
        }
      },
      mean_reversion: {
        name: 'Mean Reversion',
        type: 'mean_reversion',
        description: 'Mean reversion strategy using Bollinger Bands and RSI',
        parameters: {
          bb_std_dev: 2,
          rsi_extreme: 20,
          lookback: 20
        },
        risk_parameters: {
          stopLossPercent: 0.015,
          takeProfitPercent: 0.03,
          riskPerTrade: 0.015,
          maxPositionSize: 0.08
        }
      },
      breakout: {
        name: 'Breakout Strategy',
        type: 'breakout',
        description: 'Breakout strategy using support/resistance levels',
        parameters: {
          lookback_period: 20,
          volume_threshold: 1.5,
          breakout_threshold: 0.01
        },
        risk_parameters: {
          stopLossPercent: 0.025,
          takeProfitPercent: 0.05,
          riskPerTrade: 0.025,
          maxPositionSize: 0.12
        }
      }
    };
    
    res.json({
      success: true,
      templates
    });
  } catch (error) {
    logger.error('Error fetching strategy templates:', error);
    res.status(500).json({
      error: 'Failed to fetch strategy templates',
      details: error.message
    });
  }
});

/**
 * Create strategy from template
 * POST /api/backtesting/strategy-from-template
 */
router.post('/strategy-from-template', authenticateToken, async (req, res) => {
  try {
    const { templateType, customName, customParameters } = req.body;
    
    if (!templateType) {
      return res.status(400).json({
        error: 'Missing required field: templateType'
      });
    }

    // Get template
    const templatesResponse = await globalThis.fetch(`${req.protocol}://${req.get('host')}/api/backtesting/strategy-templates`);
    const templatesData = await templatesResponse.json();
    
    const template = templatesData.templates[templateType];
    if (!template) {
      return res.status(404).json({
        error: `Template ${templateType} not found`
      });
    }

    // Create strategy with custom parameters
    const strategy = {
      ...template,
      name: customName || `${template.name} - ${Date.now()}`,
      parameters: { ...template.parameters, ...customParameters }
    };

    // Register strategy
    backtestingEngine.registerStrategy(strategy.name, strategy);

    res.json({
      success: true,
      message: `Strategy ${strategy.name} created from template`,
      strategy
    });
  } catch (error) {
    logger.error('Error creating strategy from template:', error);
    res.status(500).json({
      error: 'Failed to create strategy from template',
      details: error.message
    });
  }
});

/**
 * Get available symbols and timeframes
 * GET /api/backtesting/symbols
 */
router.get('/symbols', authenticateToken, async (req, res) => {
  try {
    // In a real implementation, this would fetch from the exchange API
    const symbols = [
      'BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT',
      'LTCUSDT', 'XRPUSDT', 'BCHUSDT', 'EOSUSDT', 'ETCUSDT'
    ];
    
    const timeframes = [
      { value: '1m', label: '1 minute' },
      { value: '5m', label: '5 minutes' },
      { value: '15m', label: '15 minutes' },
      { value: '30m', label: '30 minutes' },
      { value: '1h', label: '1 hour' },
      { value: '4h', label: '4 hours' },
      { value: '1d', label: '1 day' }
    ];
    
    res.json({
      success: true,
      symbols,
      timeframes
    });
  } catch (error) {
    logger.error('Error fetching symbols:', error);
    res.status(500).json({
      error: 'Failed to fetch symbols',
      details: error.message
    });
  }
});

/**
 * WebSocket endpoint for real-time backtest updates
 * This would be integrated with the existing WebSocket server
 */
router.get('/ws-info', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'WebSocket events available:',
      events: [
        'backtestProgress - Real-time backtest progress updates',
        'backtestComplete - Backtest completion notification',
        'backtestError - Backtest error notifications'
      ],
      usage: 'Connect to the main WebSocket server and listen for these events'
    });
  } catch (error) {
    logger.error('Error fetching WebSocket info:', error);
    res.status(500).json({
      error: 'Failed to fetch WebSocket info',
      details: error.message
    });
  }
});

export default router;