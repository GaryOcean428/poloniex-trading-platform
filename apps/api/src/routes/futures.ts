import express, { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// =================== PUBLIC ENDPOINTS ===================

/**
 * GET /api/futures/health - Health check for Poloniex Futures v3 service
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const health = await poloniexFuturesService.healthCheck();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  } catch (error: any) {
    res.status(503).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString(),
      service: 'PoloniexFuturesService'
    });
  }
});

/**
 * GET /api/futures/products - Get all futures products
 */
router.get('/products', async (req: Request, res: Response) => {
  try {
    const products = await poloniexFuturesService.getProducts();
    res.json(products);
  } catch (error: any) {
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
router.get('/products/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const product = await poloniexFuturesService.getProduct(symbol);
    res.json(product);
  } catch (error: any) {
    logger.error(`Error fetching product ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch product information',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/ticker - Get market ticker(s)
 * Query params: ?symbol=BTC_USDT_PERP (optional, if not provided returns all tickers)
 */
router.get('/ticker', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.query;
    const tickers = await poloniexFuturesService.getTickers(symbol as string | undefined);
    res.json(tickers);
  } catch (error: any) {
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
router.get('/orderbook/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const { depth = '20' } = req.query;
    const orderbook = await poloniexFuturesService.getOrderBook(symbol, parseInt(depth as string));
    res.json(orderbook);
  } catch (error: any) {
    logger.error(`Error fetching orderbook for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch order book',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/klines/:symbol - Get K-line/candlestick data
 */
router.get('/klines/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const { interval = '1h', limit = '100' } = req.query;
    
    // Convert interval to Poloniex format (MINUTE_1, HOUR_1, etc.)
    const intervalMap: Record<string, string> = {
      '1m': 'MINUTE_1',
      '5m': 'MINUTE_5',
      '15m': 'MINUTE_15',
      '30m': 'MINUTE_30',
      '1h': 'HOUR_1',
      '2h': 'HOUR_2',
      '4h': 'HOUR_4',
      '12h': 'HOUR_12',
      '1d': 'DAY_1',
      '3d': 'DAY_3',
      '1w': 'WEEK_1'
    };
    
    const poloniexInterval = intervalMap[interval as string] || 'HOUR_1'; // Default to 1h
    const klines = await poloniexFuturesService.getKlines(symbol, poloniexInterval, { limit: parseInt(limit as string) });
    res.json(klines);
  } catch (error: any) {
    logger.error(`Error fetching klines for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch kline data',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/trades/:symbol - Get recent public trades for symbol
 */
router.get('/trades/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const { limit = '50' } = req.query;
    const trades = await poloniexFuturesService.getMarketTrades(symbol);
    res.json(trades);
  } catch (error: any) {
    logger.error(`Error fetching trades for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch recent trades',
      details: error.response?.data || error.message
    });
  }
});

// =================== AUTHENTICATED ENDPOINTS ===================

/**
 * GET /api/futures/balance - Get account balance
 */
router.get('/balance', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const balance = await poloniexFuturesService.getAccountBalance(credentials);
    res.json(balance);
  } catch (error: any) {
    logger.error('Error fetching account balance:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch account balance',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/positions - Get all positions
 */
router.get('/positions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const positions = await poloniexFuturesService.getPositions(credentials);
    res.json(positions);
  } catch (error: any) {
    logger.error('Error fetching positions:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch positions',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/trades - Get user's trade history
 * Query params: symbol, orderId, startTime, endTime, limit
 */
router.get('/trades', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const params = req.query; // symbol, orderId, startTime, endTime, limit
    const trades = await poloniexFuturesService.getExecutionDetails(credentials, params);
    res.json(trades);
  } catch (error: any) {
    logger.error('Error fetching trade history:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch trade history',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/orders - Get current orders
 */
router.get('/orders', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const params = req.query; // symbol, status
    const orders = await poloniexFuturesService.getCurrentOrders(credentials, params);
    res.json(orders);
  } catch (error: any) {
    logger.error('Error fetching orders:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch orders',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/futures/order - Place a new order
 */
router.post('/order', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const orderParams = req.body;
    
    // Validate required fields
    if (!orderParams.symbol || !orderParams.side || !orderParams.type) {
      return res.status(400).json({
        error: 'Missing required order parameters: symbol, side, type'
      });
    }

    const order = await poloniexFuturesService.placeOrder(credentials, orderParams);

    res.json(order);
  } catch (error: any) {
    logger.error('Error placing order:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to place order',
      details: error.response?.data || error.message
    });
  }
});

/**
 * DELETE /api/futures/order/:orderId - Cancel an order
 */
router.delete('/order/:orderId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { orderId } = req.params;
    const { symbol } = req.query;

    if (!symbol) {
      return res.status(400).json({
        error: 'Symbol is required to cancel an order'
      });
    }

    const result = await poloniexFuturesService.cancelOrder(credentials, orderId, symbol as string);
    res.json(result);
  } catch (error: any) {
    logger.error('Error canceling order:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to cancel order',
      details: error.response?.data || error.message
    });
  }
});

/**
 * DELETE /api/futures/orders - Cancel all orders for a symbol
 */
router.delete('/orders', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { symbol } = req.query;

    if (!symbol) {
      return res.status(400).json({
        error: 'Symbol is required to cancel all orders'
      });
    }

    const result = await poloniexFuturesService.cancelAllOrders(credentials, symbol as string);
    res.json(result);
  } catch (error: any) {
    logger.error('Error canceling all orders:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to cancel all orders',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/leverage/:symbol - Get leverage for symbol
 */
router.get('/leverage/:symbol', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { symbol } = req.params;
    const leverage = await poloniexFuturesService.getLeverages(credentials, symbol);
    res.json(leverage);
  } catch (error: any) {
    logger.error('Error fetching leverage:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch leverage',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/futures/leverage - Set leverage for symbol
 */
router.post('/leverage', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
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

    const result = await poloniexFuturesService.setLeverage(credentials, symbol, leverage);
    res.json(result);
  } catch (error: any) {
    logger.error('Error setting leverage:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to set leverage',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/futures/position/close - Close position at market price
 */
router.post('/position/close', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { symbol, type } = req.body;

    if (!symbol || !type) {
      return res.status(400).json({
        error: 'Symbol and type (close_long or close_short) are required'
      });
    }

    if (type !== 'close_long' && type !== 'close_short') {
      return res.status(400).json({
        error: 'Type must be either close_long or close_short'
      });
    }

    const result = await poloniexFuturesService.closePosition(credentials, symbol, type);
    res.json(result);
  } catch (error: any) {
    logger.error('Error closing position:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to close position',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/futures/positions/close-all - Close all positions at market price
 */
router.post('/positions/close-all', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const result = await poloniexFuturesService.closeAllPositions(credentials);
    res.json(result);
  } catch (error: any) {
    logger.error('Error closing all positions:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to close all positions',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/position-mode/:symbol - Get position mode
 */
router.get('/position-mode/:symbol', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { symbol } = req.params;
    const mode = await poloniexFuturesService.getPositionMode(credentials, symbol);
    res.json(mode);
  } catch (error: any) {
    logger.error('Error fetching position mode:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch position mode',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/futures/position-mode - Switch position mode
 */
router.post('/position-mode', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { symbol, mode } = req.body;

    if (!symbol || !mode) {
      return res.status(400).json({
        error: 'Symbol and mode are required'
      });
    }

    if (mode !== 'ISOLATED' && mode !== 'CROSS') {
      return res.status(400).json({
        error: 'Mode must be either ISOLATED or CROSS'
      });
    }

    const result = await poloniexFuturesService.switchPositionMode(credentials, symbol, mode);
    res.json(result);
  } catch (error: any) {
    logger.error('Error switching position mode:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to switch position mode',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/futures/position/margin - Adjust margin for isolated margin position
 */
router.post('/position/margin', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { symbol, amount, type } = req.body;

    if (!symbol || !amount || !type) {
      return res.status(400).json({
        error: 'Symbol, amount, and type (ADD or REDUCE) are required'
      });
    }

    if (type !== 'ADD' && type !== 'REDUCE') {
      return res.status(400).json({
        error: 'Type must be either ADD or REDUCE'
      });
    }

    const result = await poloniexFuturesService.adjustMargin(credentials, symbol, amount, type);
    res.json(result);
  } catch (error: any) {
    logger.error('Error adjusting margin:', error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to adjust margin',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/mark-price/:symbol - Get mark price for symbol
 */
router.get('/mark-price/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const markPrice = await poloniexFuturesService.getMarkPrice(symbol);
    res.json(markPrice);
  } catch (error: any) {
    logger.error(`Error fetching mark price for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch mark price',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/index-price/:symbol - Get index price for symbol
 */
router.get('/index-price/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const indexPrice = await poloniexFuturesService.getIndexPrice(symbol);
    res.json(indexPrice);
  } catch (error: any) {
    logger.error(`Error fetching index price for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch index price',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/index-price-components/:symbol - Get index price components
 */
router.get('/index-price-components/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const components = await poloniexFuturesService.getIndexPriceComponents(symbol);
    res.json(components);
  } catch (error: any) {
    logger.error(`Error fetching index price components for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch index price components',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/funding-rate/:symbol - Get current funding rate
 */
router.get('/funding-rate/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const fundingRate = await poloniexFuturesService.getFundingRate(symbol);
    res.json(fundingRate);
  } catch (error: any) {
    logger.error(`Error fetching funding rate for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch funding rate',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/funding-rate-history/:symbol - Get historical funding rates
 */
router.get('/funding-rate-history/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const params = req.query;
    const history = await poloniexFuturesService.getFundingRateHistory(symbol, params);
    res.json(history);
  } catch (error: any) {
    logger.error(`Error fetching funding rate history for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch funding rate history',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/open-interest/:symbol - Get open interest
 */
router.get('/open-interest/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const openInterest = await poloniexFuturesService.getOpenInterest(symbol);
    res.json(openInterest);
  } catch (error: any) {
    logger.error(`Error fetching open interest for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch open interest',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/risk-limit/:symbol - Get risk limit information
 */
router.get('/risk-limit/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const riskLimit = await poloniexFuturesService.getRiskLimit(symbol);
    res.json(riskLimit);
  } catch (error: any) {
    logger.error(`Error fetching risk limit for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch risk limit',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/user-risk-limit/:symbol - Get user position risk limit
 */
router.get('/user-risk-limit/:symbol', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const { symbol } = req.params;
    const userRiskLimit = await poloniexFuturesService.getUserRiskLimit(credentials, symbol);
    res.json(userRiskLimit);
  } catch (error: any) {
    logger.error(`Error fetching user risk limit for ${req.params.symbol}:`, error);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch user risk limit',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/insurance-fund - Get insurance fund information
 */
router.get('/insurance-fund', async (req: Request, res: Response) => {
  try {
    const insuranceFund = await poloniexFuturesService.getInsuranceFund();
    res.json(insuranceFund);
  } catch (error: any) {
    logger.error('Error fetching insurance fund:', error);
    res.status(500).json({
      error: 'Failed to fetch insurance fund information',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/market-info - Get market information
 * Query params: ?symbol=BTC_USDT_PERP (optional)
 */
router.get('/market-info', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.query;
    const marketInfo = await poloniexFuturesService.getMarketInfo(symbol as string | undefined);
    res.json(marketInfo);
  } catch (error: any) {
    logger.error('Error fetching market info:', error);
    res.status(500).json({
      error: 'Failed to fetch market information',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/futures/limit-price/:symbol - Get market limit price
 */
router.get('/limit-price/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const limitPrice = await poloniexFuturesService.getMarketLimitPrice(symbol);
    res.json(limitPrice);
  } catch (error: any) {
    logger.error(`Error fetching limit price for ${req.params.symbol}:`, error);
    res.status(500).json({
      error: 'Failed to fetch limit price',
      details: error.response?.data || error.message
    });
  }
});

export default router;
