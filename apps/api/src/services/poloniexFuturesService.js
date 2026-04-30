import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { query } from '../db/connection.js';
import rateLimiter from '../utils/rateLimiter.js';
import { apiCache, getTtlForEndpoint } from '../utils/apiCache.js';

/**
 * Serialize query params deterministically (sorted keys) so that
 * {b:2, a:1} and {a:1, b:2} produce the same cache key.
 */
function serializeParams(params) {
  if (!params || Object.keys(params).length === 0) return '{}';
  const sorted = Object.keys(params).sort().reduce((acc, k) => {
    acc[k] = params[k];
    return acc;
  }, {});
  return JSON.stringify(sorted);
}

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
       * Normalize symbol to Poloniex Futures format
          * Converts BTC_USDT -> BTC_USDT_PERP for endpoints that require it
             */
    normalizeSymbol(symbol) {
      if (!symbol) return symbol;
      const normalizedBase = symbol.replace('-', '_');
      // Already in correct format
      if (normalizedBase.endsWith('_PERP') || normalizedBase.includes('PERP')) return normalizedBase;
      // Convert SPOT format to PERP format for futures
      return `${normalizedBase}_PERP`;
    }
  

  /**
   * Generate HMAC-SHA256 signature for Poloniex v3 API authentication
   * Per specification: https://api-docs.poloniex.com/v3/futures/api/#authentication
   * 
   * Format for GET/DELETE with query params:
   *   METHOD\n
   *   /path\n
   *   param1=value1&param2=value2&signTimestamp=123456
   * 
   * Format for POST/PUT with body:
   *   METHOD\n
   *   /path\n
   *   requestBody={"key":"value"}&signTimestamp=123456
   * 
   * Format for DELETE with no params:
   *   METHOD\n
   *   /path\n
   *   signTimestamp=123456
   */
  generateSignature(method, requestPath, params, body, timestamp, apiSecret) {
    try {
      const methodUpper = method.toUpperCase();
      
      // Build parameter string
      let paramString = '';
      
      if (body && (methodUpper === 'POST' || methodUpper === 'PUT')) {
        // For POST/PUT with body
        const bodyJson = JSON.stringify(body);
        paramString = `requestBody=${bodyJson}&signTimestamp=${timestamp}`;
      } else if (params && Object.keys(params).length > 0) {
        // For GET/DELETE with query params
        // Sort parameters by ASCII order and add timestamp
        const allParams = { ...params, signTimestamp: timestamp };
        const sortedKeys = Object.keys(allParams).sort();
        paramString = sortedKeys
          .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(allParams[key])}`)
          .join('&');
      } else {
        // For DELETE/GET with no params, just timestamp
        paramString = `signTimestamp=${timestamp}`;
      }
      
      // Build the message string with actual newlines (not escaped)
      const message = `${methodUpper}\n${requestPath}\n${paramString}`;
      
      logger.debug('Signature message:', { message, timestamp });
      
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
    // Check cache for GET requests before hitting the API
    if (method === 'GET') {
      const cacheKey = `GET:${endpoint}:${serializeParams(params)}`;
      const cached = apiCache.get(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }

    // Apply rate limiting
    return rateLimiter.execute(endpoint, async () => {
      try {
        const timestamp = Date.now().toString();

        // Normalize symbol to _PERP format in body and params for all authenticated endpoints
        if (body && typeof body === 'object' && body.symbol) {
          body = { ...body, symbol: this.normalizeSymbol(body.symbol) };
        }
        if (params && typeof params === 'object' && params.symbol) {
          params = { ...params, symbol: this.normalizeSymbol(params.symbol) };
        }
        
        // Build the proper v3 endpoint path (without query string for signature)
        const requestPath = `/v3${endpoint}`;
        const url = `${this.baseURL}${requestPath}`;
        
        // Generate signature with params (signature includes params but not in URL path)
        const signature = this.generateSignature(method, requestPath, params, body, timestamp, credentials.apiSecret);
        
        // Build query string for actual request URL
        const queryString = Object.keys(params).length > 0
          ? '?' + new globalThis.URLSearchParams(params).toString()
          : '';
        
        const fullUrl = url + queryString;
        
        // Use correct Poloniex V3 Futures API headers per official documentation
        // https://api-docs.poloniex.com/v3/futures/api/
        // V3 API uses: key, signature, signTimestamp (NO PF- prefix, NO passphrase)
        const headers = {
          'Content-Type': 'application/json',
          'key': credentials.apiKey,
          'signature': signature,
          'signTimestamp': timestamp,
          'signatureMethod': 'hmacSHA256',
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
        
        logger.info(`Making Poloniex v3 futures ${method} request to ${requestPath}`, {
          url: fullUrl,
          hasApiKey: !!credentials.apiKey,
          timestamp,
          headers: {
            signTimestamp: timestamp,
            signatureMethod: headers.signatureMethod,
            signatureVersion: headers.signatureVersion
          }
        });
        const response = await axios(config);

        // Poloniex V3 API envelope: { code: 200, data: {...}, msg: "Success" }.
        // A non-200 body code is an application error even when HTTP is 200 —
        // most commonly seen on POST /v3/trade/order where HTTP returns 200
        // but the body is { code: <non-200>, msg: "<reason>" } with no data.
        // Previously we silently returned that error object as if it were the
        // result, causing the exchange-order placeOrder path to look successful
        // while actually failing (diagnosed 2026-04-19: every liveSignal tick
        // was "placing" an order that never executed, then the reconciler was
        // closing the phantom DB row seconds later).
        const bodyCode = response?.data?.code;
        const bodyMsg = response?.data?.msg;
        const isApplicationError =
          bodyCode !== undefined &&
          bodyCode !== null &&
          bodyCode !== 200 &&
          bodyCode !== 0 &&
          String(bodyCode) !== 'SUCCESS';

        logger.info('Poloniex API response received', {
          endpoint: requestPath,
          status: response.status,
          hasData: !!response.data,
          dataKeys: response.data ? Object.keys(response.data) : [],
          bodyCode,
          bodyMsg,
        });

        if (isApplicationError) {
          const err = new Error(`Poloniex ${requestPath} returned code=${bodyCode}: ${bodyMsg ?? 'no message'}`);
          // Attach context so callers that care (submitOrder) can surface it.
          err.poloniexCode = bodyCode;
          err.poloniexMsg = bodyMsg;
          err.endpoint = requestPath;
          throw err;
        }

        // Extract the data field if present, otherwise return the full response.
        let result;
        if (response.data && typeof response.data === 'object' && 'data' in response.data) {
          result = response.data.data;
        } else {
          result = response.data;
        }

        // Cache successful GET responses
        if (method === 'GET') {
          const ttl = getTtlForEndpoint(endpoint);
          if (ttl > 0) {
            const cacheKey = `GET:${endpoint}:${serializeParams(params)}`;
            apiCache.set(cacheKey, result, ttl);
          }
        }

        return result;
      } catch (error) {
        logger.error('Poloniex v3 futures API request error:', {
          endpoint: endpoint,
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message
        });
        throw error;
      }
    });
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
   * Get account overview / info
   * Endpoint: GET /v3/account/overview
   * Returns account summary including balance, margin, P&L
   */
  async getAccountInfo(credentials) {
    try {
      const balanceData = await this.getAccountBalance(credentials);
      return {
        balance: balanceData.availMgn || balanceData.availableBalance || 0,
        totalEquity: balanceData.eq || balanceData.totalEquity || 0,
        unrealisedPnl: balanceData.upl || balanceData.unrealisedPnl || 0,
        frozenFunds: balanceData.frozenFunds || 0,
        marginBalance: balanceData.mgn || balanceData.marginBalance || 0,
        accountId: balanceData.accountId || 'default'
      };
    } catch (error) {
      logger.error('Error fetching account info:', error);
      throw error;
    }
  }

  /**
   * Transfer funds from futures account to spot/exchange account
   * Endpoint: POST /v3/account/transfer-out
   * 
   * @param {Object} credentials - API credentials
   * @param {number} amount - Amount to transfer (USDT)
   * @returns {Promise<Object>} Transfer result { success: boolean, transferId?: string, error?: string }
   */
  async transferToSpot(credentials, amount) {
    try {
      if (!amount || amount <= 0) {
        return { success: false, error: 'Transfer amount must be positive' };
      }

      const body = {
        currency: 'USDT',
        amount: String(amount)
      };

      const result = await this.makeRequest(credentials, 'POST', '/account/transfer-out', body);
      
      logger.info(`Transferred ${amount} USDT from futures to spot`, { result });
      return {
        success: true,
        transferId: result?.applyId || result?.transferId || `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
    } catch (error) {
      logger.error('Error transferring to spot:', error);
      return {
        success: false,
        error: error.message || 'Transfer failed'
      };
    }
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
   *
   * Poloniex V3 expects `lever` (stringified) NOT `leverage`, plus `mgnMode`
   * (CROSS|ISOLATED). Sending `{ symbol, leverage }` as we did previously
   * produced `{ code: 400, msg: "Param error lever" }` on the live API
   * (Railway prod, 2026-04-19), which caused every live tick to log a
   * (non-fatal) leverage-set failure right before order placement.
   *
   * Position-mode semantics (verified on prod 2026-04-30 after the HEDGE
   * flip in PR #611):
   *   - HEDGE  account → body MUST carry `posSide: 'LONG' | 'SHORT'` matching
   *     the side of the position about to be opened. Omitting it (or sending
   *     `BOTH`) returns code=11011 "Position mode and posSide do not match"
   *     and leverage stays at the exchange default — which in turn caused
   *     the warn-log spam at every Monkey entry.
   *   - ONE_WAY account → `posSide` is either omitted or `BOTH`. We default
   *     to omitting it so the same call site works regardless of mode and
   *     the caller (kernel/loop.ts) decides via its cached
   *     ``positionDirectionMode`` whether to pass posSide.
   *
   * The web UI already used the correct shape — see
   * apps/web/src/context/FuturesContext.tsx::setLeverage which posts
   * `{ symbol, lever, mgnMode }`.
   *
   * @param {Object} credentials
   * @param {string} symbol             e.g. 'BTC_USDT_PERP'
   * @param {number|string} leverage    numeric leverage (2..125)
   * @param {Object} [opts]
   * @param {'CROSS'|'ISOLATED'} [opts.mgnMode='CROSS']  margin mode;
   *   defaults to CROSS per shared/constants.ts::FUTURES_DEFAULTS
   *   and the agent dashboard default.
   * @param {'LONG'|'SHORT'|'BOTH'} [opts.posSide]  position side. Pass
   *   `LONG` or `SHORT` when the account is in HEDGE mode — the
   *   exchange rejects the call with code=11011 if this is missing on a
   *   HEDGE account. Omit (or pass `BOTH`) on a ONE_WAY account.
   */
  async setLeverage(credentials, symbol, leverage, opts = {}) {
    const body = {
      symbol,
      lever: String(leverage),
      mgnMode: opts.mgnMode || 'CROSS',
    };
    if (opts.posSide) {
      // Normalise to upper case so callers can pass 'long'/'short' too.
      body.posSide = String(opts.posSide).toUpperCase();
    }
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
   * Get position direction mode (HEDGE | ONE_WAY).
   * Endpoint: GET /v3/position/mode
   *
   * NOTE — distinct from `getPositionMode` above which historically returned
   * the (mis-named) margin mode. Per the v3 reference (apps/api/docs/
   * poloniex-v3-reference.md §Position) the canonical body field is
   * `posMode`, returning `HEDGE` (LONG/SHORT two-way positions) or
   * `ONE_WAY` (BOTH net position).
   *
   * Used by the lane-isolated position lifecycle (proposal #10) — hedge
   * mode is required so a swing-long and a scalp-short can coexist on
   * the same symbol as two independent positions.
   */
  async getPositionDirectionMode(credentials) {
    return this.makeRequest(credentials, 'GET', '/position/mode', null, {});
  }

  /**
   * Set position direction mode (HEDGE | ONE_WAY).
   * Endpoint: POST /v3/position/mode  body { posMode }
   *
   * Idempotent — Poloniex returns the current mode if already set; we
   * pass through the response. Throws on Poloniex 4xx errors (e.g. an
   * attempted switch with open positions on the account is rejected
   * exchange-side; the caller should defer until positions close).
   *
   * @param {Object} credentials
   * @param {'HEDGE'|'ONE_WAY'} posMode
   */
  async setPositionDirectionMode(credentials, posMode) {
    const upper = String(posMode).toUpperCase();
    if (upper !== 'HEDGE' && upper !== 'ONE_WAY') {
      throw new Error(`setPositionDirectionMode: invalid posMode ${posMode}`);
    }
    const body = { posMode: upper };
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

  /**
   * Get user position risk limit
   * Endpoint: GET /v3/position/risk-limit
   * 
   * @param {Object} credentials - API credentials
   * @param {string} symbol - Trading symbol
   * @returns {Promise<Object>} Risk limit information
   */
  async getUserRiskLimit(credentials, symbol) {
    const params = { symbol };
    return this.makeRequest(credentials, 'GET', '/position/risk-limit', null, params);
  }

  // =================== MARKET DATA ===================

  /**
   * Get 24h trading statistics
   * Endpoint: GET /v3/market/get-trading-info
   */
  async getTradingInfo(symbol = null) {
    try {
      const params = symbol ? { symbol } : {};
      const url = `${this.baseURL}/v3/market/get-trading-info`;
      const queryString = Object.keys(params).length > 0
        ? '?' + new URLSearchParams(params).toString()
        : '';
      
      const response = await axios.get(url + queryString, { timeout: this.timeout });
      return response.data;
    } catch (error) {
      logger.error('Error fetching trading info:', error);
      throw error;
    }
  }

  /**
   * Get kline/candlestick data
   * Endpoint: GET /v3/market/get-kline-data
   * 
   * @param {string} symbol - Trading pair
   * @param {string} granularity - Candle interval (1, 5, 15, 30, 60, 120, 240, 480, 720, 1440, 10080)
   * @param {Object} [params] - Additional parameters
   * @param {number} [params.from] - Start timestamp
   * @param {number} [params.to] - End timestamp
   */
  async getKlineData(symbol, granularity, params = {}) {
    try {
      if (!symbol || !granularity) {
        throw new Error('Symbol and granularity are required');
      }

      const queryParams = {
        symbol,
        granularity,
        ...params
      };

      const url = `${this.baseURL}/v3/market/get-kline-data`;
      const queryString = new URLSearchParams(queryParams).toString();
      
      const response = await axios.get(`${url}?${queryString}`, { timeout: this.timeout });
      return response.data;
    } catch (error) {
      logger.error('Error fetching kline data:', error);
      throw error;
    }
  }



  /**
   * Get contract information
   * Endpoint: GET /v3/market/get-contract-info
   * 
   * @param {string} [symbol] - Trading pair (optional, returns all if not provided)
   */
  async getContractInfo(symbol = null) {
    try {
      const params = symbol ? { symbol } : {};
      const url = `${this.baseURL}/v3/market/get-contract-info`;
      const queryString = Object.keys(params).length > 0
        ? '?' + new URLSearchParams(params).toString()
        : '';
      
      const response = await axios.get(url + queryString, { timeout: this.timeout });
      return response.data;
    } catch (error) {
      logger.error('Error fetching contract info:', error);
      throw error;
    }
  }

  // =================== ORDER MANAGEMENT ===================

  /**
   * Place a futures order
   * Endpoint: POST /v3/trade/order
   *
   * Poloniex v3 Futures body schema (verified against
   * https://api-docs.poloniex.com/v3/futures/api/trade/place-order
   * on 2026-04-19 after production Param error surfaced via PR #506):
   *
   *   Required: symbol, side (UPPER), mgnMode, posSide, type (UPPER), sz
   *   sz is a STRING, in CONTRACTS (not base asset). Caller is
   *   responsible for converting base-asset quantity → contracts via
   *   marketCatalog.lotSize (1 contract = lotSize base units).
   *   Optional: clOrdId, px (limit only), reduceOnly, timeInForce,
   *   stpMode, and trigger-order-specific fields.
   *
   * Caller still passes the ergonomic shape (`side: 'buy'`,
   * `type: 'market'`, `size: <base asset>`); this method normalises
   * to v3 wire form. `lotSize` in the optional 4th arg (or the
   * catalog lookup) tells us how to convert size → sz.
   */
  async placeOrder(credentials, orderData, opts = {}) {
    // Normalise side + type to UPPER per v3 spec.
    const side = String(orderData.side ?? '').toUpperCase();
    const typeRaw = String(orderData.type ?? 'market').toLowerCase();
    const typeUpper = typeRaw === 'market' ? 'MARKET'
      : typeRaw === 'limit' ? 'LIMIT'
      : typeRaw === 'limit_maker' ? 'LIMIT_MAKER'
      // stop_market / stop_limit — historical names; map conservatively to MARKET.
      // If the caller wanted a true trigger order, they should be using the
      // dedicated trigger endpoint, not this one.
      : typeRaw === 'stop_market' ? 'MARKET'
      : typeRaw === 'stop_limit' ? 'LIMIT'
      : typeRaw.toUpperCase();

    // Convert size (base asset) → sz (contracts). lotSize is the size of one
    // contract in base-asset units. e.g. BTC_USDT_PERP lotSize = 0.001 means
    // 1 contract = 0.001 BTC; if caller wants 0.001 BTC exposure, pass
    // size=0.001 and lotSize=0.001 → sz=1.
    const lotSize = Number(opts.lotSize ?? orderData.lotSize ?? 0);
    let szContracts;
    if (lotSize > 0 && Number.isFinite(Number(orderData.size))) {
      szContracts = Math.round(Number(orderData.size) / lotSize);
    } else {
      // Fallback: caller already passed contract count (integer). Don't
      // silently mangle; just pass through. If Poloniex rejects with
      // "Param error sz" it's the caller's problem to pass lotSize.
      szContracts = Math.round(Number(orderData.size));
    }

    const body = {
      clOrdId: orderData.clientOid || orderData.clOrdId || this.generateClientOrderId(),
      symbol: orderData.symbol,
      side,                                                      // 'BUY' | 'SELL'
      mgnMode: (opts.mgnMode ?? orderData.mgnMode ?? 'CROSS').toUpperCase(),
      posSide: (opts.posSide ?? orderData.posSide ?? 'BOTH').toUpperCase(),
      type: typeUpper,                                           // 'MARKET' | 'LIMIT' | 'LIMIT_MAKER'
      sz: String(szContracts),                                   // STRING, in contracts
    };

    // Limit-only fields
    if (typeUpper === 'LIMIT' || typeUpper === 'LIMIT_MAKER') {
      if (orderData.price !== undefined) body.px = String(orderData.price);
      if (orderData.timeInForce) body.timeInForce = orderData.timeInForce;
    }
    if (orderData.reduceOnly) body.reduceOnly = true;

    // Remove undefined values defensively.
    Object.keys(body).forEach(key => {
      if (body[key] === undefined) {
        delete body[key];
      }
    });

    const result = await this.makeRequest(credentials, 'POST', '/trade/order', body);
    apiCache.invalidatePrefix('GET:/account/balance');
    apiCache.invalidatePrefix('GET:/trade/position');
    apiCache.invalidatePrefix('GET:/trade/order');
    return result;
  }

  /**
   * Place multiple orders
   * Endpoint: POST /v3/trade/orders
   */
  async placeMultipleOrders(credentials, orders) {
    const body = { orders };
    const result = await this.makeRequest(credentials, 'POST', '/trade/orders', body);
    apiCache.invalidatePrefix('GET:/account/balance');
    apiCache.invalidatePrefix('GET:/trade/position');
    apiCache.invalidatePrefix('GET:/trade/order');
    return result;
  }

  /**
   * Cancel an order
   * Endpoint: DELETE /v3/trade/order
   */
  async cancelOrder(credentials, orderId, clientOid = null) {
    const body = {};
    if (orderId) body.orderId = orderId;
    if (clientOid) body.clientOid = clientOid;
    
    const result = await this.makeRequest(credentials, 'DELETE', '/trade/order', body);
    apiCache.invalidatePrefix('GET:/account/balance');
    apiCache.invalidatePrefix('GET:/trade/position');
    apiCache.invalidatePrefix('GET:/trade/order');
    return result;
  }

  /**
   * Cancel multiple orders
   * Endpoint: DELETE /v3/trade/batchOrders
   */
  async cancelMultipleOrders(credentials, orderIds = [], clientOids = []) {
    const body = {};
    if (orderIds.length > 0) body.orderIds = orderIds;
    if (clientOids.length > 0) body.clientOids = clientOids;
    
    const result = await this.makeRequest(credentials, 'DELETE', '/trade/batchOrders', body);
    apiCache.invalidatePrefix('GET:/account/balance');
    apiCache.invalidatePrefix('GET:/trade/position');
    apiCache.invalidatePrefix('GET:/trade/order');
    return result;
  }

  /**
   * Cancel all orders
   * Endpoint: DELETE /v3/trade/allOrders
   */
  async cancelAllOrders(credentials, symbol = null) {
    const body = symbol ? { symbol } : {};
    const result = await this.makeRequest(credentials, 'DELETE', '/trade/allOrders', body);
    apiCache.invalidatePrefix('GET:/account/balance');
    apiCache.invalidatePrefix('GET:/trade/position');
    apiCache.invalidatePrefix('GET:/trade/order');
    return result;
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
   * Get trade history (alias for getExecutionDetails)
   * Endpoint: GET /v3/trade/order/trades
   */
  async getTradeHistory(credentials, params = {}) {
    return this.getExecutionDetails(credentials, params);
  }

  /**
   * Close position at market price
   * Endpoint: POST /v3/trade/position
   */
  async closePosition(credentials, symbol, type = 'close_long') {
    const body = { symbol, type }; // type: 'close_long' or 'close_short'
    const result = await this.makeRequest(credentials, 'POST', '/trade/position', body);
    apiCache.invalidatePrefix('GET:/account/balance');
    apiCache.invalidatePrefix('GET:/trade/position');
    return result;
  }

  /**
   * Close all positions at market price
   * Endpoint: POST /v3/trade/positionAll
   */
  async closeAllPositions(credentials) {
    const result = await this.makeRequest(credentials, 'POST', '/trade/positionAll', {});
    apiCache.invalidatePrefix('GET:/account/balance');
    apiCache.invalidatePrefix('GET:/trade/position');
    return result;
  }

  // =================== MARKET DATA (PUBLIC) ===================

  /**
   * Make public request to Poloniex Futures v3 API (no authentication)
   */
  async makePublicRequest(method, endpoint, params = {}) {
    // Check cache for GET requests before hitting the API
    if (method === 'GET') {
      const cacheKey = `GET:${endpoint}:${serializeParams(params)}`;
      const cached = apiCache.get(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }

    // Apply rate limiting
    return rateLimiter.execute(endpoint, async () => {
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
        
        // Poloniex V3 API returns: { code: 200, data: [...], msg: "Success" }
        // Extract the data field if present, otherwise return the full response
        let result;
        if (response.data && typeof response.data === 'object' && 'data' in response.data) {
          result = response.data.data;
        } else {
          result = response.data;
        }

        // Cache successful GET responses
        if (method === 'GET') {
          const ttl = getTtlForEndpoint(endpoint);
          if (ttl > 0) {
            const cacheKey = `GET:${endpoint}:${serializeParams(params)}`;
            apiCache.set(cacheKey, result, ttl);
          }
        }

        return result;
      } catch (error) {
        logger.error('Poloniex v3 public API request error:', {
          endpoint: endpoint,
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        });
        throw error;
      }
    });
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
        const normalizedSymbol = symbol ? this.normalizeSymbol(symbol) : null;
        const params = normalizedSymbol ? { symbol: normalizedSymbol } : {};
    return this.makePublicRequest('GET', '/market/tickers', params);
  }

  /**
   * Get order book
   * Endpoint: GET /v3/market/orderBook
   */
  async getOrderBook(symbol, depth = 20) {
        const normalizedSymbol = this.normalizeSymbol(symbol);
        const params = { symbol: normalizedSymbol, depth };
    return this.makePublicRequest('GET', '/market/orderBook', params);
  }

  /**
   * Get market trades (execution info)
   * Endpoint: GET /v3/market/trades
   */
  async getMarketTrades(symbol) {
        const params = { symbol: this.normalizeSymbol(symbol) };
    return this.makePublicRequest('GET', '/market/trades', params);
  }

  /**
   * Get K-line data (candlesticks)
   * Endpoint: GET /v3/market/candles
   */
  async getKlines(symbol, interval, params = {}) {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const queryParams = { symbol: normalizedSymbol, interval, ...params };
    return this.makePublicRequest('GET', '/market/candles', queryParams);
  }

  /**
   * Get historical OHLCV data for ML training and analysis
   * @param {string} symbol - Trading symbol (e.g., 'BTCUSDTPERP')
   * @param {string} interval - Candle interval ('1m', '5m', '15m', '30m', '1h', '4h', '1d')
   * @param {number} limit - Fallback candle count (per-call cap 500). Only used
   *   to size the default "last N candles" window when opts.startTime is not
   *   supplied. When opts.startTime is supplied, the window size is determined
   *   by the time range and this value becomes a per-call hint.
   * @param {Object} [opts] - Optional fetch options
   * @param {Date|number} [opts.startTime] - Window start. When supplied with endTime, overrides the default "last N candles" behavior.
   * @param {Date|number} [opts.endTime] - Window end. Defaults to now.
   * @returns {Promise<Array>} Array of OHLCV data [{timestamp, open, high, low, close, volume}]
   */
  async getHistoricalData(symbol, interval = '1h', limit = 200, opts = {}) {
    try {
      // Map interval to Poloniex V3 format and seconds for time calculation
      const intervalMap = {
        '1m': { format: 'MINUTE_1', seconds: 60 },
        '5m': { format: 'MINUTE_5', seconds: 300 },
        '15m': { format: 'MINUTE_15', seconds: 900 },
        '30m': { format: 'MINUTE_30', seconds: 1800 },
        '1h': { format: 'HOUR_1', seconds: 3600 },
        '1H': { format: 'HOUR_1', seconds: 3600 },
        '2h': { format: 'HOUR_2', seconds: 7200 },
        '4h': { format: 'HOUR_4', seconds: 14400 },
        '4H': { format: 'HOUR_4', seconds: 14400 },
        '12h': { format: 'HOUR_12', seconds: 43200 },
        '1d': { format: 'DAY_1', seconds: 86400 },
        '1D': { format: 'DAY_1', seconds: 86400 }
      };

      const intervalConfig = intervalMap[interval];
      if (!intervalConfig) {
        throw new Error(`Invalid interval: ${interval}. Use 1m, 5m, 15m, 30m, 1h, 2h, 4h, 12h, or 1d`);
      }

      const POLONIEX_MAX_PER_CALL = 500;
      const MAX_LOOP_CALLS = 50;  // safety ceiling — see MAX_TOTAL_CANDLES below
      const intervalMs = intervalConfig.seconds * 1000;

      // Resolve time range. If caller supplied explicit startTime (e.g. the
      // backtest walk-forward windows), honor it exactly. Otherwise fall
      // back to "last N candles" for backward compat with the old callers.
      const rawEnd = opts.endTime != null
        ? (opts.endTime instanceof Date ? opts.endTime.getTime() : Number(opts.endTime))
        : Date.now();
      const rawStart = opts.startTime != null
        ? (opts.startTime instanceof Date ? opts.startTime.getTime() : Number(opts.startTime))
        : null;
      // Validate — NaN or inverted ranges would silently produce huge
      // loops or empty results. Fail loudly.
      if (!Number.isFinite(rawEnd)) {
        throw new Error(`getHistoricalData: invalid opts.endTime (${String(opts.endTime)})`);
      }
      if (rawStart != null && !Number.isFinite(rawStart)) {
        throw new Error(`getHistoricalData: invalid opts.startTime (${String(opts.startTime)})`);
      }
      if (rawStart != null && rawStart >= rawEnd) {
        throw new Error(
          `getHistoricalData: startTime (${rawStart}) must be < endTime (${rawEnd})`,
        );
      }
      const cap = Math.min(limit, POLONIEX_MAX_PER_CALL);
      const endTime = rawEnd;
      const startTime = rawStart ?? (endTime - intervalMs * cap);

      // Compute candles needed in the window. Poloniex V3 returns up to 500
      // per call, so when the window needs more we loop forward 500 at a
      // time. This is the fix for the "fetcher ignored sTime and always
      // returned last-N" bug that was producing 29-candle IS windows.
      const totalNeeded = Math.ceil((endTime - startTime) / intervalMs);
      const callsNeeded = Math.ceil(totalNeeded / POLONIEX_MAX_PER_CALL);
      const numCalls = Math.min(callsNeeded, MAX_LOOP_CALLS);
      if (callsNeeded > MAX_LOOP_CALLS) {
        logger.warn(
          `getHistoricalData: window truncated — wanted ${callsNeeded} chunks for ${symbol} ${interval}, capped at ${MAX_LOOP_CALLS} (~${MAX_LOOP_CALLS * POLONIEX_MAX_PER_CALL} candles). Use a coarser timeframe or narrower window for full coverage.`,
          { symbol, interval, callsNeeded, totalNeeded },
        );
      }
      let cursor = startTime;
      const all = [];
      for (let i = 0; i < numCalls; i++) {
        const chunkEnd = Math.min(cursor + POLONIEX_MAX_PER_CALL * intervalMs, endTime);
        const params = {
          limit: POLONIEX_MAX_PER_CALL,
          sTime: Math.floor(cursor),
          eTime: Math.floor(chunkEnd),
        };
        const chunk = await this.getKlines(symbol, intervalConfig.format, params);
        if (!chunk || !Array.isArray(chunk) || chunk.length === 0) break;
        all.push(...chunk);
        // Advance cursor just past the last received candle. If chunk
        // length < 500 we assume no more data in that stride.
        cursor = chunkEnd;
        if (chunk.length < POLONIEX_MAX_PER_CALL) break;
      }
      const candles = all;

      // Transform to standard OHLCV format
      if (!candles || !Array.isArray(candles)) {
        logger.warn(`No historical data returned for ${symbol}`, { candles });
        return [];
      }

      // Poloniex V3 candles format: [low, high, open, close, amt, qty, tC, sT, cT]
      // Indices: [0=low, 1=high, 2=open, 3=close, 4=amt, 5=qty, 6=tC, 7=sT, 8=cT]
      return candles.map(candle => ({
        timestamp: parseInt(candle[7]), // sT (start time) in milliseconds
        open: parseFloat(candle[2]),    // open
        high: parseFloat(candle[1]),    // high
        low: parseFloat(candle[0]),     // low
        close: parseFloat(candle[3]),   // close
        volume: parseFloat(candle[5])   // qty (base currency volume)
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

  /**
   * Get index price components
   * Endpoint: GET /v3/market/indexPriceComponents
   * 
   * @param {string} symbol - Trading symbol
   * @returns {Promise<Object>} Index price components with exchange weights
   */
  async getIndexPriceComponents(symbol) {
    const params = { symbol };
    return this.makePublicRequest('GET', '/market/indexPriceComponents', params);
  }

  /**
   * Get index price K-line data
   * Endpoint: GET /v3/market/indexPriceCandlesticks
   * 
   * @param {string} symbol - Trading symbol
   * @param {string} granularity - Time granularity (e.g., 'MINUTE_1', 'HOUR_1', 'DAY_1')
   * @param {Object} [params] - Additional parameters (from, to, limit)
   * @returns {Promise<Array>} Index price candlestick data
   */
  async getIndexPriceKlines(symbol, granularity, params = {}) {
    const queryParams = { symbol, granularity, ...params };
    return this.makePublicRequest('GET', '/market/indexPriceCandlesticks', queryParams);
  }

  /**
   * Get premium index K-line data
   * Endpoint: GET /v3/market/premiumIndexCandlesticks
   * 
   * @param {string} symbol - Trading symbol
   * @param {string} granularity - Time granularity
   * @param {Object} [params] - Additional parameters (from, to, limit)
   * @returns {Promise<Array>} Premium index candlestick data
   */
  async getPremiumIndexKlines(symbol, granularity, params = {}) {
    const queryParams = { symbol, granularity, ...params };
    return this.makePublicRequest('GET', '/market/premiumIndexCandlesticks', queryParams);
  }

  /**
   * Get market info
   * Endpoint: GET /v3/market/info
   * 
   * @param {string} [symbol] - Trading symbol (optional, returns all if not provided)
   * @returns {Promise<Object>} Market information including status, tick size, lot size, etc.
   */
  async getMarketInfo(symbol = null) {
    const params = symbol ? { symbol } : {};
    return this.makePublicRequest('GET', '/market/info', params);
  }

  /**
   * Get market limit price
   * Endpoint: GET /v3/market/limitPrice
   * 
   * @param {string} symbol - Trading symbol
   * @returns {Promise<Object>} Current limit price range for the symbol
   */
  async getMarketLimitPrice(symbol) {
    const params = { symbol };
    return this.makePublicRequest('GET', '/market/limitPrice', params);
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
