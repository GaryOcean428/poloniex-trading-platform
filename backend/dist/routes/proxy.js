import axios from 'axios';
import crypto from 'crypto';
import express from 'express';
import { URLSearchParams } from 'url';
import { authenticateToken } from '../middleware/auth.js';
import { UserService } from '../services/userService.js';
import { logger } from '../utils/logger.js';
const router = express.Router();
const POLONIEX_PUBLIC_URL = 'https://api.poloniex.com';
const POLONIEX_PRIVATE_URL = 'https://api.poloniex.com';
function generateSignature(method, requestPath, body, timestamp, apiSecret) {
    try {
        const bodyStr = body ? JSON.stringify(body) : '';
        const message = `${method.toUpperCase()}\n${requestPath}\n${bodyStr}${timestamp}`;
        return crypto
            .createHmac('sha256', apiSecret)
            .update(message)
            .digest('base64');
    }
    catch (error) {
        logger.error('Error generating signature', { error: error.message, stack: error.stack });
        throw new Error('Failed to generate API signature');
    }
}
async function makeAuthenticatedRequest(credentials, method, endpoint, body = null, params = {}) {
    try {
        const timestamp = Date.now().toString();
        const requestPath = endpoint.startsWith('/v3') ? endpoint : `/v3${endpoint}`;
        const url = `${POLONIEX_PRIVATE_URL}${requestPath}`;
        const queryString = Object.keys(params).length > 0
            ? '?' + new URLSearchParams(params).toString()
            : '';
        const fullRequestPath = requestPath + queryString;
        const fullUrl = url + queryString;
        const signature = generateSignature(method, fullRequestPath, body, timestamp, credentials.apiSecret);
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
            timeout: 30000,
        };
        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            config.data = body;
        }
        if (Object.keys(params).length > 0 && method === 'GET') {
            config.params = params;
        }
        logger.info('Making authenticated v3 request', { method, requestPath });
        const response = await axios(config);
        return response;
    }
    catch (error) {
        logger.error('Authenticated request error', {
            error: error.response?.data || error.message,
            method,
            requestPath
        });
        throw error;
    }
}
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
        logger.info('Making public request', { method, endpoint });
        const response = await axios(config);
        return response;
    }
    catch (error) {
        logger.error('Public request error', {
            error: error.response?.data || error.message,
            method,
            endpoint
        });
        throw error;
    }
}
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
router.get('/markets', async (req, res) => {
    res.set('X-Deprecated', 'true');
    res.set('X-Deprecated-Message', 'Use /api/futures/products for futures markets');
    try {
        const response = await makePublicRequest('GET', '/markets', req.query);
        res.json(response.data);
    }
    catch (error) {
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch markets',
            details: error.response?.data || error.message,
            suggestion: 'Consider using /api/futures/products for futures markets'
        });
    }
});
router.get('/ticker', async (req, res) => {
    res.set('X-Deprecated', 'true');
    res.set('X-Deprecated-Message', 'Use /api/futures/tickers for futures tickers');
    try {
        const response = await makePublicRequest('GET', '/markets/ticker24hr', req.query);
        res.json(response.data);
    }
    catch (error) {
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch ticker data',
            details: error.response?.data || error.message,
            suggestion: 'Consider using /api/futures/tickers for futures tickers'
        });
    }
});
router.get('/ticker/:symbol', async (req, res) => {
    res.set('X-Deprecated', 'true');
    res.set('X-Deprecated-Message', 'Use /api/futures/tickers for futures tickers');
    try {
        const { symbol } = req.params;
        const response = await makePublicRequest('GET', `/markets/${symbol}/ticker24hr`, req.query);
        res.json(response.data);
    }
    catch (error) {
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch ticker data',
            details: error.response?.data || error.message,
            suggestion: 'Consider using /api/futures/tickers for futures tickers'
        });
    }
});
router.get('/orderbook/:symbol', async (req, res) => {
    res.set('X-Deprecated', 'true');
    res.set('X-Deprecated-Message', 'Use /api/futures/orderbook/:symbol for futures order books');
    try {
        const { symbol } = req.params;
        const response = await makePublicRequest('GET', `/markets/${symbol}/orderBook`, req.query);
        res.json(response.data);
    }
    catch (error) {
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch order book',
            details: error.response?.data || error.message,
            suggestion: `Consider using /api/futures/orderbook/${req.params.symbol} for futures order books`
        });
    }
});
router.get('/klines/:symbol', async (req, res) => {
    res.set('X-Deprecated', 'true');
    res.set('X-Deprecated-Message', 'Use /api/futures/klines/:symbol for futures K-line data');
    try {
        const { symbol } = req.params;
        const response = await makePublicRequest('GET', `/markets/${symbol}/candles`, req.query);
        res.json(response.data);
    }
    catch (error) {
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch candlestick data',
            details: error.response?.data || error.message,
            suggestion: `Consider using /api/futures/klines/${req.params.symbol} for futures K-line data`
        });
    }
});
router.use(authenticateToken);
router.get('/account/balances', async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const response = await makeAuthenticatedRequest(credentials, 'GET', '/accounts/balances');
        res.json(response.data);
    }
    catch (error) {
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
router.get('/account/activity', async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const response = await makeAuthenticatedRequest(credentials, 'GET', '/accounts/activity', null, req.query);
        res.json(response.data);
    }
    catch (error) {
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch account activity',
            details: error.response?.data || error.message
        });
    }
});
router.post('/orders', async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        if (!credentials.permissions?.trade) {
            return res.status(403).json({
                error: 'Trading permission not enabled for your API credentials',
                requiresTradingPermission: true
            });
        }
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
        const response = await makeAuthenticatedRequest(credentials, 'POST', '/orders', req.body);
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
    }
    catch (error) {
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
router.get('/orders', async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const response = await makeAuthenticatedRequest(credentials, 'GET', '/orders', null, req.query);
        res.json(response.data);
    }
    catch (error) {
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch orders',
            details: error.response?.data || error.message
        });
    }
});
router.delete('/orders/:orderId', async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        if (!credentials.permissions?.trade) {
            return res.status(403).json({
                error: 'Trading permission not enabled for your API credentials',
                requiresTradingPermission: true
            });
        }
        const { orderId } = req.params;
        const response = await makeAuthenticatedRequest(credentials, 'DELETE', `/orders/${orderId}`);
        await UserService.logSecurityEvent({
            userId: req.user.id,
            eventType: 'order_cancelled',
            eventDescription: `Order cancelled: ${orderId}`,
            severity: 'info',
            metadata: { orderId }
        });
        res.json(response.data);
    }
    catch (error) {
        res.status(error.response?.status || 500).json({
            error: 'Failed to cancel order',
            details: error.response?.data || error.message
        });
    }
});
router.get('/trades', async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const response = await makeAuthenticatedRequest(credentials, 'GET', '/trades', null, req.query);
        res.json(response.data);
    }
    catch (error) {
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch trade history',
            details: error.response?.data || error.message
        });
    }
});
router.use((error, req, res) => {
    logger.error('Proxy route error', {
        error: error.message,
        stack: error.stack,
        code: error.code,
        path: req.path
    });
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
