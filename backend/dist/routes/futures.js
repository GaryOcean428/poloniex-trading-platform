import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { UserService } from '../services/userService.js';
import { logger } from '../utils/logger.js';
import riskService from '../services/riskService.js';
import alertingService from '../services/alertingService.js';
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
        const { depth = 20 } = req.query;
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
        const { granularity, ...params } = req.query;
        if (!granularity) {
            return res.status(400).json({
                error: 'Granularity parameter is required (e.g., 60, 300, 900, 1800, 3600, 14400, 86400)'
            });
        }
        const klines = await poloniexFuturesService.getKlines(symbol, granularity, params);
        res.json(klines);
    }
    catch (error) {
        logger.error(`Error fetching klines for ${req.params.symbol}:`, error);
        res.status(500).json({
            error: 'Failed to fetch K-line data',
            details: error.response?.data || error.message
        });
    }
});
/**
 * GET /api/futures/trades/:symbol - Get recent trades for symbol
 */
router.get('/trades/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const trades = await poloniexFuturesService.getMarketTrades(symbol);
        res.json(trades);
    }
    catch (error) {
        logger.error(`Error fetching trades for ${req.params.symbol}:`, error);
        res.status(500).json({
            error: 'Failed to fetch market trades',
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
    }
    catch (error) {
        logger.error(`Error fetching funding rate for ${req.params.symbol}:`, error);
        res.status(500).json({
            error: 'Failed to fetch funding rate',
            details: error.response?.data || error.message
        });
    }
});
/**
 * GET /api/futures/funding/:symbol/history - Get funding rate history
 */
router.get('/funding/:symbol/history', async (req, res) => {
    try {
        const { symbol } = req.params;
        const params = req.query; // startTime, endTime, limit
        const history = await poloniexFuturesService.getFundingRateHistory(symbol, params);
        res.json(history);
    }
    catch (error) {
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
router.get('/open-interest/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const openInterest = await poloniexFuturesService.getOpenInterest(symbol);
        res.json(openInterest);
    }
    catch (error) {
        logger.error(`Error fetching open interest for ${req.params.symbol}:`, error);
        res.status(500).json({
            error: 'Failed to fetch open interest',
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
 * GET /api/futures/account/overview - Get account overview
 */
router.get('/account/overview', authenticateToken, async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const overview = await poloniexFuturesService.getAccountOverview(credentials);
        res.json(overview);
    }
    catch (error) {
        logger.error('Error fetching account overview:', error);
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch account overview',
            details: error.response?.data || error.message
        });
    }
});
/**
 * GET /api/futures/account/bills - Get account transaction history
 */
router.get('/account/bills', authenticateToken, async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const params = req.query; // startTime, endTime, limit, type
        const bills = await poloniexFuturesService.getAccountBills(credentials, params);
        res.json(bills);
    }
    catch (error) {
        logger.error('Error fetching account bills:', error);
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch account bills',
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
 * GET /api/futures/positions/history - Get position history
 */
router.get('/positions/history', authenticateToken, async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const params = req.query; // symbol, startTime, endTime, limit
        const history = await poloniexFuturesService.getPositionHistory(credentials, params);
        res.json(history);
    }
    catch (error) {
        logger.error('Error fetching position history:', error);
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch position history',
            details: error.response?.data || error.message
        });
    }
});
/**
 * POST /api/futures/positions/leverage - Modify position leverage
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
    }
    catch (error) {
        logger.error('Error modifying leverage:', error);
        res.status(error.response?.status || 500).json({
            error: 'Failed to modify leverage',
            details: error.response?.data || error.message
        });
    }
});
/**
 * POST /api/futures/positions/mode - Set position mode (ONE_WAY or HEDGE)
 */
router.post('/positions/mode', authenticateToken, async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const { mode } = req.body;
        if (!mode || !['ONE_WAY', 'HEDGE'].includes(mode)) {
            return res.status(400).json({
                error: 'Mode must be either "ONE_WAY" or "HEDGE"'
            });
        }
        const result = await poloniexFuturesService.setPositionMode(credentials, mode);
        res.json(result);
    }
    catch (error) {
        logger.error('Error setting position mode:', error);
        res.status(error.response?.status || 500).json({
            error: 'Failed to set position mode',
            details: error.response?.data || error.message
        });
    }
});
/**
 * GET /api/futures/orders - Get open orders
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
        const params = req.query; // symbol, side, type, startTime, endTime
        const orders = await poloniexFuturesService.getOpenOrders(credentials, params);
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
 * GET /api/futures/orders/history - Get order history
 */
