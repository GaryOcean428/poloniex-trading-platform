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
    const rawBalanceData = balance.status === 'fulfilled' ? balance.value : null;
    const positionsData = positions.status === 'fulfilled' ? positions.value : [];
    const tradesData = recentTrades.status === 'fulfilled' ? recentTrades.value : [];
    const ordersData = openOrders.status === 'fulfilled' ? openOrders.value : [];

    // Transform balance data to our format
    const balanceData = rawBalanceData ? {
      availableBalance: rawBalanceData.availMgn || '0',
      totalEquity: rawBalanceData.eq || '0',
      unrealizedPnL: rawBalanceData.upl || '0',
      marginBalance: rawBalanceData.eq || '0',
      positionMargin: rawBalanceData.im || '0',
      currency: 'USDT'
    } : null;

    // Calculate summary statistics - Poloniex V3 format
    const totalPositionValue = Array.isArray(positionsData) 
      ? positionsData.reduce((sum: number, pos: any) => {
          const qty = parseFloat(pos.qty || pos.positionAmt || '0');
          const markPrice = parseFloat(pos.markPx || pos.markPrice || '0');
          return sum + (qty * markPrice);
        }, 0)
      : 0;

    const totalPnL = Array.isArray(positionsData)
      ? positionsData.reduce((sum: number, pos: any) => sum + (parseFloat(pos.upl || pos.unrealizedPnl || '0')), 0)
      : 0;

    const activePositionsCount = Array.isArray(positionsData)
      ? positionsData.filter((pos: any) => parseFloat(pos.qty || pos.positionAmt || '0') !== 0).length
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

    let balance;
    try {
      balance = await poloniexFuturesService.getAccountBalance(credentials);
    } catch (apiError: any) {
      // API call failed - return mock data with warning
      logger.warn('Poloniex API call failed, returning mock data:', apiError.message);
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
        mock: true,
        warning: 'Unable to fetch real balance. Please check API credentials and IP whitelist.'
      });
    }
    
    // Transform Poloniex V3 balance format to our format
    const transformedBalance = {
      availableBalance: balance.availMgn || '0',
      totalEquity: balance.eq || '0',
      unrealizedPnL: balance.upl || '0',
      marginBalance: balance.eq || '0',
      positionMargin: balance.im || '0',
      orderMargin: '0',
      frozenFunds: '0',
      currency: 'USDT'
    };
    
    res.json({
      success: true,
      data: transformedBalance
    });

  } catch (error: any) {
    logger.error('Error fetching balance:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
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

    let positions;
    try {
      positions = await poloniexFuturesService.getPositions(credentials);
    } catch (apiError: any) {
      // API call failed - return empty positions with warning
      logger.warn('Poloniex API call failed, returning empty positions:', apiError.message);
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
        mock: true,
        warning: 'Unable to fetch real positions. Please check API credentials and IP whitelist.'
      });
    }
    
    // Calculate summary - Poloniex V3 uses 'qty' for position amount
    const activePositions = Array.isArray(positions)
      ? positions.filter((pos: any) => parseFloat(pos.qty || pos.positionAmt || '0') !== 0)
      : [];

    const totalPnL = activePositions.reduce((sum: number, pos: any) => 
      sum + (parseFloat(pos.upl || pos.unrealizedPnl || '0')), 0);

    // Calculate notional value: qty * markPx
    const totalValue = activePositions.reduce((sum: number, pos: any) => {
      const qty = parseFloat(pos.qty || pos.positionAmt || '0');
      const markPrice = parseFloat(pos.markPx || pos.markPrice || '0');
      return sum + (qty * markPrice);
    }, 0);

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
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
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
