import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { query } from '../db/connection.js';

/**
 * Poloniex Futures v3 API Client Service
 * Complete implementation for all futures trading operations
 * Based on https://api-docs.poloniex.com/v3/futures/
 */
class PoloniexFuturesService {
  constructor() {
    this.baseURL = 'https://api.poloniex.com/v3/futures';
    this.timeout = 30000;
  }

  /**
   * Generate HMAC signature for authentication
   */
  generateSignature(method, endpoint, body, timestamp, apiSecret) {
    try {
      const bodyStr = body ? JSON.stringify(body) : '';
      const message = `${method.toUpperCase()}${endpoint}${bodyStr}${timestamp}`;
      
      return crypto
        .createHmac('sha256', apiSecret)
        .update(message)
        .digest('base64');
    } catch (error) {
      logger.error('Error generating signature:', error);
      throw new Error('Failed to generate API signature');
    }
  }

  /**
   * Make authenticated request to Poloniex Futures API
   */
  async makeRequest(credentials, method, endpoint, body = null, params = {}) {
    try {
      const timestamp = Date.now().toString();
      const url = `${this.baseURL}${endpoint}`;
      
      // Generate query string
      const queryString = Object.keys(params).length > 0
        ? '?' + new globalThis.URLSearchParams(params).toString()
        : '';
      
      const fullUrl = url + queryString;
      const signature = this.generateSignature(method, endpoint + queryString, body, timestamp, credentials.apiSecret);
      
      const headers = {
        'Content-Type': 'application/json',
        'KC-API-KEY': credentials.apiKey,
        'KC-API-SIGN': signature,
        'KC-API-TIMESTAMP': timestamp,
        'KC-API-PASSPHRASE': credentials.passphrase || '',
        'KC-API-KEY-VERSION': '2'
      };
      
      const config = {
        method: method.toLowerCase(),
        url: fullUrl,
        headers,
        timeout: this.timeout
      };
      
      if (body && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
        config.data = body;
      }
      
      if (Object.keys(params).length > 0 && method === 'GET') {
        config.params = params;
      }
      
      logger.info(`Making futures ${method} request to ${endpoint}`);
      const response = await axios(config);
      
      return response.data;
    } catch (error) {
      logger.error('Futures API request error:', error.response?.data || error.message);
      throw error;
    }
  }

  // =================== ACCOUNT MANAGEMENT ===================

  /**
   * Get futures account balance
   */
  async getAccountBalance(credentials) {
    return this.makeRequest(credentials, 'GET', '/account/balance');
  }

  /**
   * Get account bills (transaction history)
   */
  async getAccountBills(credentials, params = {}) {
    return this.makeRequest(credentials, 'GET', '/account/bills', null, params);
  }

  /**
   * Get account overview
   */
  async getAccountOverview(credentials) {
    return this.makeRequest(credentials, 'GET', '/account/overview');
  }

  // =================== POSITION MANAGEMENT ===================

  /**
   * Get current positions
   */
  async getPositions(credentials, symbol = null) {
    const params = symbol ? { symbol } : {};
    return this.makeRequest(credentials, 'GET', '/positions', null, params);
  }

  /**
   * Get position history
   */
  async getPositionHistory(credentials, params = {}) {
    return this.makeRequest(credentials, 'GET', '/positions/history', null, params);
  }

  /**
   * Modify position leverage
   */
  async modifyLeverage(credentials, symbol, leverage) {
    const body = { symbol, leverage };
    return this.makeRequest(credentials, 'POST', '/position/leverage', body);
  }

  /**
   * Set position mode (one-way or hedge)
   */
  async setPositionMode(credentials, mode) {
    const body = { mode }; // 'ONE_WAY' or 'HEDGE'
    return this.makeRequest(credentials, 'POST', '/position/mode', body);
  }

  // =================== ORDER MANAGEMENT ===================