router.get('/orders/history', authenticateToken, async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const params = req.query; // symbol, side, type, startTime, endTime, limit
        const history = await poloniexFuturesService.getOrderHistory(credentials, params);
        res.json(history);
    }
    catch (error) {
        logger.error('Error fetching order history:', error);
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch order history',
            details: error.response?.data || error.message
        });
    }
});
/**
 * GET /api/futures/orders/:orderId - Get specific order details
 */
router.get('/orders/:orderId', authenticateToken, async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const { orderId } = req.params;
        const order = await poloniexFuturesService.getOrder(credentials, orderId);
        res.json(order);
    }
    catch (error) {
        logger.error(`Error fetching order ${req.params.orderId}:`, error);
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch order details',
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
        // Risk check before placing order
        const account = { id: req.user.id, balance: 10000 };
        const marketInfo = await poloniexFuturesService.getProduct(req.body.symbol);
        const riskCheck = await riskService.checkOrderRisk(req.body, account, marketInfo);
        if (!riskCheck.allowed) {
            logger.warn('Order rejected by risk check', { orderData: req.body, reason: riskCheck.reason });
            await alertingService.alertOrderRejection(req.body, riskCheck.reason);
            return res.status(400).json({
                error: 'Risk check failed',
                reason: riskCheck.reason
            });
        }
        const order = await poloniexFuturesService.placeOrder(credentials, req.body);
        // Store in database for tracking
        await poloniexFuturesService.storeOrderInDatabase(req.user.id, req.body, order);
        res.json(order);
    }
    catch (error) {
        logger.error('Error placing order:', error);
        await alertingService.alertOrderRejection(req.body, error.message);
        res.status(error.response?.status || 400).json({
            error: 'Failed to place order',
            details: error.response?.data || error.message
        });
    }
});
/**
 * DELETE /api/futures/orders/:orderId - Cancel specific order
 */
router.delete('/orders/:orderId', authenticateToken, async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const { orderId } = req.params;
        const result = await poloniexFuturesService.cancelOrder(credentials, orderId);
        res.json(result);
    }
    catch (error) {
        logger.error(`Error canceling order ${req.params.orderId}:`, error);
        res.status(error.response?.status || 500).json({
            error: 'Failed to cancel order',
            details: error.response?.data || error.message
        });
    }
});
/**
 * DELETE /api/futures/orders - Cancel all orders (or by symbol)
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
        const { symbol } = req.query;
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
 * GET /api/futures/trades - Get trade history
 */
router.get('/trades', authenticateToken, async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const params = req.query; // symbol, orderId, startTime, endTime, limit
        const trades = await poloniexFuturesService.getTradeHistory(credentials, params);
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
 * GET /api/futures/risk/:symbol - Get risk limit for symbol
 */
router.get('/risk/:symbol', authenticateToken, async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const { symbol } = req.params;
        const riskLimit = await poloniexFuturesService.getRiskLimit(credentials, symbol);
        res.json(riskLimit);
    }
    catch (error) {
        logger.error(`Error fetching risk limit for ${req.params.symbol}:`, error);
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch risk limit',
            details: error.response?.data || error.message
        });
    }
});
/**
 * POST /api/futures/risk - Update risk limit
 */
router.post('/risk', authenticateToken, async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const { symbol, level } = req.body;
        if (!symbol || !level) {
            return res.status(400).json({
                error: 'Symbol and level are required'
            });
        }
        const result = await poloniexFuturesService.updateRiskLimit(credentials, symbol, level);
        res.json(result);
    }
    catch (error) {
        logger.error('Error updating risk limit:', error);
        res.status(error.response?.status || 500).json({
            error: 'Failed to update risk limit',
            details: error.response?.data || error.message
        });
    }
});
/**
 * GET /api/futures/adl - Get ADL (Auto-Deleveraging) status
 */
router.get('/adl', authenticateToken, async (req, res) => {
    try {
        const credentials = await UserService.getApiCredentials(req.user.id);
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const adlStatus = await poloniexFuturesService.getADLStatus(credentials);
        res.json(adlStatus);
    }
    catch (error) {
        logger.error('Error fetching ADL status:', error);
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch ADL status',
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
    if (error.response?.status === 403) {
        return res.status(403).json({
            error: 'API access forbidden - check permissions and rate limits'
        });
    }
    return res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
});
export default router;
