import express, { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/dashboard/overview
 * Get complete dashboard overview including balances, positions, and recent trades
 */
router.get('/overview', authenticateToken, async (req: Request, res: Response) => {
  try {
    let credentials;
    try {
      credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    } catch (credError) {
      // No credentials found - return mock data for demo users
      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        data: {
          balance: {
            availableBalance: '10000.00',
            totalEquity: '10000.00',
            unrealizedPnL: '0.00',
            currency: 'USDT'
          },
          positions: [],
          positionsSummary: {
            totalPositions: 0,
            totalValue: 0,
            totalPnL: 0
          },
          recentTrades: [],
          tradesSummary: {
            count: 0,
            last24h: 0
          },
          openOrders: [],
          ordersSummary: {
            count: 0
          }
        },
        mock: true
      });
    }
    
    if (!credentials) {
      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        data: {
          balance: {
            availableBalance: '10000.00',
            totalEquity: '10000.00',
            unrealizedPnL: '0.00',
            currency: 'USDT'
          },
          positions: [],
          positionsSummary: {
            totalPositions: 0,
            totalValue: 0,
            totalPnL: 0
          },
          recentTrades: [],
          tradesSummary: {
            count: 0,
            last24h: 0
          },
          openOrders: [],
          ordersSummary: {
            count: 0
          }
        },
        mock: true
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
      ? positionsData.reduce((sum: number, pos: any) => sum + (parseFloat(pos.notionalValue) || 0), 0)
      : 0;

    const totalPnL = Array.isArray(positionsData)
      ? positionsData.reduce((sum: number, pos: any) => sum + (parseFloat(pos.unrealizedPnl) || 0), 0)
      : 0;

    const activePositionsCount = Array.isArray(positionsData)
      ? positionsData.filter((pos: any) => parseFloat(pos.positionAmt) !== 0).length
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
            ? tradesData.filter((t: any) => {
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

  } catch (error: any) {
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
router.get('/balance', authenticateToken, async (req: Request, res: Response) => {
  try {
    let credentials;
    try {
      credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    } catch (credError) {
      // No credentials found - return mock data for demo users
      return res.json({
        success: true,
        data: {
          availableBalance: '10000.00',
          totalEquity: '10000.00',
          unrealizedPnL: '0.00',
          marginBalance: '10000.00',
          positionMargin: '0.00',
          orderMargin: '0.00',
          frozenFunds: '0.00',
          currency: 'USDT'
        },
        mock: true
      });
    }
    
    if (!credentials) {
      return res.json({
        success: true,
        data: {
          availableBalance: '10000.00',
          totalEquity: '10000.00',
          unrealizedPnL: '0.00',
          marginBalance: '10000.00',
          positionMargin: '0.00',
          orderMargin: '0.00',
          frozenFunds: '0.00',
          currency: 'USDT'
        },
        mock: true
      });
    }

    const balance = await poloniexFuturesService.getAccountBalance(credentials);
    res.json({
      success: true,
      data: balance
    });

  } catch (error: any) {
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
router.get('/positions', authenticateToken, async (req: Request, res: Response) => {
  try {
    let credentials;
    try {
      credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    } catch (credError) {
      // No credentials found - return empty positions for demo users
      return res.json({
        success: true,
        data: {
          positions: [],
          summary: {
            count: 0,
            totalPnL: 0,
            totalValue: 0
          }
        },
        mock: true
      });
    }
    
    if (!credentials) {
      return res.json({
        success: true,
        data: {
          positions: [],
          summary: {
            count: 0,
            totalPnL: 0,
            totalValue: 0
          }
        },
        mock: true
      });
    }

    const positions = await poloniexFuturesService.getPositions(credentials);
    
    // Calculate summary
    const activePositions = Array.isArray(positions)
      ? positions.filter((pos: any) => parseFloat(pos.positionAmt) !== 0)
      : [];

    const totalPnL = activePositions.reduce((sum: number, pos: any) => 
      sum + (parseFloat(pos.unrealizedPnl) || 0), 0);

    const totalValue = activePositions.reduce((sum: number, pos: any) => 
      sum + (parseFloat(pos.notionalValue) || 0), 0);

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

  } catch (error: any) {
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
router.get('/bills', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials found. Please add your Poloniex API keys first.',
        requiresApiKeys: true
      });
    }

    const limit = parseInt(req.query.limit as string) || 10;
    const bills = await poloniexFuturesService.getAccountBills(credentials, { limit });

    res.json({
      success: true,
      data: bills
    });

  } catch (error: any) {
    logger.error('Error fetching account bills:', error);
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to fetch account bills',
      details: error.response?.data || error.message
    });
  }
});

export default router;
