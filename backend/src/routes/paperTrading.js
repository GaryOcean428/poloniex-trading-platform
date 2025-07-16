import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import paperTradingService from '../services/paperTradingService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * Create a new paper trading session
 * POST /api/paper-trading/sessions
 */
router.post('/sessions', authenticateToken, async (req, res) => {
  try {
    const {
      name,
      strategyName,
      symbol,
      timeframe,
      initialCapital,
      riskParameters
    } = req.body;

    // Validate required fields
    if (!strategyName || !symbol || !timeframe) {
      return res.status(400).json({
        error: 'Missing required fields: strategyName, symbol, timeframe'
      });
    }

    // Validate initial capital
    const capital = initialCapital || 100000;
    if (capital < 1000 || capital > 10000000) {
      return res.status(400).json({
        error: 'Initial capital must be between $1,000 and $10,000,000'
      });
    }

    const config = {
      name,
      strategyName,
      symbol,
      timeframe,
      initialCapital: capital,
      riskParameters: {
        maxDailyLoss: 0.05,
        maxPositionSize: 0.1,
        stopLossPercent: 0.02,
        takeProfitPercent: 0.04,
        riskPerTrade: 0.02,
        ...riskParameters
      }
    };

    const session = await paperTradingService.createSession(config);

    res.json({
      success: true,
      message: 'Paper trading session created successfully',
      session: {
        id: session.id,
        name: session.name,
        strategyName: session.strategyName,
        symbol: session.symbol,
        timeframe: session.timeframe,
        initialCapital: session.initialCapital,
        currentValue: session.currentValue,
        status: session.status,
        startedAt: session.startedAt
      }
    });
  } catch (error) {
    logger.error('Error creating paper trading session:', error);
    res.status(500).json({
      error: 'Failed to create paper trading session',
      details: error.message
    });
  }
});

/**
 * Get all paper trading sessions
 * GET /api/paper-trading/sessions
 */
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const sessions = paperTradingService.getActiveSessions();
    
    res.json({
      success: true,
      sessions,
      total: sessions.length
    });
  } catch (error) {
    logger.error('Error fetching paper trading sessions:', error);
    res.status(500).json({
      error: 'Failed to fetch paper trading sessions',
      details: error.message
    });
  }
});

/**
 * Get specific paper trading session details
 * GET /api/paper-trading/sessions/:sessionId
 */
router.get('/sessions/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = paperTradingService.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({
        error: 'Paper trading session not found'
      });
    }

    res.json({
      success: true,
      session
    });
  } catch (error) {
    logger.error('Error fetching paper trading session:', error);
    res.status(500).json({
      error: 'Failed to fetch paper trading session',
      details: error.message
    });
  }
});

/**
 * Start a paper trading session with strategy
 * POST /api/paper-trading/sessions/:sessionId/start
 */
router.post('/sessions/:sessionId/start', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { strategyConfig } = req.body;

    const session = await paperTradingService.startSession(sessionId, strategyConfig);
    
    res.json({
      success: true,
      message: 'Paper trading session started successfully',
      session: {
        id: session.id,
        name: session.name,
        status: session.status,
        currentValue: session.currentValue
      }
    });
  } catch (error) {
    logger.error('Error starting paper trading session:', error);
    res.status(500).json({
      error: 'Failed to start paper trading session',
      details: error.message
    });
  }
});

/**
 * Stop a paper trading session
 * POST /api/paper-trading/sessions/:sessionId/stop
 */
router.post('/sessions/:sessionId/stop', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await paperTradingService.stopSession(sessionId);
    
    res.json({
      success: true,
      message: 'Paper trading session stopped successfully',
      session: {
        id: session.id,
        name: session.name,
        status: session.status,
        finalValue: session.currentValue,
        totalReturn: ((session.currentValue - session.initialCapital) / session.initialCapital) * 100,
        totalTrades: session.totalTrades,
        winRate: session.totalTrades > 0 ? (session.winningTrades / session.totalTrades) * 100 : 0
      }
    });
  } catch (error) {
    logger.error('Error stopping paper trading session:', error);
    res.status(500).json({
      error: 'Failed to stop paper trading session',
      details: error.message
    });
  }
});

/**
 * Manually open a position
 * POST /api/paper-trading/sessions/:sessionId/positions
 */
