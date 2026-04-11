import express, { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import poloniexSpotService from '../services/poloniexSpotService.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';
import { logger } from '../utils/logger.js';

interface PositionRow {
  qty?: string;
  positionAmt?: string;
  markPx?: string;
  markPrice?: string;
  upl?: string;
  unrealizedPnl?: string;
}

interface TradeRow {
  trdId?: string;
  tradeId?: string;
  id?: string;
  symbol?: string;
  ordId?: string;
  orderId?: string;
  side?: string;
  px?: string;
  fillPx?: string;
  price?: string;
  qty?: string;
  fillSz?: string;
  sz?: string;
  amount?: string;
  realizedPnl?: string;
  feeAmt?: string;
  fee?: string;
  feeCcy?: string;
  commissionAsset?: string;
  cTime?: string | number;
  ts?: string | number;
  time?: string | number;
}

interface SpotBalanceRow {
  currency?: string;
  available?: string;
  hold?: string;
}

interface FuturesData {
  totalEquity: number;
  availableBalance: number;
  unrealizedPnL?: number;
  positionMargin?: number;
}

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
    } catch {
      credentials = null;
    }
    
    if (!credentials) {
      // No credentials found - return demo data with clear indication
      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        data: {
          balance: {
            availableBalance: '0.00',
            totalEquity: '0.00',
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
        mock: true,
        mockReason: 'No API credentials configured. Add your Poloniex API keys in Settings to see real data.'
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
      ? positionsData.reduce((sum: number, pos: PositionRow) => {
          const qty = parseFloat(pos.qty || pos.positionAmt || '0');
          const markPrice = parseFloat(pos.markPx || pos.markPrice || '0');
          return sum + (qty * markPrice);
        }, 0)
      : 0;

    const totalPnL = Array.isArray(positionsData)
      ? positionsData.reduce((sum: number, pos: PositionRow) => sum + (parseFloat(pos.upl || pos.unrealizedPnl || '0')), 0)
      : 0;

    const activePositionsCount = Array.isArray(positionsData)
      ? positionsData.filter((pos: PositionRow) => parseFloat(pos.qty || pos.positionAmt || '0') !== 0).length
      : 0;

    // Transform Poloniex V3 trade data to frontend Trade interface format
    // Poloniex V3 /trade/order/trades returns: px, qty, feeAmt, feeCcy, cTime, trdId, ordId, side, symbol, value, role, ordType
    // Frontend Trade interface expects string types for price/qty/commission to preserve financial precision
    const transformedTrades = Array.isArray(tradesData) 
      ? tradesData.map((trade: TradeRow, index: number) => ({
          id: trade.trdId || trade.tradeId || trade.id || `unknown-${Date.now()}-${index}`,
          symbol: trade.symbol || 'UNKNOWN',
          orderId: trade.ordId || trade.orderId || '',
          side: (trade.side === 'buy' || trade.side === 'BUY') ? 'BUY' : 'SELL',
          price: String(trade.px || trade.fillPx || trade.price || '0'),
          qty: String(trade.qty || trade.fillSz || trade.sz || trade.amount || '0'),
          realizedPnl: String(trade.realizedPnl || '0'),
          commission: String(trade.feeAmt || trade.fee || '0'),
          commissionAsset: trade.feeCcy || trade.commissionAsset || 'USDT',
          time: parseInt(String(trade.cTime || trade.ts || trade.time || Date.now()), 10)
        }))
      : [];

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
        recentTrades: transformedTrades,
        tradesSummary: {
          count: transformedTrades.length,
          last24h: transformedTrades.filter((t) => {
            const tradeTime = t.time;
            const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
            return tradeTime > dayAgo;
          }).length
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

  } catch (error: unknown) {
    logger.error('Error fetching dashboard overview:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data',
      details: errMsg,
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
    const userId = String(req.user.id);
    logger.info('Balance request received', { userId });
    
    // Import mock mode
    const { MOCK_MODE, MOCK_BALANCE } = await import('../middleware/mockMode.js');
    
    // MOCK MODE - Return mock data immediately
    if (MOCK_MODE) {
      logger.info('Mock mode active - returning mock balance', { userId });
      return res.json({
        success: true,
        data: MOCK_BALANCE,
        mock: true,
        message: 'Using mock data - database unavailable or in development mode'
      });
    }
    
    let credentials;
    try {
      credentials = await apiCredentialsService.getCredentials(userId);
      logger.info('Credentials retrieved successfully', { 
        userId, 
        hasCredentials: !!credentials,
        exchange: credentials?.exchange
      });
    } catch (credError: unknown) {
      const ce = credError as { message?: string; stack?: string };
      logger.error('Error retrieving credentials from database', { 
        userId, 
        error: ce.message ?? String(credError),
        stack: ce.stack 
      });
      // Return error instead of mock data
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve API credentials from database',
        details: ce.message ?? String(credError),
        requiresApiKeys: false // Credentials exist but can't be retrieved
      });
    }
    
    if (!credentials) {
      logger.warn('No API credentials found for user', { userId });
      return res.status(400).json({
        success: false,
        error: 'No API credentials configured',
        message: 'Please add your Poloniex API keys in Settings',
        requiresApiKeys: true
      });
    }

    // Try both Spot and Futures APIs
    let totalBalance = 0;
    let availableBalance = 0;
    let unrealizedPnL = 0;
    let balanceSource = 'none';

    // Try Futures first
    try {
      logger.info('Attempting to fetch Futures balance...', { 
        userId,
        exchange: credentials.exchange
      });
      
      const futuresBalance = await poloniexFuturesService.getAccountBalance(credentials);
      
      logger.info('Futures balance fetched successfully:', { 
        userId,
        eq: futuresBalance.eq, 
        availMgn: futuresBalance.availMgn,
        upl: futuresBalance.upl,
        rawBalance: JSON.stringify(futuresBalance)
      });
      
      totalBalance = parseFloat(futuresBalance.eq || futuresBalance.totalEquity || '0');
      availableBalance = parseFloat(futuresBalance.availMgn || futuresBalance.availableBalance || '0');
      unrealizedPnL = parseFloat(futuresBalance.upl || futuresBalance.unrealizedPnL || '0');
      balanceSource = 'futures';
      
      logger.info('Parsed Futures balance values:', {
        userId,
        totalBalance,
        availableBalance,
        unrealizedPnL
      });
    } catch (futuresError: unknown) {
      const fe = futuresError as { message?: string; response?: { status?: number } };
      logger.warn('Futures balance fetch failed, trying Spot:', {
        error: fe.message,
        status: fe.response?.status
      });
      
      // Try Spot API
      try {
        const spotBalances = await poloniexSpotService.getAccountBalances(credentials);
        logger.info('Spot balances fetched successfully:', { 
          count: spotBalances?.length,
          rawBalances: JSON.stringify(spotBalances)
        });
        
        if (Array.isArray(spotBalances)) {
          // Sum up all balances
          totalBalance = spotBalances.reduce((sum, bal: SpotBalanceRow) => {
            const available = parseFloat(bal.available || '0');
            const hold = parseFloat(bal.hold || '0');
            return sum + available + hold;
          }, 0);
          
          availableBalance = spotBalances.reduce((sum, bal: SpotBalanceRow) => {
            return sum + parseFloat(bal.available || '0');
          }, 0);
          
          balanceSource = 'spot';
        }
      } catch (spotError: unknown) {
        const se = spotError as { message?: string };
        logger.error('Both Spot and Futures balance fetch failed:', {
          futuresError: fe.message,
          spotError: se.message
        });
        
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch balance from Poloniex',
          details: 'Both Spot and Futures API calls failed',
          futuresError: fe.message,
          spotError: se.message
        });
      }
    }
    
    // Transform to frontend format
    const transformedBalance = {
      totalBalance,
      availableBalance,
      marginBalance: totalBalance,
      unrealizedPnL,
      currency: 'USDT',
      source: balanceSource
    };
    
    logger.info('Transformed balance:', transformedBalance);
    
    res.json({
      success: true,
      data: transformedBalance
    });

  } catch (error: unknown) {
    logger.error('Error fetching balance:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: errMsg
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
    } catch {
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
    } catch (apiError: unknown) {
      const apiErrMsg = apiError instanceof Error ? apiError.message : String(apiError);
      // API call failed - return empty positions with warning
      logger.warn('Poloniex API call failed, returning empty positions:', apiErrMsg);
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
      ? positions.filter((pos: PositionRow) => parseFloat(pos.qty || pos.positionAmt || '0') !== 0)
      : [];

    const totalPnL = activePositions.reduce((sum: number, pos: PositionRow) => 
      sum + (parseFloat(pos.upl || pos.unrealizedPnl || '0')), 0);

    // Calculate notional value: qty * markPx
    const totalValue = activePositions.reduce((sum: number, pos: PositionRow) => {
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

  } catch (error: unknown) {
    logger.error('Error fetching positions:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: errMsg
    });
  }
});

