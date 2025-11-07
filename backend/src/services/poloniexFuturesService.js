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
    this.baseURL = 'https://api.poloniex.com';
    this.timeout = 30000;
  }

  /**
   * Generate HMAC-SHA256 signature for Poloniex v3 API authentication
   * Per specification: https://api-docs.poloniex.com/v3/futures/api/#authentication
   */
  generateSignature(method, requestPath, body, timestamp, apiSecret) {
    try {
      // Build the message string for signing per Poloniex v3 spec
      // Format: METHOD\n + ENDPOINT\n + BODY_JSON (if present) + signTimestamp
      const bodyStr = body ? JSON.stringify(body) : '';
      const message = `${method.toUpperCase()}\n${requestPath}\n${bodyStr}${timestamp}`;
      
      return crypto
        .createHmac('sha256', apiSecret)
        .update(message)
        .digest('base64');
    } catch (error) {
      logger.error('Error generating Poloniex v3 signature:', error);
      throw new Error('Failed to generate API signature');
    }
  }

  /**
   * Make authenticated request to Poloniex Futures v3 API
   * Uses proper Poloniex v3 authentication headers and endpoints
   */
  async makeRequest(credentials, method, endpoint, body = null, params = {}) {
    try {
      const timestamp = Date.now().toString();
      
      // Build the proper v3 endpoint path
      const requestPath = `/v3${endpoint}`;
      const url = `${this.baseURL}${requestPath}`;
      
      // Generate query string and update request path if needed
      const queryString = Object.keys(params).length > 0
        ? '?' + new globalThis.URLSearchParams(params).toString()
        : '';
      
      const fullRequestPath = requestPath + queryString;
      const fullUrl = url + queryString;
      
      // Generate signature using the full request path with query params
      const signature = this.generateSignature(method, fullRequestPath, body, timestamp, credentials.apiSecret);
      
      // Use correct Poloniex v3 headers (not KuCoin headers)
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
        timeout: this.timeout
      };
      
      if (body && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
        config.data = body;
      }
      
      if (Object.keys(params).length > 0 && method === 'GET') {
        config.params = params;
      }
      
      logger.info(`Making Poloniex v3 futures ${method} request to ${requestPath}`);
      const response = await axios(config);
      
      return response.data;
    } catch (error) {
      logger.error('Poloniex v3 futures API request error:', {
        endpoint: endpoint,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
  }

  // =================== ACCOUNT MANAGEMENT ===================

  /**
   * Get futures account balance
   * Endpoint: GET /v3/account/balance
   */
  async getAccountBalance(credentials) {
    return this.makeRequest(credentials, 'GET', '/account/balance');
  }

  /**
   * Get account bills (transaction history)
   * Endpoint: GET /v3/account/bills
   */
  async getAccountBills(credentials, params = {}) {
    return this.makeRequest(credentials, 'GET', '/account/bills', null, params);
  }

  // =================== POSITION MANAGEMENT ===================

  /**
   * Get current positions
   * Endpoint: GET /v3/trade/position/opens
   */
  async getPositions(credentials, symbol = null) {
    const params = symbol ? { symbol } : {};
    return this.makeRequest(credentials, 'GET', '/trade/position/opens', null, params);
  }

  /**
   * Get position history
   * Endpoint: GET /v3/trade/position/history
   */
  async getPositionHistory(credentials, params = {}) {
    return this.makeRequest(credentials, 'GET', '/trade/position/history', null, params);
  }

  /**
   * Get leverages for positions
   * Endpoint: GET /v3/position/leverages
   */
  async getLeverages(credentials, symbol = null) {
    const params = symbol ? { symbol } : {};
    return this.makeRequest(credentials, 'GET', '/position/leverages', null, params);
  }

  /**
   * Set leverage for a position
   * Endpoint: POST /v3/position/leverage
   */
  async setLeverage(credentials, symbol, leverage) {
    const body = { symbol, leverage };
    return this.makeRequest(credentials, 'POST', '/position/leverage', body);
  }

  /**
   * Get position mode (isolated/cross margin)
   * Endpoint: GET /v3/position/mode
   */
  async getPositionMode(credentials, symbol) {
    const params = { symbol };
    return this.makeRequest(credentials, 'GET', '/position/mode', null, params);
  }

  /**
   * Switch position mode (isolated/cross margin)
   * Endpoint: POST /v3/position/mode
   */
  async switchPositionMode(credentials, symbol, mode) {
    const body = { symbol, mode }; // mode: 'ISOLATED' or 'CROSS'
    return this.makeRequest(credentials, 'POST', '/position/mode', body);
  }

  /**
   * Adjust margin for isolated margin trading positions
   * Endpoint: POST /v3/trade/position/margin
   */
  async adjustMargin(credentials, symbol, amount, type) {
    const body = { 
      symbol, 
      amount, 
      type // 'ADD' or 'REDUCE'
    };
    return this.makeRequest(credentials, 'POST', '/trade/position/margin', body);
  }

  // =================== ORDER MANAGEMENT ===================

  /**
   * Place a futures order
   * Endpoint: POST /v3/trade/order
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
      forceHold: orderData.forceHold || false
    };
    
    // Remove undefined values
    Object.keys(body).forEach(key => {
      if (body[key] === undefined) {
        delete body[key];
      }
    });
    
    return this.makeRequest(credentials, 'POST', '/trade/order', body);
  }

  /**
   * Place multiple orders
   * Endpoint: POST /v3/trade/orders
   */
  async placeMultipleOrders(credentials, orders) {
    const body = { orders };
    return this.makeRequest(credentials, 'POST', '/trade/orders', body);
  }

  /**
   * Cancel an order
   * Endpoint: DELETE /v3/trade/order
   */
  async cancelOrder(credentials, orderId, clientOid = null) {
    const body = {};
    if (orderId) body.orderId = orderId;
    if (clientOid) body.clientOid = clientOid;
    
    return this.makeRequest(credentials, 'DELETE', '/trade/order', body);
  }

  /**
   * Cancel multiple orders
   * Endpoint: DELETE /v3/trade/batchOrders
   */
  async cancelMultipleOrders(credentials, orderIds = [], clientOids = []) {
    const body = {};
    if (orderIds.length > 0) body.orderIds = orderIds;
    if (clientOids.length > 0) body.clientOids = clientOids;
    
    return this.makeRequest(credentials, 'DELETE', '/trade/batchOrders', body);
  }

  /**
   * Cancel all orders
   * Endpoint: DELETE /v3/trade/allOrders
   */
  async cancelAllOrders(credentials, symbol = null) {
    const body = symbol ? { symbol } : {};
    return this.makeRequest(credentials, 'DELETE', '/trade/allOrders', body);
  }

  /**
   * Get current open orders
   * Endpoint: GET /v3/trade/order/opens
   */
  async getCurrentOrders(credentials, symbol = null) {
    const params = symbol ? { symbol } : {};
    return this.makeRequest(credentials, 'GET', '/trade/order/opens', null, params);
  }

  /**
   * Get order history
   * Endpoint: GET /v3/trade/order/history
   */
  async getOrderHistory(credentials, params = {}) {
    return this.makeRequest(credentials, 'GET', '/trade/order/history', null, params);
  }

  /**
   * Get execution details (fills)
   * Endpoint: GET /v3/trade/order/trades
   */
  async getExecutionDetails(credentials, params = {}) {
    return this.makeRequest(credentials, 'GET', '/trade/order/trades', null, params);
  }

  /**
   * Close position at market price
   * Endpoint: POST /v3/trade/position
   */
  async closePosition(credentials, symbol, type = 'close_long') {
    const body = { symbol, type }; // type: 'close_long' or 'close_short'
    return this.makeRequest(credentials, 'POST', '/trade/position', body);
  }

  /**
   * Close all positions at market price
   * Endpoint: POST /v3/trade/positionAll
   */
  async closeAllPositions(credentials) {
    return this.makeRequest(credentials, 'POST', '/trade/positionAll', {});
  }

  // =================== MARKET DATA (PUBLIC) ===================

  /**
   * Make public request to Poloniex Futures v3 API (no authentication)
   */
  async makePublicRequest(method, endpoint, params = {}) {
    try {
      const requestPath = `/v3${endpoint}`;
      const url = `${this.baseURL}${requestPath}`;
      
      const queryString = Object.keys(params).length > 0
        ? '?' + new globalThis.URLSearchParams(params).toString()
        : '';
      
      const fullUrl = url + queryString;
      
      const config = {
        method: method.toLowerCase(),
        url: fullUrl,
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      };
      
      if (Object.keys(params).length > 0 && method === 'GET') {
        config.params = params;
      }
      
      logger.info(`Making Poloniex v3 public ${method} request to ${requestPath}`);
      const response = await axios(config);
      
      return response.data;
    } catch (error) {
      logger.error('Poloniex v3 public API request error:', {
        endpoint: endpoint,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
  }

  /**
   * Get all product info
   * Endpoint: GET /v3/market/allInstruments
   */
  async getProducts() {
    return this.makePublicRequest('GET', '/market/allInstruments');
  }

  /**
   * Get specific product info
   * Endpoint: GET /v3/market/instruments
   */
  async getProduct(symbol) {
    const params = { symbol };
    return this.makePublicRequest('GET', '/market/instruments', params);
  }

  /**
   * Get market tickers
   * Endpoint: GET /v3/market/tickers
   */
  async getTickers(symbol = null) {
    const params = symbol ? { symbol } : {};
    return this.makePublicRequest('GET', '/market/tickers', params);
  }

  /**
   * Get order book
   * Endpoint: GET /v3/market/orderBook
   */
  async getOrderBook(symbol, depth = 20) {
    const params = { symbol, depth };
    return this.makePublicRequest('GET', '/market/orderBook', params);
  }

  /**
   * Get market trades (execution info)
   * Endpoint: GET /v3/market/trades
   */
  async getMarketTrades(symbol) {
    const params = { symbol };
    return this.makePublicRequest('GET', '/market/trades', params);
  }

  /**
   * Get K-line data (candlesticks)
   * Endpoint: GET /v3/market/candles
   */
  async getKlines(symbol, granularity, params = {}) {
    const queryParams = { symbol, granularity, ...params };
    return this.makePublicRequest('GET', '/market/candles', queryParams);
  }

  /**
   * Get historical OHLCV data for ML training and analysis
   * @param {string} symbol - Trading symbol (e.g., 'BTCUSDTPERP')
   * @param {string} interval - Candle interval ('1m', '5m', '15m', '30m', '1h', '4h', '1d')
   * @param {number} limit - Number of candles to fetch (max 1500)
   * @returns {Promise<Array>} Array of OHLCV data [{timestamp, open, high, low, close, volume}]
   */
  async getHistoricalData(symbol, interval = '1h', limit = 200) {
    try {
      // Map interval to Poloniex granularity (in seconds)
      const granularityMap = {
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '30m': 1800,
        '1h': 3600,
        '1H': 3600,
        '4h': 14400,
        '4H': 14400,
        '1d': 86400,
        '1D': 86400
      };

      const granularity = granularityMap[interval];
      if (!granularity) {
        throw new Error(`Invalid interval: ${interval}. Use 1m, 5m, 15m, 30m, 1h, 4h, or 1d`);
      }

      // Poloniex limits to 1500 candles per request
      const actualLimit = Math.min(limit, 1500);

      // Calculate time range
      const endTime = Date.now();
      const startTime = endTime - (granularity * 1000 * actualLimit);

      // Fetch candles
      const params = {
        from: Math.floor(startTime / 1000),
        to: Math.floor(endTime / 1000)
      };

      const candles = await this.getKlines(symbol, granularity, params);

      // Transform to standard OHLCV format
      if (!candles || !Array.isArray(candles)) {
        logger.warn(`No historical data returned for ${symbol}`);
        return [];
      }

      return candles.map(candle => ({
        timestamp: candle[0] * 1000, // Convert to milliseconds
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5])
      }));

    } catch (error) {
      logger.error(`Error fetching historical data for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get mark price K-line data
   * Endpoint: GET /v3/market/markPriceCandlesticks
   */
  async getMarkPriceKlines(symbol, granularity, params = {}) {
    const queryParams = { symbol, granularity, ...params };
    return this.makePublicRequest('GET', '/market/markPriceCandlesticks', queryParams);
  }

  /**
   * Get index price
   * Endpoint: GET /v3/market/indexPrice
   */
  async getIndexPrice(symbol) {
    const params = { symbol };
    return this.makePublicRequest('GET', '/market/indexPrice', params);
  }

  /**
   * Get mark price
   * Endpoint: GET /v3/market/markPrice
   */
  async getMarkPrice(symbol) {
    const params = { symbol };
    return this.makePublicRequest('GET', '/market/markPrice', params);
  }

  /**
   * Get current funding rate
   * Endpoint: GET /v3/market/fundingRate
   */
  async getFundingRate(symbol) {
    const params = { symbol };
    return this.makePublicRequest('GET', '/market/fundingRate', params);
  }

  /**
   * Get historical funding rates
   * Endpoint: GET /v3/market/fundingRate/history
   */
  async getFundingRateHistory(symbol, params = {}) {
    const queryParams = { symbol, ...params };
    return this.makePublicRequest('GET', '/market/fundingRate/history', queryParams);
  }

  /**
   * Get current open positions (open interest)
   * Endpoint: GET /v3/market/openInterest
   */
  async getOpenInterest(symbol) {
    const params = { symbol };
    return this.makePublicRequest('GET', '/market/openInterest', params);
  }

  /**
   * Get futures risk limit information
   * Endpoint: GET /v3/market/riskLimit
   */
  async getRiskLimit(symbol) {
    const params = { symbol };
    return this.makePublicRequest('GET', '/market/riskLimit', params);
  }

  /**
   * Get liquidation orders
   * Endpoint: GET /v3/market/liquidationOrder
   */
  async getLiquidationOrders(symbol) {
    const params = { symbol };
    return this.makePublicRequest('GET', '/market/liquidationOrder', params);
  }

  /**
   * Query insurance fund information
   * Endpoint: GET /v3/market/insurance
   */
  async getInsuranceFund() {
    return this.makePublicRequest('GET', '/market/insurance');
  }

  // =================== DATABASE INTEGRATION ===================

  /**
   * Sync account data to database
   */
  async syncAccountToDatabase(userId, credentials) {
    try {
      const accountData = await this.getAccountBalance(credentials);
      
      // Upsert futures account
      await query(`
        INSERT INTO futures_accounts (
          user_id, poloniex_account_id, total_equity, available_balance,
          initial_margin, maintenance_margin, margin_ratio,
          daily_realized_pnl, is_active, last_synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id, poloniex_account_id) 
        DO UPDATE SET
          total_equity = EXCLUDED.total_equity,
          available_balance = EXCLUDED.available_balance,
          initial_margin = EXCLUDED.initial_margin,
          maintenance_margin = EXCLUDED.maintenance_margin,
          margin_ratio = EXCLUDED.margin_ratio,
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
        accountData.dailyRealizedPnl || 0,
        true,
        new Date()
      ]);
      
      logger.info(`Synced account data for user ${userId}`);
      return { success: true, accountData };
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
          side, type, position_side, price, size, margin_mode,
          time_in_force, reduce_only, post_only, status, poloniex_created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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