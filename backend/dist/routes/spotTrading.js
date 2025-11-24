import express from 'express';
import poloniexSpotService from '../services/poloniexSpotService.js';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
const router = express.Router();
// All routes require authentication
router.use(authenticateToken);
/**
 * Place a new order
 * POST /api/spot/orders
 */
router.post('/orders', async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.user.credentials;
        const credentials = { apiKey, apiSecret };
        const result = await poloniexSpotService.placeOrder(credentials, req.body);
        res.json({
            success: true,
            data: result
        });
    }
    catch (error) {
        logger.error('Error placing spot order:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});
/**
 * Get open orders
 * GET /api/spot/orders
 */
router.get('/orders', async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.user.credentials;
        const credentials = { apiKey, apiSecret };
        const result = await poloniexSpotService.getOpenOrders(credentials, req.query);
        res.json({
            success: true,
            data: result
        });
    }
    catch (error) {
        logger.error('Error fetching open orders:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});
/**
 * Get order by ID
 * GET /api/spot/orders/:id
 */
router.get('/orders/:id', async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.user.credentials;
        const credentials = { apiKey, apiSecret };
        const result = await poloniexSpotService.getOrderById(credentials, req.params.id);
        res.json({
            success: true,
            data: result
        });
    }
    catch (error) {
        logger.error('Error fetching order:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});
/**
 * Cancel order by ID
 * DELETE /api/spot/orders/:id
 */
router.delete('/orders/:id', async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.user.credentials;
        const credentials = { apiKey, apiSecret };
        const result = await poloniexSpotService.cancelOrder(credentials, req.params.id);
        res.json({
            success: true,
            data: result
        });
    }
    catch (error) {
        logger.error('Error cancelling order:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});
/**
 * Cancel multiple orders
 * DELETE /api/spot/orders/batch
 */
router.delete('/orders/batch', async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.user.credentials;
        const credentials = { apiKey, apiSecret };
        const { orderIds, clientOrderIds } = req.body;
        const result = await poloniexSpotService.cancelOrdersByIds(credentials, orderIds || [], clientOrderIds || []);
        res.json({
            success: true,
            data: result
        });
    }
    catch (error) {
        logger.error('Error cancelling orders:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});
/**
 * Cancel all orders
 * DELETE /api/spot/orders/all
 */
router.delete('/orders/all', async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.user.credentials;
        const credentials = { apiKey, apiSecret };
        const result = await poloniexSpotService.cancelAllOrders(credentials, req.query);
        res.json({
            success: true,
            data: result
        });
    }
    catch (error) {
        logger.error('Error cancelling all orders:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});
/**
 * Get order history
 * GET /api/spot/orders/history
 */
router.get('/orders/history', async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.user.credentials;
        const credentials = { apiKey, apiSecret };
        const result = await poloniexSpotService.getOrderHistory(credentials, req.query);
        res.json({
            success: true,
            data: result
        });
    }
    catch (error) {
        logger.error('Error fetching order history:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});
/**
 * Get trade history
 * GET /api/spot/trades
 */
router.get('/trades', async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.user.credentials;
        const credentials = { apiKey, apiSecret };
        const result = await poloniexSpotService.getTradeHistory(credentials, req.query);
        res.json({
            success: true,
            data: result
        });
    }
    catch (error) {
        logger.error('Error fetching trade history:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});
/**
 * Get trades for specific order
 * GET /api/spot/orders/:id/trades
 */
router.get('/orders/:id/trades', async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.user.credentials;
        const credentials = { apiKey, apiSecret };
        const result = await poloniexSpotService.getOrderTrades(credentials, req.params.id);
        res.json({
            success: true,
            data: result
        });
    }
    catch (error) {
        logger.error('Error fetching order trades:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});
/**
 * Set kill switch
 * POST /api/spot/killswitch
 */
router.post('/killswitch', async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.user.credentials;
        const credentials = { apiKey, apiSecret };
        const { timeout } = req.body;
        const result = await poloniexSpotService.setKillSwitch(credentials, timeout);
        res.json({
            success: true,
            data: result
        });
    }
    catch (error) {
        logger.error('Error setting kill switch:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});
/**
 * Get kill switch status
 * GET /api/spot/killswitch
 */
router.get('/killswitch', async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.user.credentials;
        const credentials = { apiKey, apiSecret };
        const result = await poloniexSpotService.getKillSwitchStatus(credentials);
        res.json({
            success: true,
            data: result
        });
    }
    catch (error) {
        logger.error('Error fetching kill switch status:', error);
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});
export default router;