/**
 * GET /api/dashboard/bills
 * Get account transaction bills/history
 */
router.get('/bills', authenticateToken, async (req: Request, res: Response) => {
  try {
    let credentials;
    try {
      credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    } catch {
      // No credentials found - return empty bills for demo users
      return res.json({
        success: true,
        data: [],
        mock: true,
        message: 'No API credentials configured. Add your Poloniex API keys to view transaction history.'
      });
    }
    
    if (!credentials) {
      return res.json({
        success: true,
        data: [],
        mock: true,
        message: 'No API credentials configured. Add your Poloniex API keys to view transaction history.'
      });
    }

    const limit = parseInt(req.query.limit as string, 10) || 10;
    
    let bills;
    try {
      bills = await poloniexFuturesService.getAccountBills(credentials, { limit });
    } catch (apiError: unknown) {
      const apiErrMsg = apiError instanceof Error ? apiError.message : String(apiError);
      // API call failed - return empty bills with warning
      logger.warn('Poloniex API call failed, returning empty bills:', apiErrMsg);
      return res.json({
        success: true,
        data: [],
        mock: true,
        warning: 'Unable to fetch transaction history. Please check API credentials and IP whitelist.'
      });
    }

    res.json({
      success: true,
      data: bills
    });

  } catch (error: unknown) {
    logger.error('Error fetching account bills:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: errMsg
    });
  }
});