  /**
   * Place a futures order
   */
  async placeOrder(credentials, orderData) {
    const body = {
      clientOid: orderData.clientOid || this.generateClientOrderId(),
      symbol: orderData.symbol,
      side: orderData.side, // 'buy' or 'sell'
      type: orderData.type, // 'limit', 'market', 'stop_limit', 'stop_market'
      size: orderData.size,
      price: orderData.price,
      timeInForce: orderData.timeInForce || 'GTC',
      postOnly: orderData.postOnly || false,
      hidden: orderData.hidden || false,
      iceberg: orderData.iceberg || false,
      visibleSize: orderData.visibleSize,
      stopPrice: orderData.stopPrice,
      stopPriceType: orderData.stopPriceType || 'TP',
      reduceOnly: orderData.reduceOnly || false,
      closeOrder: orderData.closeOrder || false,
      forceHold: orderData.forceHold || false,
      marginMode: orderData.marginMode || 'CROSS',
      leverage: orderData.leverage
    };
    
    // Remove undefined values
    Object.keys(body).forEach(key => {
      if (body[key] === undefined) {
        delete body[key];
      }
    });
    
    return this.makeRequest(credentials, 'POST', '/orders', body);
  }

  /**
   * Cancel an order
   */
  async cancelOrder(credentials, orderId) {
    return this.makeRequest(credentials, 'DELETE', `/orders/${orderId}`);
  }

  /**
   * Cancel all orders
   */
  async cancelAllOrders(credentials, symbol = null) {
    const body = symbol ? { symbol } : {};
    return this.makeRequest(credentials, 'DELETE', '/orders', body);
  }

  /**
   * Get order details
   */
  async getOrder(credentials, orderId) {
    return this.makeRequest(credentials, 'GET', `/orders/${orderId}`);
  }

  /**
   * Get open orders
   */
  async getOpenOrders(credentials, params = {}) {
    return this.makeRequest(credentials, 'GET', '/orders', null, params);
  }

  /**
   * Get order history
   */
  async getOrderHistory(credentials, params = {}) {
    return this.makeRequest(credentials, 'GET', '/orders/history', null, params);
  }

  // =================== TRADE MANAGEMENT ===================

  /**
   * Get trade history
   */
  async getTradeHistory(credentials, params = {}) {
    return this.makeRequest(credentials, 'GET', '/trades', null, params);
  }

  /**
   * Get recent trades
   */
  async getRecentTrades(credentials, params = {}) {
    return this.makeRequest(credentials, 'GET', '/trades/recent', null, params);
  }

  // =================== MARKET DATA ===================

  /**
   * Get all futures products
   */
  async getProducts() {
    return this.makeRequest(null, 'GET', '/contracts/active');
  }

  /**
   * Get product details
   */
  async getProduct(symbol) {
    return this.makeRequest(null, 'GET', `/contracts/${symbol}`);
  }

  /**
   * Get ticker data
   */
  async getTicker(symbol = null) {
    const endpoint = symbol ? `/ticker/${symbol}` : '/ticker';
    return this.makeRequest(null, 'GET', endpoint);
  }

  /**
   * Get order book
   */
  async getOrderBook(symbol, depth = 20) {
    const params = { depth };
    return this.makeRequest(null, 'GET', `/level2/snapshot/${symbol}`, null, params);
  }

  /**
   * Get trade history for a symbol
   */
  async getMarketTrades(symbol) {
    return this.makeRequest(null, 'GET', `/execution/${symbol}`);
  }

  /**
   * Get kline data
   */
  async getKlines(symbol, granularity, params = {}) {
    const queryParams = { granularity, ...params };
    return this.makeRequest(null, 'GET', `/kline/query/${symbol}`, null, queryParams);
  }

  /**
   * Get funding rate
   */
  async getFundingRate(symbol) {
    return this.makeRequest(null, 'GET', `/funding-rate/${symbol}/current`);
  }

  /**
   * Get funding rate history
   */
  async getFundingRateHistory(symbol, params = {}) {
    return this.makeRequest(null, 'GET', `/funding-rate/${symbol}/history`, null, params);
  }