router.post('/sessions/:sessionId/positions', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { side, size, symbol, type = 'market', price } = req.body;

    // Validate required fields
    if (!side || !size || !symbol) {
      return res.status(400).json({
        error: 'Missing required fields: side, size, symbol'
      });
    }

    // Validate side
    if (!['long', 'short'].includes(side)) {
      return res.status(400).json({
        error: 'Side must be either "long" or "short"'
      });
    }

    // Get current session
    const session = paperTradingService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error: 'Paper trading session not found'
      });
    }

    // For manual orders, we need current market price
    const marketData = paperTradingService.marketData.get(symbol);
    if (!marketData) {
      return res.status(400).json({
        error: 'No market data available for this symbol'
      });
    }

    const orderPrice = price || marketData.price || marketData.close;

    // Simulate order execution
    const executionResult = await paperTradingService.simulateOrderExecution(
      session,
      {
        side,
        size,
        price: orderPrice,
        type
      }
    );

    if (!executionResult.success) {
      return res.status(400).json({
        error: 'Order execution failed',
        details: executionResult.message
      });
    }

    // Create position
    const position = await paperTradingService.createPosition(session, {
      side,
      size,
      entryPrice: executionResult.executionPrice,
      stopLoss: paperTradingService.calculateStopLoss(executionResult.executionPrice, side, session.riskParameters),
      takeProfit: paperTradingService.calculateTakeProfit(executionResult.executionPrice, side, session.riskParameters),
      reason: 'manual'
    });

    res.json({
      success: true,
      message: 'Position opened successfully',
      position,
      execution: executionResult
    });
  } catch (error) {
    logger.error('Error opening position:', error);
    res.status(500).json({
      error: 'Failed to open position',
      details: error.message
    });
  }
});

/**
 * Close a position
 * POST /api/paper-trading/sessions/:sessionId/positions/:positionId/close
 */
router.post('/sessions/:sessionId/positions/:positionId/close', authenticateToken, async (req, res) => {
  try {
    const { sessionId, positionId } = req.params;
    const { reason = 'manual', price } = req.body;

    const position = await paperTradingService.closePosition(sessionId, positionId, reason, price);
    
    res.json({
      success: true,
      message: 'Position closed successfully',
      position,
      realizedPnl: position.realizedPnl
    });
  } catch (error) {
    logger.error('Error closing position:', error);
    res.status(500).json({
      error: 'Failed to close position',
      details: error.message
    });
  }
});

/**
 * Get positions for a session
 * GET /api/paper-trading/sessions/:sessionId/positions
 */
router.get('/sessions/:sessionId/positions', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { status } = req.query;

    const session = paperTradingService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error: 'Paper trading session not found'
      });
    }

    let positions = session.positions;
    
    // Filter by status if specified
    if (status) {
      positions = positions.filter(pos => pos.status === status);
    }

    res.json({
      success: true,
      positions,
      total: positions.length
    });
  } catch (error) {
    logger.error('Error fetching positions:', error);
    res.status(500).json({
      error: 'Failed to fetch positions',
      details: error.message
    });
  }
});

/**
 * Get trades for a session
 * GET /api/paper-trading/sessions/:sessionId/trades
 */
router.get('/sessions/:sessionId/trades', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const session = paperTradingService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error: 'Paper trading session not found'
      });
    }

    const trades = session.trades
      .slice(offset, offset + limit)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      trades,
      total: session.trades.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    logger.error('Error fetching trades:', error);
    res.status(500).json({
      error: 'Failed to fetch trades',
      details: error.message
    });
  }
});

/**
 * Get session performance metrics
 * GET /api/paper-trading/sessions/:sessionId/metrics
 */