/**
 * GET /api/dashboard/trades
 * Get exchange trade history from Poloniex API
 * Returns actual executed trades from the exchange (not internal bot trades)
 */
router.get('/trades', authenticateToken, async (req: Request, res: Response) => {
  try {
    let credentials;
    try {
      credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    } catch {
      return res.json({
        success: true,
        data: { trades: [], summary: { total: 0, buys: 0, sells: 0, volume: 0 } },
        mock: true,
        message: 'No API credentials configured. Add your Poloniex API keys to view exchange trade history.'
      });
    }

    if (!credentials) {
      return res.json({
        success: true,
        data: { trades: [], summary: { total: 0, buys: 0, sells: 0, volume: 0 } },
        mock: true,
        message: 'No API credentials configured.'
      });
    }

    const limit = parseInt(req.query.limit as string, 10) || 100;

    let tradesData;
    try {
      tradesData = await poloniexFuturesService.getTradeHistory(credentials, { limit });
    } catch (apiError: unknown) {
      const apiErrMsg = apiError instanceof Error ? apiError.message : String(apiError);
      logger.warn('Poloniex trade history API call failed:', apiErrMsg);
      return res.json({
        success: true,
        data: { trades: [], summary: { total: 0, buys: 0, sells: 0, volume: 0 } },
        mock: true,
        warning: 'Unable to fetch exchange trade history. Please check API credentials.'
      });
    }

    const trades = Array.isArray(tradesData)
      ? tradesData.map((trade: TradeRow, index: number) => ({
          id: trade.trdId || trade.tradeId || trade.id || `trade-${Date.now()}-${index}`,
          symbol: trade.symbol || 'UNKNOWN',
          orderId: trade.ordId || trade.orderId || '',
          side: (trade.side === 'buy' || trade.side === 'BUY') ? 'buy' : 'sell',
          price: String(trade.px || trade.fillPx || trade.price || '0'),
          qty: String(trade.qty || trade.fillSz || trade.sz || trade.amount || '0'),
          realizedPnl: String(trade.realizedPnl || '0'),
          fee: String(trade.feeAmt || trade.fee || '0'),
          feeCurrency: trade.feeCcy || trade.commissionAsset || 'USDT',
          time: parseInt(String(trade.cTime || trade.ts || trade.time || Date.now()), 10),
          source: 'exchange' as const
        }))
      : [];

    const buys = trades.filter(t => t.side === 'buy').length;
    const sells = trades.filter(t => t.side === 'sell').length;
    const volume = trades.reduce((sum, t) => {
      const price = parseFloat(t.price) || 0;
      const qty = parseFloat(t.qty) || 0;
      return sum + (price * qty);
    }, 0);

    res.json({
      success: true,
      data: {
        trades,
        summary: {
          total: trades.length,
          buys,
          sells,
          volume
        }
      }
    });

  } catch (error: unknown) {
    logger.error('Error fetching exchange trades:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: errMsg
    });
  }
});

/**
 * GET /api/dashboard/balance/all
 * Get combined balance from both Spot and Futures accounts
 */
