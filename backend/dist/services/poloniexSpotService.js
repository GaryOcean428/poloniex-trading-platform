import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { parsePoloniexError, retryWithBackoff } from '../utils/poloniexErrors.js';
import rateLimiter from '../utils/rateLimiter.js';
/**
 * Poloniex Spot API Service
 * Handles Spot trading operations
 */
class PoloniexSpotService {
    constructor() {
        this.baseURL = 'https://api.poloniex.com';
        this.timeout = 30000;
    }
    /**
     * Generate HMAC-SHA256 signature for Poloniex Spot API authentication
     * Per specification: https://api-docs.poloniex.com/spot/api/#api-signature-generation
     *
     * Format for GET requests with params:
     *   METHOD\n
     *   /path\n
     *   param1=value1&param2=value2&signTimestamp=123456
     *
     * Format for POST/DELETE with body:
     *   METHOD\n
     *   /path\n
     *   requestBody={"key":"value"}&signTimestamp=123456
     *
     * Format for DELETE with no body:
     *   METHOD\n
     *   /path\n
     *   signTimestamp=123456
     */
    generateSignature(method, requestPath, params, body, timestamp, secret) {
        try {
            const methodUpper = method.toUpperCase();
            // Build parameter string
            let paramString = '';
            if (body && (methodUpper === 'POST' || methodUpper === 'PUT' || methodUpper === 'DELETE')) {
                // For POST/PUT/DELETE with body
                const bodyJson = JSON.stringify(body);
                paramString = `requestBody=${bodyJson}&signTimestamp=${timestamp}`;
            }
            else if (params && Object.keys(params).length > 0) {
                // For GET with query params - sort by ASCII order
                const allParams = { ...params, signTimestamp: timestamp };
                const sortedKeys = Object.keys(allParams).sort();
                paramString = sortedKeys
                    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(allParams[key])}`)
                    .join('&');
            }
            else {
                // For requests with no params/body, just timestamp
                paramString = `signTimestamp=${timestamp}`;
            }
            // Build the message string with actual newlines
            const message = `${methodUpper}\n${requestPath}\n${paramString}`;
            return crypto
                .createHmac('sha256', secret)
                .update(message)
                .digest('base64');
        }
        catch (error) {
            logger.error('Error generating Poloniex Spot signature:', error);
            throw new Error('Failed to generate API signature');
        }
    }
    /**
     * Set VIP level for rate limiting
     * @param {number} level - VIP level (0-9)
     */
    setVIPLevel(level) {
        rateLimiter.setVIPLevel(level);
    }
    /**
     * Get rate limiter status
     * @returns {Object} - Rate limit status
     */
    getRateLimitStatus() {
        return rateLimiter.getStatus();
    }
    /**
     * Make authenticated request to Poloniex Spot API
     */
    async makeRequest(credentials, method, endpoint, body = null, params = {}) {
        // Apply rate limiting
        return rateLimiter.execute(endpoint, async () => {
            try {
                const timestamp = Date.now().toString();
                const requestPath = endpoint;
                // Generate signature (signature includes params but not in URL path)
                const signature = this.generateSignature(method, requestPath, params, body, timestamp, credentials.apiSecret);
                // Build query string for actual request URL
                const queryString = Object.keys(params).length > 0
                    ? '?' + new URLSearchParams(params).toString()
                    : '';
                const fullUrl = `${this.baseURL}${requestPath}${queryString}`;
                const config = {
                    method: method.toLowerCase(),
                    url: fullUrl,
                    headers: {
                        'Content-Type': 'application/json',
                        'key': credentials.apiKey,
                        'signTimestamp': timestamp,
                        'signature': signature,
                        'signatureMethod': 'hmacSHA256',
                        'signatureVersion': '2'
                    },
                    timeout: this.timeout
                };
                if (body) {
                    config.data = body;
                }
                logger.info(`Making Poloniex Spot ${method} request to ${requestPath}`);
                const response = await axios(config);
                return response.data;
            }
            catch (error) {
                // Parse and enhance error
                const parsedError = parsePoloniexError(error);
                logger.error('Poloniex Spot API request error:', {
                    endpoint: endpoint,
                    method: method,
                    status: parsedError.statusCode,
                    code: parsedError.code,
                    message: parsedError.message,
                    userMessage: parsedError.details.userMessage,
                    isRetryable: parsedError.isRetryable
                });
                throw parsedError;
            }
        });
    }
    /**
     * Make request with automatic retry for retryable errors
     */
    async makeRequestWithRetry(credentials, method, endpoint, body = null, params = {}, maxRetries = 3) {
        return retryWithBackoff(() => this.makeRequest(credentials, method, endpoint, body, params), maxRetries);
    }
    /**
     * Get Spot account balances
     * Endpoint: GET /accounts/balances
     */
    async getAccountBalances(credentials) {
        try {
            const balances = await this.makeRequest(credentials, 'GET', '/accounts/balances');
            return balances;
        }
        catch (error) {
            logger.error('Error fetching spot balances:', error);
            throw error;
        }
    }
    /**
     * Get account information
     * Endpoint: GET /accounts
     */
    async getAccounts(credentials) {
        try {
            const accounts = await this.makeRequest(credentials, 'GET', '/accounts');
            return accounts;
        }
        catch (error) {
            logger.error('Error fetching accounts:', error);
            throw error;
        }
    }
    /**
     * Transfer between accounts
     * Endpoint: POST /accounts/transfer
     */
    async transferBetweenAccounts(credentials, params) {
        try {
            const { currency, amount, fromAccount, toAccount } = params;
            const body = {
                currency,
                amount: amount.toString(),
                fromAccount,
                toAccount
            };
            const result = await this.makeRequest(credentials, 'POST', '/accounts/transfer', body);
            return result;
        }
        catch (error) {
            logger.error('Error transferring between accounts:', error);
            throw error;
        }
    }
    /**
     * Get transfer history
     * Endpoint: GET /accounts/transfer
     */
    async getTransferHistory(credentials, params = {}) {
        try {
            const history = await this.makeRequest(credentials, 'GET', '/accounts/transfer', null, params);
            return history;
        }
        catch (error) {
            logger.error('Error fetching transfer history:', error);
            throw error;
        }
    }
    // =================== TRADING OPERATIONS ===================
    /**
     * Place a new order
     * Endpoint: POST /orders
     *
     * @param {Object} credentials - API credentials
     * @param {Object} params - Order parameters
     * @param {string} params.symbol - Trading pair (e.g., BTC_USDT)
     * @param {string} params.side - BUY or SELL
     * @param {string} params.type - MARKET, LIMIT, LIMIT_MAKER
     * @param {string} params.quantity - Order quantity
     * @param {string} [params.price] - Order price (required for LIMIT orders)
     * @param {string} [params.timeInForce] - GTC, IOC, FOK
     * @param {string} [params.clientOrderId] - Client order ID
     */
    async placeOrder(credentials, params) {
        try {
            const { symbol, side, type, quantity, price, timeInForce, clientOrderId } = params;
            // Validate required parameters
            if (!symbol || !side || !type || !quantity) {
                throw new Error('Missing required order parameters: symbol, side, type, quantity');
            }
            // Validate LIMIT orders have price
            if ((type === 'LIMIT' || type === 'LIMIT_MAKER') && !price) {
                throw new Error('Price is required for LIMIT orders');
            }
            const body = {
                symbol,
                side: side.toUpperCase(),
                type: type.toUpperCase(),
                quantity: quantity.toString()
            };
            if (price)
                body.price = price.toString();
            if (timeInForce)
                body.timeInForce = timeInForce.toUpperCase();
            if (clientOrderId)
                body.clientOrderId = clientOrderId;
            logger.info('Placing Spot order:', { symbol, side, type, quantity, price });
            const result = await this.makeRequest(credentials, 'POST', '/orders', body);
            logger.info('Spot order placed successfully:', { orderId: result.id });
            return result;
        }
        catch (error) {
            logger.error('Error placing spot order:', error);
            throw error;
        }
    }
    /**
     * Get open orders
     * Endpoint: GET /orders
     *
     * @param {Object} credentials - API credentials
     * @param {Object} [params] - Query parameters
     * @param {string} [params.symbol] - Filter by trading pair
     * @param {string} [params.side] - Filter by side (BUY/SELL)
     * @param {number} [params.limit] - Number of results (default: 100, max: 500)
     */
    async getOpenOrders(credentials, params = {}) {
        try {
            const orders = await this.makeRequest(credentials, 'GET', '/orders', null, params);
            return orders;
        }
        catch (error) {
            logger.error('Error fetching open orders:', error);
            throw error;
        }
    }
    /**
     * Get order details by ID
     * Endpoint: GET /orders/{id}
     *
     * @param {Object} credentials - API credentials
     * @param {string} orderId - Order ID
     */
    async getOrderById(credentials, orderId) {
        try {
            if (!orderId) {
                throw new Error('Order ID is required');
            }
            const order = await this.makeRequest(credentials, 'GET', `/orders/${orderId}`);
            return order;
        }
        catch (error) {
            logger.error('Error fetching order details:', error);
            throw error;
        }
    }
    /**
     * Cancel an order by ID
     * Endpoint: DELETE /orders/{id}
     *
     * @param {Object} credentials - API credentials
     * @param {string} orderId - Order ID to cancel
     */
    async cancelOrder(credentials, orderId) {
        try {
            if (!orderId) {
                throw new Error('Order ID is required');
            }
            logger.info('Cancelling Spot order:', { orderId });
            const result = await this.makeRequest(credentials, 'DELETE', `/orders/${orderId}`);
            logger.info('Spot order cancelled successfully:', { orderId });
            return result;
        }
        catch (error) {
            logger.error('Error cancelling spot order:', error);
            throw error;
        }
    }
    /**
     * Cancel multiple orders by IDs
     * Endpoint: DELETE /orders/cancelByIds
     *
     * @param {Object} credentials - API credentials
     * @param {Array<string>} orderIds - Array of order IDs to cancel
     * @param {Array<string>} [clientOrderIds] - Array of client order IDs to cancel
     */
    async cancelOrdersByIds(credentials, orderIds = [], clientOrderIds = []) {
        try {
            if (orderIds.length === 0 && clientOrderIds.length === 0) {
                throw new Error('At least one order ID or client order ID is required');
            }
            const body = {};
            if (orderIds.length > 0)
                body.orderIds = orderIds;
            if (clientOrderIds.length > 0)
                body.clientOrderIds = clientOrderIds;
            logger.info('Cancelling multiple Spot orders:', { count: orderIds.length + clientOrderIds.length });
            const result = await this.makeRequest(credentials, 'DELETE', '/orders/cancelByIds', body);
            logger.info('Spot orders cancelled successfully');
            return result;
        }
        catch (error) {
            logger.error('Error cancelling multiple spot orders:', error);
            throw error;
        }
    }
    /**
     * Cancel all orders
     * Endpoint: DELETE /orders
     *
     * @param {Object} credentials - API credentials
     * @param {Object} [params] - Query parameters
     * @param {string} [params.symbol] - Cancel orders for specific symbol
     * @param {Array<string>} [params.symbols] - Cancel orders for multiple symbols
     * @param {Array<string>} [params.accountTypes] - Account types (SPOT)
     */
    async cancelAllOrders(credentials, params = {}) {
        try {
            logger.info('Cancelling all Spot orders:', params);
            const result = await this.makeRequest(credentials, 'DELETE', '/orders', null, params);
            logger.info('All Spot orders cancelled successfully');
            return result;
        }
        catch (error) {
            logger.error('Error cancelling all spot orders:', error);
            throw error;
        }
    }
    /**
     * Get order history
     * Endpoint: GET /orders/history
     *
     * @param {Object} credentials - API credentials
     * @param {Object} [params] - Query parameters
     * @param {string} [params.symbol] - Filter by trading pair
     * @param {string} [params.side] - Filter by side (BUY/SELL)
     * @param {string} [params.type] - Filter by order type
     * @param {string} [params.state] - Filter by state (FILLED, CANCELED, etc.)
     * @param {number} [params.from] - Start timestamp
     * @param {number} [params.to] - End timestamp
     * @param {string} [params.direction] - PRE (older) or NEXT (newer)
     * @param {number} [params.limit] - Number of results (default: 100, max: 1000)
     */
    async getOrderHistory(credentials, params = {}) {
        try {
            const history = await this.makeRequest(credentials, 'GET', '/orders/history', null, params);
            return history;
        }
        catch (error) {
            logger.error('Error fetching order history:', error);
            throw error;
        }
    }
    /**
     * Get trade history
     * Endpoint: GET /trades
     *
     * @param {Object} credentials - API credentials
     * @param {Object} [params] - Query parameters
     * @param {string} [params.symbol] - Filter by trading pair
     * @param {number} [params.from] - Start timestamp
     * @param {number} [params.to] - End timestamp
     * @param {string} [params.direction] - PRE (older) or NEXT (newer)
     * @param {number} [params.limit] - Number of results (default: 100, max: 1000)
     */
    async getTradeHistory(credentials, params = {}) {
        try {
            const trades = await this.makeRequest(credentials, 'GET', '/trades', null, params);
            return trades;
        }
        catch (error) {
            logger.error('Error fetching trade history:', error);
            throw error;
        }
    }
    /**
     * Get trades for a specific order
     * Endpoint: GET /orders/{id}/trades
     *
     * @param {Object} credentials - API credentials
     * @param {string} orderId - Order ID
     */
    async getOrderTrades(credentials, orderId) {
        try {
            if (!orderId) {
                throw new Error('Order ID is required');
            }
            const trades = await this.makeRequest(credentials, 'GET', `/orders/${orderId}/trades`);
            return trades;
        }
        catch (error) {
            logger.error('Error fetching order trades:', error);
            throw error;
        }
    }
    // =================== MARKET DATA ===================
    /**
     * Get 24h ticker for a symbol
     * Endpoint: GET /markets/{symbol}/ticker24h
     *
     * @param {string} symbol - Trading pair (e.g., BTC_USDT)
     */
    async getTicker24h(symbol) {
        try {
            if (!symbol) {
                throw new Error('Symbol is required');
            }
            // Market data endpoints don't require authentication
            const url = `${this.baseURL}/markets/${symbol}/ticker24h`;
            const response = await axios.get(url, { timeout: this.timeout });
            return response.data;
        }
        catch (error) {
            const parsedError = parsePoloniexError(error);
            logger.error('Error fetching 24h ticker:', parsedError);
            throw parsedError;
        }
    }
    /**
     * Get tickers for all symbols
     * Endpoint: GET /markets/ticker24h
     */
    async getAllTickers() {
        try {
            const url = `${this.baseURL}/markets/ticker24h`;
            const response = await axios.get(url, { timeout: this.timeout });
            return response.data;
        }
        catch (error) {
            const parsedError = parsePoloniexError(error);
            logger.error('Error fetching all tickers:', parsedError);
            throw parsedError;
        }
    }
    /**
     * Get current price for a symbol
     * Endpoint: GET /markets/{symbol}/price
     *
     * @param {string} symbol - Trading pair (e.g., BTC_USDT)
     */
    async getPrice(symbol) {
        try {
            if (!symbol) {
                throw new Error('Symbol is required');
            }
            const url = `${this.baseURL}/markets/${symbol}/price`;
            const response = await axios.get(url, { timeout: this.timeout });
            return response.data;
        }
        catch (error) {
            const parsedError = parsePoloniexError(error);
            logger.error('Error fetching price:', parsedError);
            throw parsedError;
        }
    }
    /**
     * Get prices for all symbols
     * Endpoint: GET /markets/price
     */
    async getAllPrices() {
        try {
            const url = `${this.baseURL}/markets/price`;
            const response = await axios.get(url, { timeout: this.timeout });
            return response.data;
        }
        catch (error) {
            const parsedError = parsePoloniexError(error);
            logger.error('Error fetching all prices:', parsedError);
            throw parsedError;
        }
    }
    /**
     * Get order book for a symbol
     * Endpoint: GET /markets/{symbol}/orderBook
     *
     * @param {string} symbol - Trading pair (e.g., BTC_USDT)
     * @param {Object} [params] - Query parameters
     * @param {string} [params.scale] - Price aggregation scale
     * @param {number} [params.limit] - Number of levels (5, 10, 20, 50, 100, 150)
     */
    async getOrderBook(symbol, params = {}) {
        try {
            if (!symbol) {
                throw new Error('Symbol is required');
            }
            const queryString = Object.keys(params).length > 0
                ? '?' + new URLSearchParams(params).toString()
                : '';
            const url = `${this.baseURL}/markets/${symbol}/orderBook${queryString}`;
            const response = await axios.get(url, { timeout: this.timeout });
            return response.data;
        }
        catch (error) {
            const parsedError = parsePoloniexError(error);
            logger.error('Error fetching order book:', parsedError);
            throw parsedError;
        }
    }
    /**
     * Get recent trades for a symbol
     * Endpoint: GET /markets/{symbol}/trades
     *
     * @param {string} symbol - Trading pair (e.g., BTC_USDT)
     * @param {Object} [params] - Query parameters
     * @param {number} [params.limit] - Number of trades (default: 500, max: 1000)
     */
    async getRecentTrades(symbol, params = {}) {
        try {
            if (!symbol) {
                throw new Error('Symbol is required');
            }
            const queryString = Object.keys(params).length > 0
                ? '?' + new URLSearchParams(params).toString()
                : '';
            const url = `${this.baseURL}/markets/${symbol}/trades${queryString}`;
            const response = await axios.get(url, { timeout: this.timeout });
            return response.data;
        }
        catch (error) {
            const parsedError = parsePoloniexError(error);
            logger.error('Error fetching recent trades:', parsedError);
            throw parsedError;
        }
    }
    /**
     * Get candlestick data for a symbol
     * Endpoint: GET /markets/{symbol}/candles
     *
     * @param {string} symbol - Trading pair (e.g., BTC_USDT)
     * @param {Object} [params] - Query parameters
     * @param {string} params.interval - Candle interval (MINUTE_1, MINUTE_5, MINUTE_15, MINUTE_30, HOUR_1, HOUR_2, HOUR_4, HOUR_6, HOUR_12, DAY_1, DAY_3, WEEK_1, MONTH_1)
     * @param {number} [params.startTime] - Start timestamp
     * @param {number} [params.endTime] - End timestamp
     * @param {number} [params.limit] - Number of candles (default: 100, max: 500)
     */
    async getCandles(symbol, params = {}) {
        try {
            if (!symbol) {
                throw new Error('Symbol is required');
            }
            if (!params.interval) {
                throw new Error('Interval is required');
            }
            const queryString = new URLSearchParams(params).toString();
            const url = `${this.baseURL}/markets/${symbol}/candles?${queryString}`;
            const response = await axios.get(url, { timeout: this.timeout });
            return response.data;
        }
        catch (error) {
            const parsedError = parsePoloniexError(error);
            logger.error('Error fetching candles:', parsedError);
            throw parsedError;
        }
    }
    /**
     * Get symbol information
     * Endpoint: GET /markets/{symbol}
     *
     * @param {string} symbol - Trading pair (e.g., BTC_USDT)
     */
    async getSymbolInfo(symbol) {
        try {
            if (!symbol) {
                throw new Error('Symbol is required');
            }
            const url = `${this.baseURL}/markets/${symbol}`;
            const response = await axios.get(url, { timeout: this.timeout });
            return response.data;
        }
        catch (error) {
            const parsedError = parsePoloniexError(error);
            logger.error('Error fetching symbol info:', parsedError);
            throw parsedError;
        }
    }
    /**
     * Get all symbols information
     * Endpoint: GET /markets
     */
    async getAllSymbols() {
        try {
            const url = `${this.baseURL}/markets`;
            const response = await axios.get(url, { timeout: this.timeout });
            return response.data;
        }
        catch (error) {
            const parsedError = parsePoloniexError(error);
            logger.error('Error fetching all symbols:', parsedError);
            throw parsedError;
        }
    }
    /**
     * Get currency information
     * Endpoint: GET /currencies/{currency}
     *
     * @param {string} currency - Currency code (e.g., BTC, USDT)
     */
    async getCurrencyInfo(currency) {
        try {
            if (!currency) {
                throw new Error('Currency is required');
            }
            const url = `${this.baseURL}/currencies/${currency}`;
            const response = await axios.get(url, { timeout: this.timeout });
            return response.data;
        }
        catch (error) {
            const parsedError = parsePoloniexError(error);
            logger.error('Error fetching currency info:', parsedError);
            throw parsedError;
        }
    }
    /**
     * Get all currencies information
     * Endpoint: GET /currencies
     */
    async getAllCurrencies() {
        try {
            const url = `${this.baseURL}/currencies`;
            const response = await axios.get(url, { timeout: this.timeout });
            return response.data;
        }
        catch (error) {
            const parsedError = parsePoloniexError(error);
            logger.error('Error fetching all currencies:', parsedError);
            throw parsedError;
        }
    }
    /**
     * Get system timestamp
     * Endpoint: GET /timestamp
     */
    async getTimestamp() {
        try {
            const url = `${this.baseURL}/timestamp`;
            const response = await axios.get(url, { timeout: this.timeout });
            return response.data;
        }
        catch (error) {
            const parsedError = parsePoloniexError(error);
            logger.error('Error fetching timestamp:', parsedError);
            throw parsedError;
        }
    }
    // =================== KILL SWITCH ===================
    /**
     * Set kill switch timer
     * Endpoint: POST /orders/killSwitch
     *
     * @param {Object} credentials - API credentials
     * @param {number} timeout - Timeout in seconds (5-600)
     */
    async setKillSwitch(credentials, timeout) {
        try {
            if (!timeout || timeout < 5 || timeout > 600) {
                throw new Error('Timeout must be between 5 and 600 seconds');
            }
            const body = { timeout };
            logger.info('Setting kill switch:', { timeout });
            const result = await this.makeRequest(credentials, 'POST', '/orders/killSwitch', body);
            logger.info('Kill switch set successfully');
            return result;
        }
        catch (error) {
            logger.error('Error setting kill switch:', error);
            throw error;
        }
    }
    /**
     * Get kill switch status
     * Endpoint: GET /orders/killSwitchStatus
     *
     * @param {Object} credentials - API credentials
     */
    async getKillSwitchStatus(credentials) {
        try {
            const status = await this.makeRequest(credentials, 'GET', '/orders/killSwitchStatus');
            return status;
        }
        catch (error) {
            logger.error('Error fetching kill switch status:', error);
            throw error;
        }
    }
}
// Export singleton instance
const poloniexSpotService = new PoloniexSpotService();
export default poloniexSpotService;
