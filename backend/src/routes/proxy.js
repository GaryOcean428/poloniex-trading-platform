import axios from 'axios';
import crypto from 'crypto';
import express from 'express';
import { URLSearchParams } from 'url';
import { authenticateToken } from '../middleware/auth.js';
import { UserService } from '../services/userService.js';

const router = express.Router();

// DEPRECATED: This proxy is for legacy spot trading compatibility
// For futures trading, use the dedicated /api/futures routes which implement v3 API properly
const POLONIEX_PUBLIC_URL = 'https://api.poloniex.com';
const POLONIEX_PRIVATE_URL = 'https://api.poloniex.com';

/**
 * Generate HMAC signature for Poloniex v3 API
 * Updated for proper v3 futures API authentication
 */
function generateSignature(method, requestPath, body, timestamp, apiSecret) {
  try {
    // Use v3 API signature format: METHOD\n + PATH\n + BODY + timestamp
    const bodyStr = body ? JSON.stringify(body) : '';
    const message = `${method.toUpperCase()}\n${requestPath}\n${bodyStr}${timestamp}`;

    return crypto
      .createHmac('sha256', apiSecret)
      .update(message)
      .digest('base64');
  } catch (error) {
    console.error('Error generating signature:', error);
    throw new Error('Failed to generate API signature');
  }
}

/**
 * Make authenticated request to Poloniex v3 API
 * Updated for proper v3 authentication headers
 */
async function makeAuthenticatedRequest(credentials, method, endpoint, body = null, params = {}) {
  try {
    const timestamp = Date.now().toString();
    
    // Build v3 API path
    const requestPath = endpoint.startsWith('/v3') ? endpoint : `/v3${endpoint}`;
    const url = `${POLONIEX_PRIVATE_URL}${requestPath}`;

    // Generate query string if params exist
    const queryString = Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';

    const fullRequestPath = requestPath + queryString;
    const fullUrl = url + queryString;
    const signature = generateSignature(method, fullRequestPath, body, timestamp, credentials.apiSecret);

    // Use proper v3 API headers
    const headers = {
      'Content-Type': 'application/json',
      'key': credentials.apiKey,
      'signature': signature,
      'signTimestamp': timestamp,
      'signatureMethod': 'HmacSHA256',
      'signatureVersion': '2'
    };

    const config = {
      method: method.toLowerCase(),
      url: fullUrl,
      headers,
      timeout: 30000, // 30 second timeout
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      config.data = body;
    }

    if (Object.keys(params).length > 0 && method === 'GET') {
      config.params = params;
    }

    console.log(`Making authenticated v3 ${method} request to ${requestPath}`);
    const response = await axios(config);

    return response;
  } catch (error) {
    console.error('Authenticated request error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Make public request to Poloniex API (no authentication required)
 */
async function makePublicRequest(method, endpoint, params = {}) {
  try {
    const url = `${POLONIEX_PUBLIC_URL}${endpoint}`;

    const config = {
      method: method.toLowerCase(),
      url,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000,
    };

    if (Object.keys(params).length > 0) {
      config.params = params;
    }

    console.log(`Making public ${method} request to ${endpoint}`);
    const response = await axios(config);

    return response;
  } catch (error) {
    console.error('Public request error:', error.response?.data || error.message);
    throw error;
  }
}

// =================== PUBLIC ENDPOINTS ===================

// DEPRECATION NOTICE: For futures trading, use /api/futures/* endpoints instead
router.get('/deprecation-notice', (req, res) => {
  res.json({
    notice: 'DEPRECATED: These proxy routes are for legacy spot trading compatibility only.',
    recommendation: 'For futures trading, use the dedicated /api/futures/* routes which implement Poloniex v3 API properly.',
    futuresEndpoints: {
      products: 'GET /api/futures/products',
      tickers: 'GET /api/futures/tickers',
      orderbook: 'GET /api/futures/orderbook/:symbol',
      account: 'GET /api/futures/account/balance',
      positions: 'GET /api/futures/positions',
      orders: 'GET /api/futures/orders',
      placeOrder: 'POST /api/futures/orders',
      cancelOrder: 'DELETE /api/futures/orders'
    }
  });
});

/**
 * GET /api/markets - Get available trading pairs
 * DEPRECATED: Use /api/futures/products for futures markets
 */
// GET /api/ticker - Get all ticker data
router.get('/ticker', async (req, res) => {
  res.set('X-Deprecated', 'true');
  res.set('X-Deprecated-Message', 'Use /api/futures/tickers for futures tickers');
  
  try {
    const response = await makePublicRequest('GET', '/markets/ticker24hr', req.query);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch ticker data',
      details: error.response?.data || error.message,
      suggestion: 'Consider using /api/futures/tickers for futures tickers'
    });
  }
});

// GET /api/ticker/:symbol - Get ticker for specific symbol
router.get('/ticker/:symbol', async (req, res) => {
  res.set('X-Deprecated', 'true');
  res.set('X-Deprecated-Message', 'Use /api/futures/tickers for futures tickers');
  
  try {
    const { symbol } = req.params;
    const response = await makePublicRequest('GET', `/markets/${symbol}/ticker24hr`, req.query);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch ticker data',
      details: error.response?.data || error.message,
      suggestion: 'Consider using /api/futures/tickers for futures tickers'
    });
  }
});