router.get('/balance/all', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.json({
        success: true,
        data: {
          spot: { total: 0, available: 0, balances: [] },
          futures: { totalEquity: 0, availableBalance: 0 },
          combined: { total: 0 }
        },
        mock: true,
        message: 'No API credentials configured'
      });
    }

    // Fetch both balances in parallel
    const [spotBalances, futuresBalance] = await Promise.allSettled([
      poloniexSpotService.getAccountBalances(credentials),
      poloniexFuturesService.getAccountBalance(credentials)
    ]);

    // Process Spot balances
    let spotData = { total: 0, available: 0, balances: [] };
    if (spotBalances.status === 'fulfilled' && Array.isArray(spotBalances.value)) {
      const balances = spotBalances.value.map((bal: SpotBalanceRow) => ({
        currency: bal.currency,
        available: parseFloat(bal.available || '0'),
        hold: parseFloat(bal.hold || '0'),
        total: parseFloat(bal.available || '0') + parseFloat(bal.hold || '0')
      }));
      
      spotData = {
        total: balances.reduce((sum, b) => sum + b.total, 0),
        available: balances.reduce((sum, b) => sum + b.available, 0),
        balances: balances.filter(b => b.total > 0)
      };
    }

    // Process Futures balance
    let futuresData: FuturesData = { totalEquity: 0, availableBalance: 0 };
    if (futuresBalance.status === 'fulfilled') {
      const bal = futuresBalance.value as { eq?: string; totalEquity?: string; availMgn?: string; availableBalance?: string; upl?: string; unrealizedPnL?: string; im?: string; positionMargin?: string };
      futuresData = {
        totalEquity: parseFloat(bal.eq || bal.totalEquity || '0'),
        availableBalance: parseFloat(bal.availMgn || bal.availableBalance || '0'),
        unrealizedPnL: parseFloat(bal.upl || bal.unrealizedPnL || '0'),
        positionMargin: parseFloat(bal.im || bal.positionMargin || '0')
      };
    }

    // Combined total (in USDT equivalent)
    const combinedTotal = spotData.total + futuresData.totalEquity;

    res.json({
      success: true,
      data: {
        spot: spotData,
        futures: futuresData,
        combined: {
          total: combinedTotal,
          currency: 'USDT'
        }
      }
    });
  } catch (error: unknown) {
    logger.error('Error fetching combined balance:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch combined balance',
      details: errMsg
    });
  }
});

/**
 * POST /api/dashboard/transfer
 * Transfer funds between Spot and Futures accounts
 */
router.post('/transfer', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.status(400).json({
        success: false,
        error: 'No API credentials found'
      });
    }

    const { currency, amount, fromAccount, toAccount } = req.body;

    // Validate inputs
    if (!currency || !amount || !fromAccount || !toAccount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: currency, amount, fromAccount, toAccount'
      });
    }

    // Validate account types
    const validAccounts = ['SPOT', 'FUTURES'];
    if (!validAccounts.includes(fromAccount) || !validAccounts.includes(toAccount)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account type. Use SPOT or FUTURES'
      });
    }

    if (fromAccount === toAccount) {
      return res.status(400).json({
        success: false,
        error: 'Cannot transfer to the same account'
      });
    }

    // Execute transfer
    const result = await poloniexSpotService.transferBetweenAccounts(credentials, {
      currency,
      amount: parseFloat(amount),
      fromAccount,
      toAccount
    });

    logger.info(`Transfer completed for user ${req.user.id}: ${amount} ${currency} from ${fromAccount} to ${toAccount}`);

    res.json({
      success: true,
      message: `Successfully transferred ${amount} ${currency} from ${fromAccount} to ${toAccount}`,
      data: result
    });
  } catch (error: unknown) {
    logger.error('Error transferring funds:', error);
    const err = error as { message?: string; response?: { data?: unknown } };
    res.status(500).json({
      success: false,
      error: 'Failed to transfer funds',
      details: err.response?.data || err.message
    });
  }
});

/**
 * GET /api/dashboard/transfer/history
 * Get transfer history between accounts
 */
router.get('/transfer/history', authenticateToken, async (req: Request, res: Response) => {
  try {
    const credentials = await apiCredentialsService.getCredentials(String(req.user.id));
    
    if (!credentials) {
      return res.json({
        success: true,
        data: [],
        message: 'No API credentials configured'
      });
    }

    const limit = parseInt(req.query.limit as string, 10) || 50;
    const history = await poloniexSpotService.getTransferHistory(credentials, { limit });

    res.json({
      success: true,
      data: history
    });
  } catch (error: unknown) {
    logger.error('Error fetching transfer history:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transfer history',
      details: errMsg
    });
  }
});

export default router;