  /**
   * Get open interest
   */
  async getOpenInterest(symbol) {
    return this.makeRequest(null, 'GET', `/open-interest/${symbol}`);
  }

  // =================== RISK MANAGEMENT ===================

  /**
   * Get risk limit
   */
  async getRiskLimit(credentials, symbol) {
    return this.makeRequest(credentials, 'GET', `/risk/limit/${symbol}`);
  }

  /**
   * Update risk limit
   */
  async updateRiskLimit(credentials, symbol, level) {
    const body = { symbol, level };
    return this.makeRequest(credentials, 'POST', '/risk/limit', body);
  }

  /**
   * Get ADL (Auto-Deleveraging) status
   */
  async getADLStatus(credentials) {
    return this.makeRequest(credentials, 'GET', '/risk/adl');
  }

  // =================== DATABASE INTEGRATION ===================

  /**
   * Sync account data to database
   */
  async syncAccountToDatabase(userId, credentials) {
    try {
      const accountData = await this.getAccountBalance(credentials);
      const overview = await this.getAccountOverview(credentials);
      
      // Upsert futures account
      await query(`
        INSERT INTO futures_accounts (
          user_id, poloniex_account_id, total_equity, available_balance,
          initial_margin, maintenance_margin, margin_ratio, position_mode,
          daily_realized_pnl, is_active, last_synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (user_id, poloniex_account_id) 
        DO UPDATE SET
          total_equity = EXCLUDED.total_equity,
          available_balance = EXCLUDED.available_balance,
          initial_margin = EXCLUDED.initial_margin,
          maintenance_margin = EXCLUDED.maintenance_margin,
          margin_ratio = EXCLUDED.margin_ratio,
          position_mode = EXCLUDED.position_mode,
          daily_realized_pnl = EXCLUDED.daily_realized_pnl,
          last_synced_at = EXCLUDED.last_synced_at,
          updated_at = CURRENT_TIMESTAMP
      `, [
        userId,
        accountData.accountId || 'default',
        accountData.totalEquity || 0,
        accountData.availableBalance || 0,
        accountData.initialMargin || 0,
        accountData.maintenanceMargin || 0,
        accountData.marginRatio || 0,
        overview.positionMode || 'ONE_WAY',
        accountData.dailyRealizedPnl || 0,
        true,
        new Date()
      ]);
      
      logger.info(`Synced account data for user ${userId}`);
      return { success: true, accountData, overview };
    } catch (error) {
      logger.error(`Failed to sync account data for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Sync positions to database
   */
  async syncPositionsToDatabase(userId, credentials) {
    try {
      const positions = await this.getPositions(credentials);
      const account = await this.getAccountFromDatabase(userId);
      
      if (!account) {
        throw new Error('Account not found in database');
      }
      
      for (const position of positions) {
        await query(`
          INSERT INTO futures_positions (
            user_id, account_id, symbol, position_side, size, available_size,
            avg_open_price, mark_price, margin_mode, leverage, position_margin,
            liquidation_price, unrealized_pnl, realized_pnl, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (user_id, account_id, symbol, position_side)
          DO UPDATE SET
            size = EXCLUDED.size,
            available_size = EXCLUDED.available_size,
            avg_open_price = EXCLUDED.avg_open_price,
            mark_price = EXCLUDED.mark_price,
            margin_mode = EXCLUDED.margin_mode,
            leverage = EXCLUDED.leverage,
            position_margin = EXCLUDED.position_margin,
            liquidation_price = EXCLUDED.liquidation_price,
            unrealized_pnl = EXCLUDED.unrealized_pnl,
            realized_pnl = EXCLUDED.realized_pnl,
            status = EXCLUDED.status,
            updated_at = CURRENT_TIMESTAMP
        `, [
          userId,
          account.id,
          position.symbol,
          position.side?.toUpperCase() || 'BOTH',
          position.currentQty || 0,
          position.availableQty || 0,
          position.avgEntryPrice || 0,
          position.markPrice || 0,
          position.marginMode || 'CROSS',
          position.leverage || 1,
          position.positionMargin || 0,
          position.liquidationPrice || 0,
          position.unrealisedPnl || 0,
          position.realisedPnl || 0,
          position.status || 'NORMAL'
        ]);
      }
      
      logger.info(`Synced ${positions.length} positions for user ${userId}`);
      return { success: true, positions };
    } catch (error) {
      logger.error(`Failed to sync positions for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get account from database
   */
  async getAccountFromDatabase(userId) {
    const result = await query(
      'SELECT * FROM futures_accounts WHERE user_id = $1 AND is_active = true LIMIT 1',
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Store order in database
   */
  async storeOrderInDatabase(userId, orderData, poloniexResponse) {
    try {
      const account = await this.getAccountFromDatabase(userId);
      if (!account) {
        throw new Error('Account not found in database');
      }
      
      await query(`
        INSERT INTO futures_orders (
          user_id, account_id, poloniex_order_id, client_order_id, symbol,
          side, type, position_side, price, size, leverage, margin_mode,
          time_in_force, reduce_only, post_only, status, poloniex_created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, [
        userId,
        account.id,
        poloniexResponse.orderId,
        orderData.clientOid,
        orderData.symbol,
        orderData.side?.toUpperCase(),
        orderData.type?.toUpperCase(),
        orderData.positionSide?.toUpperCase() || 'BOTH',
        orderData.price || 0,
        orderData.size,
        orderData.leverage || 1,
        orderData.marginMode || 'CROSS',
        orderData.timeInForce || 'GTC',
        orderData.reduceOnly || false,
        orderData.postOnly || false,
        'PENDING',
        new Date()
      ]);
      
      logger.info(`Stored order ${poloniexResponse.orderId} in database`);
      return { success: true };
    } catch (error) {
      logger.error('Failed to store order in database:', error);
      throw error;
    }
  }

  // =================== UTILITY METHODS ===================

  /**
   * Generate client order ID
   */
  generateClientOrderId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate order data
   */
  validateOrderData(orderData) {
    const required = ['symbol', 'side', 'type', 'size'];
    const missing = required.filter(field => !orderData[field]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }
    
    if (orderData.type === 'limit' && !orderData.price) {
      throw new Error('Price is required for limit orders');
    }
    
    if (orderData.size <= 0) {
      throw new Error('Size must be greater than 0');
    }
    
    return true;
  }

  /**
   * Calculate position P&L
   */
  calculatePositionPnL(position, currentPrice) {
    if (!position.size || position.size === 0) {
      return 0;
    }
    
    const entryPrice = position.avg_open_price || position.avgEntryPrice || 0;
    const size = position.size || position.currentQty || 0;
    const isLong = position.position_side === 'LONG' || position.side === 'LONG';
    
    if (isLong) {
      return size * (currentPrice - entryPrice);
    } else {
      return size * (entryPrice - currentPrice);
    }
  }

  /**
   * Calculate liquidation price
   */
  calculateLiquidationPrice(position, maintenanceMarginRate = 0.005) {
    const entryPrice = position.avg_open_price || position.avgEntryPrice || 0;
    const leverage = position.leverage || 1;
    const isLong = position.position_side === 'LONG' || position.side === 'LONG';
    
    if (isLong) {
      return entryPrice * (1 - (1 / leverage) + maintenanceMarginRate);
    } else {
      return entryPrice * (1 + (1 / leverage) + maintenanceMarginRate);
    }
  }

  /**
   * Health check for the service
   */
  async healthCheck() {
    try {
      // Try to get products (public endpoint)
      await this.getProducts();
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'PoloniexFuturesService'
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
        service: 'PoloniexFuturesService'
      };
    }
  }
}

// Create singleton instance
const poloniexFuturesService = new PoloniexFuturesService();

export { PoloniexFuturesService };
export default poloniexFuturesService;