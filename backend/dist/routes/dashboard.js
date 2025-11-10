import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';
import { logger } from '../utils/logger.js';
const router = express.Router();
/**
 * GET /api/dashboard/overview
 * Get complete dashboard overview including balances, positions, and recent trades
 */
router.get('/overview', authenticateToken, async (req, res) => {
    try {
        const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true,
                data: {
                    balance: null,
                    positions: [],
                    recentTrades: [],
                    openOrders: []
                }
            });
        }
        // Fetch all data in parallel for better performance
        const [balance, positions, recentTrades, openOrders] = await Promise.allSettled([
            poloniexFuturesService.getAccountBalance(credentials),
            poloniexFuturesService.getPositions(credentials),
            poloniexFuturesService.getExecutionDetails(credentials, { limit: 10 }),
            poloniexFuturesService.getCurrentOrders(credentials)
        ]);
        // Extract data or null if failed
        const balanceData = balance.status === 'fulfilled' ? balance.value : null;
        const positionsData = positions.status === 'fulfilled' ? positions.value : [];
        const tradesData = recentTrades.status === 'fulfilled' ? recentTrades.value : [];
        const ordersData = openOrders.status === 'fulfilled' ? openOrders.value : [];
        // Calculate summary statistics
        const totalPositionValue = Array.isArray(positionsData)
            ? positionsData.reduce((sum, pos) => sum + (parseFloat(pos.notionalValue) || 0), 0)
            : 0;
        const totalPnL = Array.isArray(positionsData)
            ? positionsData.reduce((sum, pos) => sum + (parseFloat(pos.unrealizedPnl) || 0), 0)
            : 0;
        const activePositionsCount = Array.isArray(positionsData)
            ? positionsData.filter((pos) => parseFloat(pos.positionAmt) !== 0).length
            : 0;
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            data: {
                // Account balance
                balance: balanceData,
                // Positions
                positions: positionsData,
                positionsSummary: {
                    totalPositions: activePositionsCount,
                    totalValue: totalPositionValue,
                    totalPnL: totalPnL
                },
                // Recent trades
                recentTrades: tradesData,
                tradesSummary: {
                    count: Array.isArray(tradesData) ? tradesData.length : 0,
                    last24h: Array.isArray(tradesData)
                        ? tradesData.filter((t) => {
                            const tradeTime = new Date(t.time).getTime();
                            const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
                            return tradeTime > dayAgo;
                        }).length
                        : 0
                },
                // Open orders
                openOrders: ordersData,
                ordersSummary: {
                    count: Array.isArray(ordersData) ? ordersData.length : 0
                }
            },
            errors: {
                balance: balance.status === 'rejected' ? balance.reason?.message : null,
                positions: positions.status === 'rejected' ? positions.reason?.message : null,
                trades: recentTrades.status === 'rejected' ? recentTrades.reason?.message : null,
                orders: openOrders.status === 'rejected' ? openOrders.reason?.message : null
            }
        });
    }
    catch (error) {
        logger.error('Error fetching dashboard overview:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch dashboard data',
            details: error.message,
            data: {
                balance: null,
                positions: [],
                recentTrades: [],
                openOrders: []
            }
        });
    }
});
/**
 * GET /api/dashboard/balance
 * Get just account balance (lightweight endpoint)
 */
router.get('/balance', authenticateToken, async (req, res) => {
    try {
        const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found',
                requiresApiKeys: true
            });
        }
        const balance = await poloniexFuturesService.getAccountBalance(credentials);
        res.json({
            success: true,
            data: balance
        });
    }
    catch (error) {
        logger.error('Error fetching balance:', error);
        res.status(error.response?.status || 500).json({
            success: false,
            error: 'Failed to fetch balance',
            details: error.response?.data || error.message
        });
    }
});
/**
 * GET /api/dashboard/positions
 * Get active positions with summary
 */
router.get('/positions', authenticateToken, async (req, res) => {
    try {
        const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found',
                requiresApiKeys: true
            });
        }
        const positions = await poloniexFuturesService.getPositions(credentials);
        // Calculate summary
        const activePositions = Array.isArray(positions)
            ? positions.filter((pos) => parseFloat(pos.positionAmt) !== 0)
            : [];
        const totalPnL = activePositions.reduce((sum, pos) => sum + (parseFloat(pos.unrealizedPnl) || 0), 0);
        const totalValue = activePositions.reduce((sum, pos) => sum + (parseFloat(pos.notionalValue) || 0), 0);
        res.json({
            success: true,
            data: {
                positions: activePositions,
                summary: {
                    count: activePositions.length,
                    totalPnL,
                    totalValue
                }
            }
        });
    }
    catch (error) {
        logger.error('Error fetching positions:', error);
        res.status(error.response?.status || 500).json({
            success: false,
            error: 'Failed to fetch positions',
            details: error.response?.data || error.message
        });
    }
});
/**
 * GET /api/dashboard/bills
 * Get account transaction bills/history
 */
router.get('/bills', authenticateToken, async (req, res) => {
    try {
        const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
        if (!credentials) {
            return res.status(400).json({
                error: 'No API credentials found. Please add your Poloniex API keys first.',
                requiresApiKeys: true
            });
        }
        const limit = parseInt(req.query.limit) || 10;
        const bills = await poloniexFuturesService.getAccountBills(credentials, { limit });
        res.json({
            success: true,
            data: bills
        });
    }
    catch (error) {
        logger.error('Error fetching account bills:', error);
        res.status(error.response?.status || 500).json({
            success: false,
            error: 'Failed to fetch account bills',
            details: error.response?.data || error.message
        });
    }
});
export default router;