/**
 * GET /api/ticker/:symbol? - Get ticker data
 * DEPRECATED: Use /api/futures/tickers for futures tickers
 */
router.get('/ticker/:symbol?', async (req, res) => {
  // Add deprecation header
  res.set('X-Deprecated', 'true');
  res.set('X-Deprecated-Message', 'Use /api/futures/tickers for futures tickers');
  
  try {
    const { symbol } = req.params;
    const endpoint = symbol ? `/markets/${symbol}/ticker24hr` : '/markets/ticker24hr';

    const response = await makePublicRequest('GET', endpoint, req.query);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch ticker data',
      details: error.response?.data || error.message,
      suggestion: 'Consider using /api/futures/tickers for futures tickers'
    });
  }
});

/**
 * GET /api/orderbook/:symbol - Get order book
 * DEPRECATED: Use /api/futures/orderbook/:symbol for futures order books
 */
router.get('/orderbook/:symbol', async (req, res) => {
  // Add deprecation header
  res.set('X-Deprecated', 'true');
  res.set('X-Deprecated-Message', 'Use /api/futures/orderbook/:symbol for futures order books');
  
  try {
    const { symbol } = req.params;
    const response = await makePublicRequest('GET', `/markets/${symbol}/orderBook`, req.query);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch order book',
      details: error.response?.data || error.message,
      suggestion: `Consider using /api/futures/orderbook/${req.params.symbol} for futures order books`
    });
  }
});

/**
 * GET /api/klines/:symbol - Get historical candlestick data
 * DEPRECATED: Use /api/futures/klines/:symbol for futures K-line data
 */
router.get('/klines/:symbol', async (req, res) => {
  // Add deprecation header
  res.set('X-Deprecated', 'true');
  res.set('X-Deprecated-Message', 'Use /api/futures/klines/:symbol for futures K-line data');
  
  try {
    const { symbol } = req.params;
    const response = await makePublicRequest('GET', `/markets/${symbol}/candles`, req.query);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch candlestick data',
      details: error.response?.data || error.message,
      suggestion: `Consider using /api/futures/klines/${req.params.symbol} for futures K-line data`
    });
  }
});

// =================== AUTHENTICATED ENDPOINTS ===================

// All routes below require authentication
router.use(authenticateToken);

/**
 * GET /api/account/balances - Get account balances
 */