router.get('/sessions/:sessionId/metrics', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = paperTradingService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error: 'Paper trading session not found'
      });
    }

    // Calculate performance metrics
    const totalReturn = ((session.currentValue - session.initialCapital) / session.initialCapital) * 100;
    const winRate = session.totalTrades > 0 ? (session.winningTrades / session.totalTrades) * 100 : 0;
    const avgWin = session.winningTrades > 0 ? 
      session.trades.filter(t => t.type === 'exit' && t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0) / session.winningTrades : 0;
    const avgLoss = session.losingTrades > 0 ? 
      session.trades.filter(t => t.type === 'exit' && t.pnl <= 0).reduce((sum, t) => sum + t.pnl, 0) / session.losingTrades : 0;
    const profitFactor = Math.abs(avgLoss) > 0 ? avgWin / Math.abs(avgLoss) : (avgWin > 0 ? Infinity : 0);

    // Calculate drawdown
    let maxValue = session.initialCapital;
    let maxDrawdown = 0;
    const dailyValues = [session.initialCapital]; // Would need historical data for actual calculation
    
    for (const value of dailyValues) {
      if (value > maxValue) {
        maxValue = value;
      }
      const drawdown = (maxValue - value) / maxValue * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    const metrics = {
      totalReturn: totalReturn.toFixed(2),
      currentValue: session.currentValue.toFixed(2),
      unrealizedPnl: session.unrealizedPnl.toFixed(2),
      realizedPnl: session.realizedPnl.toFixed(2),
      totalTrades: session.totalTrades,
      winningTrades: session.winningTrades,
      losingTrades: session.losingTrades,
      winRate: winRate.toFixed(2),
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      profitFactor: profitFactor.toFixed(2),
      maxDrawdown: maxDrawdown.toFixed(2),
      sessionDuration: session.startedAt ? Math.floor((Date.now() - new Date(session.startedAt)) / (1000 * 60 * 60)) : 0, // hours
      openPositions: Array.from(session.positions.values()).filter(p => p.status === 'open').length
    };

    res.json({
      success: true,
      metrics
    });
  } catch (error) {
    logger.error('Error calculating session metrics:', error);
    res.status(500).json({
      error: 'Failed to calculate session metrics',
      details: error.message
    });
  }
});

/**
 * Get market data for paper trading
 * GET /api/paper-trading/market-data/:symbol
 */
router.get('/market-data/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;
    const marketData = paperTradingService.marketData.get(symbol);
    
    if (!marketData) {
      return res.status(404).json({
        error: 'Market data not available for this symbol'
      });
    }

    res.json({
      success: true,
      marketData
    });
  } catch (error) {
    logger.error('Error fetching market data:', error);
    res.status(500).json({
      error: 'Failed to fetch market data',
      details: error.message
    });
  }
});

/**
 * Get paper trading configuration options
 * GET /api/paper-trading/config
 */
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const config = {
      symbols: [
        'BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT',
        'LTCUSDT', 'XRPUSDT', 'BCHUSDT', 'EOSUSDT', 'ETCUSDT'
      ],
      timeframes: [
        { value: '1m', label: '1 minute' },
        { value: '5m', label: '5 minutes' },
        { value: '15m', label: '15 minutes' },
        { value: '30m', label: '30 minutes' },
        { value: '1h', label: '1 hour' },
        { value: '4h', label: '4 hours' },
        { value: '1d', label: '1 day' }
      ],
      riskParametersDefaults: {
        maxDailyLoss: 0.05,
        maxPositionSize: 0.1,
        stopLossPercent: 0.02,
        takeProfitPercent: 0.04,
        riskPerTrade: 0.02
      },
      capitalLimits: {
        min: 1000,
        max: 10000000,
        default: 100000
      },
      marketSimulation: {
        slippage: 0.001,
        latency: 50,
        marketImpact: 0.0005,
        executionProbability: 0.98
      }
    };

    res.json({
      success: true,
      config
    });
  } catch (error) {
    logger.error('Error fetching paper trading config:', error);
    res.status(500).json({
      error: 'Failed to fetch paper trading config',
      details: error.message
    });
  }
});

/**
 * Get WebSocket events information
 * GET /api/paper-trading/ws-events
 */
router.get('/ws-events', authenticateToken, async (req, res) => {
  try {
    const events = [
      {
        name: 'sessionCreated',
        description: 'Emitted when a new paper trading session is created',
        payload: 'session object'
      },
      {
        name: 'sessionStarted',
        description: 'Emitted when a paper trading session starts',
        payload: 'session object'
      },
      {
        name: 'sessionStopped',
        description: 'Emitted when a paper trading session stops',
        payload: 'session object'
      },
      {
        name: 'sessionUpdate',
        description: 'Emitted when session values are updated',
        payload: '{ sessionId, currentValue, unrealizedPnl, positions }'
      },
      {
        name: 'positionOpened',
        description: 'Emitted when a new position is opened',
        payload: '{ sessionId, position, signal }'
      },
      {
        name: 'positionClosed',
        description: 'Emitted when a position is closed',
        payload: '{ sessionId, position, reason, realizedPnl }'
      }
    ];

    res.json({
      success: true,
      events,
      usage: 'Connect to the main WebSocket server and listen for these events'
    });
  } catch (error) {
    logger.error('Error fetching WebSocket events:', error);
    res.status(500).json({
      error: 'Failed to fetch WebSocket events',
      details: error.message
    });
  }
});

export default router;