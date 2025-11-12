import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';
import { logger } from '../utils/logger.js';
const router = express.Router();
// =================== PUBLIC ENDPOINTS ===================
/**
 * GET /api/futures/health - Health check for Poloniex Futures v3 service
 */
router.get('/health', async (req, res) => {
    try {
        const health = await poloniexFuturesService.healthCheck();
        res.status(health.status === 'healthy' ? 200 : 503).json(health);
    }
    catch (error) {
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
router.get('/products', async (req, res) => {
    try {
        const products = await poloniexFuturesService.getProducts();
        res.json(products);
    }
    catch (error) {
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
    }
    catch (error) {
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
router.get('/ticker', async (req, res) => {
    try {
        const { symbol } = req.query;
        const tickers = await poloniexFuturesService.getTickers(symbol);
        res.json(tickers);
    }
    catch (error) {
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
        const { depth = '20' } = req.query;
        const orderbook = await poloniexFuturesService.getOrderBook(symbol, parseInt(depth));
        res.json(orderbook);
    }
    catch (error) {
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
router.get('/klines/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const { interval = '1h', limit = '100' } = req.query;
        // Convert interval to Poloniex format (MINUTE_1, HOUR_1, etc.)
        const intervalMap = {
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
        const poloniexInterval = intervalMap[interval] || 'HOUR_1'; // Default to 1h
        const klines = await poloniexFuturesService.getKlines(symbol, poloniexInterval, { limit: parseInt(limit) });
        res.json(klines);
    }
    catch (error) {
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
router.get('/trades/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const { limit = '50' } = req.query;
        const trades = await poloniexFuturesService.getMarketTrades(symbol);
        res.json(trades);
    }
    catch (error) {
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
router.get('/balance', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
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
router.get('/positions', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
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
router.get('/trades', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
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
router.get('/orders', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
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
router.post('/order', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
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
router.delete('/order/:orderId', authenticateToken, async (req, res) => {
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
        const result = await poloniexFuturesService.cancelOrder(credentials, orderId, symbol);
        res.json(result);
    }
    catch (error) {
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
router.delete('/orders', authenticateToken, async (req, res) => {
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
        const result = await poloniexFuturesService.cancelAllOrders(credentials, symbol);
        res.json(result);
    }
    catch (error) {
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
router.get('/leverage/:symbol', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
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
router.post('/leverage', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        logger.error('Error setting leverage:', error);
        res.status(error.response?.status || 500).json({
            error: 'Failed to set leverage',
            details: error.response?.data || error.message
        });
    }
});
export default router;
