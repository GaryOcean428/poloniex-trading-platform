import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { UserService } from '../services/userService.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import automatedTradingService from '../services/automatedTradingService.js';
import futuresWebSocket from '../websocket/futuresWebSocket.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// All futures routes require authentication
router.use(authenticateToken);

/**
 * Middleware to get user credentials
 */
async function getUserCredentials(req, res, next) {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id, 'poloniex');
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No Poloniex API credentials found. Please add your API keys first.',
        requiresApiKeys: true
      });
    }
    
    req.credentials = credentials;
    next();
  } catch (error) {
    logger.error('Failed to get user credentials:', error);
    res.status(500).json({
      error: 'Failed to retrieve API credentials',
      details: error.message
    });
  }
}

// Apply credentials middleware to all routes
router.use(getUserCredentials);

// =================== ACCOUNT ENDPOINTS ===================

/**
 * GET /api/futures/account/balance - Get futures account balance
 */
router.get('/account/balance', async (req, res) => {
  try {
    const balance = await poloniexFuturesService.getAccountBalance(req.credentials);
    
    // Sync to database
    await poloniexFuturesService.syncAccountToDatabase(req.user.id, req.credentials);
    
    res.json(balance);
  } catch (error) {
    logger.error('Failed to get account balance:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch account balance',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/account/overview - Get account overview
 */
router.get('/account/overview', async (req, res) => {
  try {
    const overview = await poloniexFuturesService.getAccountOverview(req.credentials);
    res.json(overview);
  } catch (error) {
    logger.error('Failed to get account overview:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch account overview',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/account/bills - Get account bills (transaction history)
 */
router.get('/account/bills', async (req, res) => {
  try {
    const bills = await poloniexFuturesService.getAccountBills(req.credentials, req.query);
    res.json(bills);
  } catch (error) {
    logger.error('Failed to get account bills:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch account bills',
      details: error.response?.data || error.message
    });
  }
});

// =================== POSITION ENDPOINTS ===================

/**
 * GET /api/futures/positions - Get current positions
 */
router.get('/positions', async (req, res) => {
  try {
    const positions = await poloniexFuturesService.getPositions(req.credentials, req.query.symbol);
    
    // Sync to database
    await poloniexFuturesService.syncPositionsToDatabase(req.user.id, req.credentials);
    
    res.json(positions);
  } catch (error) {
    logger.error('Failed to get positions:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch positions',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/positions/history - Get position history
 */
router.get('/positions/history', async (req, res) => {
  try {
    const history = await poloniexFuturesService.getPositionHistory(req.credentials, req.query);
    res.json(history);
  } catch (error) {
    logger.error('Failed to get position history:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch position history',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/futures/position/leverage - Modify position leverage
 */
router.post('/position/leverage', async (req, res) => {
  try {
    const { symbol, leverage } = req.body;
    
    if (!symbol || !leverage) {
      return res.status(400).json({
        error: 'Symbol and leverage are required'
      });
    }
    
    const result = await poloniexFuturesService.modifyLeverage(req.credentials, symbol, leverage);
    
    // Log the action
    await UserService.logSecurityEvent({
      userId: req.user.id,
      eventType: 'leverage_modified',
      eventDescription: `Leverage modified for ${symbol} to ${leverage}x`,
      severity: 'info',
      metadata: { symbol, leverage }
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Failed to modify leverage:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to modify leverage',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/futures/position/mode - Set position mode
 */
router.post('/position/mode', async (req, res) => {
  try {
    const { mode } = req.body;
    
    if (!mode || !['ONE_WAY', 'HEDGE'].includes(mode)) {
      return res.status(400).json({
        error: 'Valid mode is required (ONE_WAY or HEDGE)'
      });
    }
    
    const result = await poloniexFuturesService.setPositionMode(req.credentials, mode);
    
    // Log the action
    await UserService.logSecurityEvent({
      userId: req.user.id,
      eventType: 'position_mode_changed',
      eventDescription: `Position mode changed to ${mode}`,
      severity: 'info',
      metadata: { mode }
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Failed to set position mode:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to set position mode',
      details: error.response?.data || error.message
    });
  }
});

// =================== ORDER ENDPOINTS ===================

/**
 * POST /api/futures/orders - Place a futures order
 */
router.post('/orders', async (req, res) => {
  try {
    // Validate order data
    poloniexFuturesService.validateOrderData(req.body);
    
    // Check trading permissions
    if (!req.credentials.permissions?.trade) {
      return res.status(403).json({
        error: 'Trading permission not enabled for your API credentials',
        requiresTradingPermission: true
      });
    }
    
    const result = await poloniexFuturesService.placeOrder(req.credentials, req.body);
    
    // Store order in database
    await poloniexFuturesService.storeOrderInDatabase(req.user.id, req.body, result);
    
    // Log the action
    await UserService.logSecurityEvent({
      userId: req.user.id,
      eventType: 'futures_order_placed',
      eventDescription: `Futures order placed: ${req.body.side} ${req.body.size} ${req.body.symbol}`,
      severity: 'info',
      metadata: {
        ...req.body,
        orderId: result.orderId
      }
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Failed to place futures order:', error);
    
    // Log failed order attempt
    await UserService.logSecurityEvent({
      userId: req.user.id,
      eventType: 'futures_order_failed',
      eventDescription: `Futures order failed: ${error.message}`,
      severity: 'warning',
      metadata: {
        requestBody: req.body,
        error: error.response?.data || error.message
      }
    });
    
    res.status(error.response?.status || 500).json({
      error: 'Failed to place futures order',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/orders - Get open orders
 */
router.get('/orders', async (req, res) => {
  try {
    const orders = await poloniexFuturesService.getOpenOrders(req.credentials, req.query);
    res.json(orders);
  } catch (error) {
    logger.error('Failed to get open orders:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch open orders',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/orders/history - Get order history
 */
router.get('/orders/history', async (req, res) => {
  try {
    const history = await poloniexFuturesService.getOrderHistory(req.credentials, req.query);
    res.json(history);
  } catch (error) {
    logger.error('Failed to get order history:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch order history',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/orders/:orderId - Get order details
 */
router.get('/orders/:orderId', async (req, res) => {
  try {
    const order = await poloniexFuturesService.getOrder(req.credentials, req.params.orderId);
    res.json(order);
  } catch (error) {
    logger.error('Failed to get order details:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch order details',
      details: error.response?.data || error.message
    });
  }
});

/**
 * DELETE /api/futures/orders/:orderId - Cancel an order
 */
router.delete('/orders/:orderId', async (req, res) => {
  try {
    const result = await poloniexFuturesService.cancelOrder(req.credentials, req.params.orderId);
    
    // Log the action
    await UserService.logSecurityEvent({
      userId: req.user.id,
      eventType: 'futures_order_cancelled',
      eventDescription: `Futures order cancelled: ${req.params.orderId}`,
      severity: 'info',
      metadata: { orderId: req.params.orderId }
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Failed to cancel order:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to cancel order',
      details: error.response?.data || error.message
    });
  }
});

/**
 * DELETE /api/futures/orders - Cancel all orders
 */
router.delete('/orders', async (req, res) => {
  try {
    const result = await poloniexFuturesService.cancelAllOrders(req.credentials, req.query.symbol);
    
    // Log the action
    await UserService.logSecurityEvent({
      userId: req.user.id,
      eventType: 'futures_orders_cancelled_all',
      eventDescription: `All futures orders cancelled${req.query.symbol ? ` for ${req.query.symbol}` : ''}`,
      severity: 'warning',
      metadata: { symbol: req.query.symbol }
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Failed to cancel all orders:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to cancel all orders',
      details: error.response?.data || error.message
    });
  }
});

// =================== TRADE ENDPOINTS ===================

/**
 * GET /api/futures/trades - Get trade history
 */
router.get('/trades', async (req, res) => {
  try {
    const trades = await poloniexFuturesService.getTradeHistory(req.credentials, req.query);
    res.json(trades);
  } catch (error) {
    logger.error('Failed to get trade history:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch trade history',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/trades/recent - Get recent trades
 */
router.get('/trades/recent', async (req, res) => {
  try {
    const trades = await poloniexFuturesService.getRecentTrades(req.credentials, req.query);
    res.json(trades);
  } catch (error) {
    logger.error('Failed to get recent trades:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch recent trades',
      details: error.response?.data || error.message
    });
  }
});

// =================== MARKET DATA ENDPOINTS ===================

/**
 * GET /api/futures/market/products - Get all futures products
 */
router.get('/market/products', async (req, res) => {
  try {
    const products = await poloniexFuturesService.getProducts();
    res.json(products);
  } catch (error) {
    logger.error('Failed to get futures products:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch futures products',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/market/ticker/:symbol? - Get ticker data
 */
router.get('/market/ticker/:symbol?', async (req, res) => {
  try {
    const ticker = await poloniexFuturesService.getTicker(req.params.symbol);
    res.json(ticker);
  } catch (error) {
    logger.error('Failed to get ticker:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch ticker data',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/market/orderbook/:symbol - Get order book
 */
router.get('/market/orderbook/:symbol', async (req, res) => {
  try {
    const depth = req.query.depth || 20;
    const orderbook = await poloniexFuturesService.getOrderBook(req.params.symbol, depth);
    res.json(orderbook);
  } catch (error) {
    logger.error('Failed to get order book:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch order book',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/market/klines/:symbol - Get kline data
 */
router.get('/market/klines/:symbol', async (req, res) => {
  try {
    const { granularity } = req.query;
    
    if (!granularity) {
      return res.status(400).json({
        error: 'Granularity parameter is required'
      });
    }
    
    const klines = await poloniexFuturesService.getKlines(req.params.symbol, granularity, req.query);
    res.json(klines);
  } catch (error) {
    logger.error('Failed to get klines:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch kline data',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/market/funding-rate/:symbol - Get funding rate
 */
router.get('/market/funding-rate/:symbol', async (req, res) => {
  try {
    const fundingRate = await poloniexFuturesService.getFundingRate(req.params.symbol);
    res.json(fundingRate);
  } catch (error) {
    logger.error('Failed to get funding rate:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch funding rate',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/market/open-interest/:symbol - Get open interest
 */
router.get('/market/open-interest/:symbol', async (req, res) => {
  try {
    const openInterest = await poloniexFuturesService.getOpenInterest(req.params.symbol);
    res.json(openInterest);
  } catch (error) {
    logger.error('Failed to get open interest:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch open interest',
      details: error.response?.data || error.message
    });
  }
});

// =================== RISK MANAGEMENT ENDPOINTS ===================

/**
 * GET /api/futures/risk/limits/:symbol - Get risk limits
 */
router.get('/risk/limits/:symbol', async (req, res) => {
  try {
    const limits = await poloniexFuturesService.getRiskLimit(req.credentials, req.params.symbol);
    res.json(limits);
  } catch (error) {
    logger.error('Failed to get risk limits:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch risk limits',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/futures/risk/limits - Update risk limits
 */
router.post('/risk/limits', async (req, res) => {
  try {
    const { symbol, level } = req.body;
    
    if (!symbol || !level) {
      return res.status(400).json({
        error: 'Symbol and level are required'
      });
    }
    
    const result = await poloniexFuturesService.updateRiskLimit(req.credentials, symbol, level);
    
    // Log the action
    await UserService.logSecurityEvent({
      userId: req.user.id,
      eventType: 'risk_limit_updated',
      eventDescription: `Risk limit updated for ${symbol} to level ${level}`,
      severity: 'info',
      metadata: { symbol, level }
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Failed to update risk limits:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to update risk limits',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/risk/adl - Get ADL status
 */
router.get('/risk/adl', async (req, res) => {
  try {
    const adlStatus = await poloniexFuturesService.getADLStatus(req.credentials);
    res.json(adlStatus);
  } catch (error) {
    logger.error('Failed to get ADL status:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch ADL status',
      details: error.response?.data || error.message
    });
  }
});

// =================== AUTOMATED TRADING ENDPOINTS ===================

/**
 * POST /api/futures/strategy/register - Register automated trading strategy
 */
router.post('/strategy/register', async (req, res) => {
  try {
    const strategyConfig = {
      id: req.body.id || `strategy_${Date.now()}`,
      name: req.body.name,
      type: req.body.type,
      symbol: req.body.symbol,
      accountId: req.body.accountId,
      parameters: req.body.parameters,
      isActive: req.body.isActive !== false
    };
    
    const result = await automatedTradingService.registerStrategy(req.user.id, strategyConfig);
    
    // Log the action
    await UserService.logSecurityEvent({
      userId: req.user.id,
      eventType: 'strategy_registered',
      eventDescription: `Strategy registered: ${strategyConfig.name}`,
      severity: 'info',
      metadata: strategyConfig
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Failed to register strategy:', error);
    res.status(500).json({
      error: 'Failed to register strategy',
      details: error.message
    });
  }
});

/**
 * POST /api/futures/strategy/deactivate - Deactivate strategy
 */
router.post('/strategy/deactivate', async (req, res) => {
  try {
    const { strategyType, symbol } = req.body;
    
    if (!strategyType || !symbol) {
      return res.status(400).json({
        error: 'Strategy type and symbol are required'
      });
    }
    
    const result = automatedTradingService.deactivateStrategy(req.user.id, strategyType, symbol);
    
    // Log the action
    await UserService.logSecurityEvent({
      userId: req.user.id,
      eventType: 'strategy_deactivated',
      eventDescription: `Strategy deactivated: ${strategyType} for ${symbol}`,
      severity: 'info',
      metadata: { strategyType, symbol }
    });
    
    res.json({ success: result });
  } catch (error) {
    logger.error('Failed to deactivate strategy:', error);
    res.status(500).json({
      error: 'Failed to deactivate strategy',
      details: error.message
    });
  }
});

/**
 * GET /api/futures/strategy/status - Get strategy status
 */
router.get('/strategy/status', async (req, res) => {
  try {
    const status = automatedTradingService.getStatus();
    res.json(status);
  } catch (error) {
    logger.error('Failed to get strategy status:', error);
    res.status(500).json({
      error: 'Failed to get strategy status',
      details: error.message
    });
  }
});

// =================== WEBSOCKET ENDPOINTS ===================

/**
 * POST /api/futures/websocket/connect - Connect to WebSocket
 */
router.post('/websocket/connect', async (req, res) => {
  try {
    // Connect to public WebSocket
    await futuresWebSocket.connectPublic();
    
    // Connect to private WebSocket with user credentials
    await futuresWebSocket.connectPrivate(req.credentials);
    
    res.json({ 
      success: true, 
      message: 'WebSocket connections established' 
    });
  } catch (error) {
    logger.error('Failed to connect WebSocket:', error);
    res.status(500).json({
      error: 'Failed to connect WebSocket',
      details: error.message
    });
  }
});

/**
 * POST /api/futures/websocket/subscribe - Subscribe to market data
 */
router.post('/websocket/subscribe', async (req, res) => {
  try {
    const { symbol, channels } = req.body;
    
    if (!symbol) {
      return res.status(400).json({
        error: 'Symbol is required'
      });
    }
    
    futuresWebSocket.subscribeToMarketData(symbol, channels);
    
    res.json({ 
      success: true, 
      message: `Subscribed to ${symbol}` 
    });
  } catch (error) {
    logger.error('Failed to subscribe to WebSocket:', error);
    res.status(500).json({
      error: 'Failed to subscribe to WebSocket',
      details: error.message
    });
  }
});

/**
 * GET /api/futures/websocket/status - Get WebSocket status
 */
router.get('/websocket/status', async (req, res) => {
  try {
    const status = futuresWebSocket.getConnectionStatus();
    res.json(status);
  } catch (error) {
    logger.error('Failed to get WebSocket status:', error);
    res.status(500).json({
      error: 'Failed to get WebSocket status',
      details: error.message
    });
  }
});

// =================== HEALTH CHECK ENDPOINT ===================

/**
 * GET /api/futures/health - Service health check
 */
router.get('/health', async (req, res) => {
  try {
    const poloniexHealth = await poloniexFuturesService.healthCheck();
    const websocketHealth = futuresWebSocket.healthCheck();
    const tradingServiceHealth = automatedTradingService.getStatus();
    
    const overallHealth = {
      status: poloniexHealth.status === 'healthy' && websocketHealth.healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        poloniex: poloniexHealth,
        websocket: websocketHealth,
        trading: tradingServiceHealth
      }
    };
    
    res.json(overallHealth);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// =================== ERROR HANDLING ===================

/**
 * Error handling middleware
 */
router.use((error, req, res, next) => {
  logger.error('Futures route error:', error);
  
  if (error.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: 'Poloniex Futures API is currently unavailable'
    });
  }
  
  if (error.code === 'ETIMEDOUT') {
    return res.status(504).json({
      error: 'Request to Poloniex Futures API timed out'
    });
  }
  
  res.status(500).json({
    error: 'Internal futures service error',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

export default router;