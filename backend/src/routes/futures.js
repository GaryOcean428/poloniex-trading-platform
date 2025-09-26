import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { UserService } from '../services/userService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// =================== PUBLIC ENDPOINTS ===================

/**
 * GET /api/futures - Root endpoint listing available futures endpoints
 */
router.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'futures',
    description: 'Poloniex Futures v3 API Integration',
    endpoints: {
      public: [
        'GET /api/futures/health - Service health check',
        'GET /api/futures/products - Get all futures products',
        'GET /api/futures/products/:symbol - Get specific product info',
        'GET /api/futures/tickers - Get market tickers',
        'GET /api/futures/orderbook/:symbol - Get order book',
        'GET /api/futures/klines/:symbol - Get K-line data', 
        'GET /api/futures/funding/:symbol - Get funding rate'
      ],
      authenticated: [
        'GET /api/futures/account/balance - Get account balance',
        'GET /api/futures/positions - Get current positions',
        'GET /api/futures/orders - Get current orders',
        'POST /api/futures/orders - Place new order',
        'DELETE /api/futures/orders - Cancel order',
        'DELETE /api/futures/orders/all - Cancel all orders',
        'POST /api/futures/positions/leverage - Set leverage'
      ]
    }
  });
});

/**
 * GET /api/futures/health - Health check for futures service
 */
router.get('/health', async (req, res) => {
  try {
    const health = await poloniexFuturesService.healthCheck();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString(),
      service: 'PoloniexFuturesService'
    });
  }
});

/**
 * GET /api/futures/data - Legacy endpoint for compatibility
 */
router.get('/data', (req, res) => {
  res.json({
    status: 'ok',
    data: [],
    message: 'Use /api/futures/products for product data',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/futures/products - Get all futures products
 */
router.get('/products', async (req, res) => {
  try {
    const products = await poloniexFuturesService.getProducts();
    res.json(products);
  } catch (error) {
    logger.error('Error fetching futures products:', error);
    res.status(500).json({
      error: 'Failed to fetch futures products',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/products/:symbol - Get specific product info
 */
router.get('/products/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const product = await poloniexFuturesService.getProduct(symbol);
    res.json(product);
  } catch (error) {
    logger.error(`Error fetching product ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch product information',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/tickers - Get market tickers
 */
router.get('/tickers', async (req, res) => {
  try {
    const { symbol } = req.query;
    const tickers = await poloniexFuturesService.getTicker(symbol);
    res.json(tickers);
  } catch (error) {
    logger.error('Error fetching tickers:', error);
    res.status(500).json({
      error: 'Failed to fetch tickers',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/orderbook/:symbol - Get order book for symbol
 */
router.get('/orderbook/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { depth = 20 } = req.query;
    const orderbook = await poloniexFuturesService.getOrderBook(symbol, parseInt(depth));
    res.json(orderbook);
  } catch (error) {
    logger.error(`Error fetching orderbook for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch order book',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/klines/:symbol - Get K-line data
 */
router.get('/klines/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { granularity, ...params } = req.query;
    const klines = await poloniexFuturesService.getKlines(symbol, granularity, params);
    res.json(klines);
  } catch (error) {
    logger.error(`Error fetching klines for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch K-line data',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/funding/:symbol - Get current funding rate
 */
router.get('/funding/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const funding = await poloniexFuturesService.getFundingRate(symbol);
    res.json(funding);
  } catch (error) {
    logger.error(`Error fetching funding rate for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch funding rate',
      details: error.response?.data || error.message
    });
  }
});

// =================== AUTHENTICATED ENDPOINTS ===================

/**
 * GET /api/futures/account/balance - Get account balance
 */
router.get('/account/balance', authenticateToken, async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const balance = await poloniexFuturesService.getAccountBalance(credentials);
    res.json(balance);
  } catch (error) {
    logger.error('Error fetching account balance:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch account balance',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/positions - Get current positions
 */
router.get('/positions', authenticateToken, async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { symbol } = req.query;
    const positions = await poloniexFuturesService.getPositions(credentials, symbol);
    res.json(positions);
  } catch (error) {
    logger.error('Error fetching positions:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch positions',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/orders - Get current orders
 */
router.get('/orders', authenticateToken, async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { symbol } = req.query;
    const orders = await poloniexFuturesService.getOpenOrders(credentials, { symbol });
    res.json(orders);
  } catch (error) {
    logger.error('Error fetching orders:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch orders',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/futures/orders - Place a new order
 */
router.post('/orders', authenticateToken, async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    // Validate order data
    poloniexFuturesService.validateOrderData(req.body);

    const order = await poloniexFuturesService.placeOrder(credentials, req.body);
    
    // Store in database for tracking
    await poloniexFuturesService.storeOrderInDatabase(req.user.id, req.body, order);
    
    res.json(order);
  } catch (error) {
    logger.error('Error placing order:', error);
    res.status(error.response?.status || 400).json({
      error: 'Failed to place order',
      details: error.response?.data || error.message
    });
  }
});

/**
 * DELETE /api/futures/orders - Cancel an order
 */
router.delete('/orders', authenticateToken, async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({
        error: 'orderId is required'
      });
    }

    const result = await poloniexFuturesService.cancelOrder(credentials, orderId);
    res.json(result);
  } catch (error) {
    logger.error('Error canceling order:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to cancel order',
      details: error.response?.data || error.message
    });
  }
});

/**
 * DELETE /api/futures/orders/all - Cancel all orders
 */
router.delete('/orders/all', authenticateToken, async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { symbol } = req.query;
    const result = await poloniexFuturesService.cancelAllOrders(credentials, symbol);
    res.json(result);
  } catch (error) {
    logger.error('Error canceling all orders:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to cancel all orders',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/futures/positions/leverage - Set leverage
 */
router.post('/positions/leverage', authenticateToken, async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { symbol, leverage } = req.body;
    if (!symbol || !leverage) {
      return res.status(400).json({
        error: 'Symbol and leverage are required'
      });
    }

    const result = await poloniexFuturesService.modifyLeverage(credentials, symbol, leverage);
    res.json(result);
  } catch (error) {
    logger.error('Error setting leverage:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to set leverage',
      details: error.response?.data || error.message
    });
  }
});

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

  if (error.response?.status === 401) {
    return res.status(401).json({
      error: 'Invalid API credentials',
      requiresApiKeys: true
    });
  }

  return res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

export default router;