router.get('/account/balances', async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);

    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const response = await makeAuthenticatedRequest(
      credentials,
      'GET',
      '/accounts/balances'
    );

    res.json(response.data);
  } catch (error) {
    if (error.response?.status === 401) {
      return res.status(401).json({
        error: 'Invalid API credentials',
        requiresApiKeys: true
      });
    }

    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch account balances',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/account/activity - Get account activity
 */
router.get('/account/activity', async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);

    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const response = await makeAuthenticatedRequest(
      credentials,
      'GET',
      '/accounts/activity',
      null,
      req.query
    );

    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch account activity',
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/orders - Place a new order
 */
router.post('/orders', async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);

    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    // Check if user has trading permissions
    if (!credentials.permissions?.trade) {
      return res.status(403).json({
        error: 'Trading permission not enabled for your API credentials',
        requiresTradingPermission: true
      });
    }

    // Validate required order fields
    const { symbol, side, type, amount, price } = req.body;

    if (!symbol || !side || !type || !amount) {
      return res.status(400).json({
        error: 'Missing required order fields: symbol, side, type, amount'
      });
    }

    if (type === 'limit' && !price) {
      return res.status(400).json({
        error: 'Price is required for limit orders'
      });
    }

    const response = await makeAuthenticatedRequest(
      credentials,
      'POST',
      '/orders',
      req.body
    );

    // Log the trade for audit purposes
    await UserService.logSecurityEvent({
      userId: req.user.id,
      eventType: 'order_placed',
      eventDescription: `Order placed: ${side} ${amount} ${symbol} at ${price || 'market'}`,
      severity: 'info',
      metadata: {
        symbol,
        side,
        type,
        amount,
        price,
        orderId: response.data?.id
      }
    });

    res.json(response.data);
  } catch (error) {
    // Log failed order attempt
    await UserService.logSecurityEvent({
      userId: req.user.id,
      eventType: 'order_failed',
      eventDescription: `Order placement failed: ${error.message}`,
      severity: 'warning',
      metadata: {
        requestBody: req.body,
        error: error.response?.data || error.message
      }
    });

    res.status(error.response?.status || 500).json({
      error: 'Failed to place order',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/orders - Get open orders
 */
router.get('/orders', async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);

    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const response = await makeAuthenticatedRequest(
      credentials,
      'GET',
      '/orders',
      null,
      req.query
    );

    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch orders',
      details: error.response?.data || error.message
    });
  }
});

/**
 * DELETE /api/orders/:orderId - Cancel an order
 */
router.delete('/orders/:orderId', async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);

    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    // Check if user has trading permissions
    if (!credentials.permissions?.trade) {
      return res.status(403).json({
        error: 'Trading permission not enabled for your API credentials',
        requiresTradingPermission: true
      });
    }

    const { orderId } = req.params;

    const response = await makeAuthenticatedRequest(
      credentials,
      'DELETE',
      `/orders/${orderId}`
    );

    // Log the cancellation for audit purposes
    await UserService.logSecurityEvent({
      userId: req.user.id,
      eventType: 'order_cancelled',
      eventDescription: `Order cancelled: ${orderId}`,
      severity: 'info',
      metadata: { orderId }
    });

    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to cancel order',
      details: error.response?.data || error.message
    });
  }
});

/**
 * GET /api/trades - Get trade history
 */
router.get('/trades', async (req, res) => {
  try {
    const credentials = await UserService.getApiCredentials(req.user.id);

    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const response = await makeAuthenticatedRequest(
      credentials,
      'GET',
      '/trades',
      null,
      req.query
    );

    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch trade history',
      details: error.response?.data || error.message
    });
  }
});

/**
 * Error handling middleware
 */
router.use((error, req, res) => {
  console.error('Proxy route error:', error);

  if (error.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: 'Poloniex API is currently unavailable'
    });
  }

  if (error.code === 'ETIMEDOUT') {
    return res.status(504).json({
      error: 'Request to Poloniex API timed out'
    });
  }

  res.status(500).json({
    error: 'Internal proxy error',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

export default router;
