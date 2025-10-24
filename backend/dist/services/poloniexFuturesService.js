import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { query } from '../db/connection.js';
class PoloniexFuturesService {
    constructor() {
        this.baseURL = 'https://api.poloniex.com';
        this.timeout = 30000;
    }
    generateSignature(method, requestPath, body, timestamp, apiSecret) {
        try {
            const bodyStr = body ? JSON.stringify(body) : '';
            const message = `${method.toUpperCase()}\n${requestPath}\n${bodyStr}${timestamp}`;
            return crypto
                .createHmac('sha256', apiSecret)
                .update(message)
                .digest('base64');
        }
        catch (error) {
            logger.error('Error generating Poloniex v3 signature:', error);
            throw new Error('Failed to generate API signature');
        }
    }
    async makeRequest(credentials, method, endpoint, body = null, params = {}) {
        try {
            const timestamp = Date.now().toString();
            const requestPath = `/v3${endpoint}`;
            const url = `${this.baseURL}${requestPath}`;
            const queryString = Object.keys(params).length > 0
                ? '?' + new globalThis.URLSearchParams(params).toString()
                : '';
            const fullRequestPath = requestPath + queryString;
            const fullUrl = url + queryString;
            const signature = this.generateSignature(method, fullRequestPath, body, timestamp, credentials.apiSecret);
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
        }
        catch (error) {
            logger.error('Poloniex v3 futures API request error:', {
                endpoint: endpoint,
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });
            throw error;
        }
    }
    async getAccountBalance(credentials) {
        return this.makeRequest(credentials, 'GET', '/account/balance');
    }
    async getAccountBills(credentials, params = {}) {
        return this.makeRequest(credentials, 'GET', '/account/bills', null, params);
    }
    async getPositions(credentials, symbol = null) {
        const params = symbol ? { symbol } : {};
        return this.makeRequest(credentials, 'GET', '/trade/position/opens', null, params);
    }
    async getPositionHistory(credentials, params = {}) {
        return this.makeRequest(credentials, 'GET', '/trade/position/history', null, params);
    }
    async getLeverages(credentials, symbol = null) {
        const params = symbol ? { symbol } : {};
        return this.makeRequest(credentials, 'GET', '/position/leverages', null, params);
    }
    async setLeverage(credentials, symbol, leverage) {
        const body = { symbol, leverage };
        return this.makeRequest(credentials, 'POST', '/position/leverage', body);
    }
    async getPositionMode(credentials, symbol) {
        const params = { symbol };
        return this.makeRequest(credentials, 'GET', '/position/mode', null, params);
    }
    async switchPositionMode(credentials, symbol, mode) {
        const body = { symbol, mode };
        return this.makeRequest(credentials, 'POST', '/position/mode', body);
    }
    async adjustMargin(credentials, symbol, amount, type) {
        const body = {
            symbol,
            amount,
            type
        };
        return this.makeRequest(credentials, 'POST', '/trade/position/margin', body);
    }
    async placeOrder(credentials, orderData) {
        const body = {
            clientOid: orderData.clientOid || this.generateClientOrderId(),
            symbol: orderData.symbol,
            side: orderData.side,
            type: orderData.type,
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
        Object.keys(body).forEach(key => {
            if (body[key] === undefined) {
                delete body[key];
            }
        });
        return this.makeRequest(credentials, 'POST', '/trade/order', body);
    }
    async placeMultipleOrders(credentials, orders) {
        const body = { orders };
        return this.makeRequest(credentials, 'POST', '/trade/orders', body);
    }
    async cancelOrder(credentials, orderId, clientOid = null) {
        const body = {};
        if (orderId)
            body.orderId = orderId;
        if (clientOid)
            body.clientOid = clientOid;
        return this.makeRequest(credentials, 'DELETE', '/trade/order', body);
    }
    async cancelMultipleOrders(credentials, orderIds = [], clientOids = []) {
        const body = {};
        if (orderIds.length > 0)
            body.orderIds = orderIds;
        if (clientOids.length > 0)
            body.clientOids = clientOids;
        return this.makeRequest(credentials, 'DELETE', '/trade/batchOrders', body);
    }
    async cancelAllOrders(credentials, symbol = null) {
        const body = symbol ? { symbol } : {};
        return this.makeRequest(credentials, 'DELETE', '/trade/allOrders', body);
    }
    async getCurrentOrders(credentials, symbol = null) {
        const params = symbol ? { symbol } : {};
        return this.makeRequest(credentials, 'GET', '/trade/order/opens', null, params);
    }
    async getOrderHistory(credentials, params = {}) {
        return this.makeRequest(credentials, 'GET', '/trade/order/history', null, params);
    }
    async getExecutionDetails(credentials, params = {}) {
        return this.makeRequest(credentials, 'GET', '/trade/order/trades', null, params);
    }
    async closePosition(credentials, symbol, type = 'close_long') {
        const body = { symbol, type };
        return this.makeRequest(credentials, 'POST', '/trade/position', body);
    }
    async closeAllPositions(credentials) {
        return this.makeRequest(credentials, 'POST', '/trade/positionAll', {});
    }
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
        }
        catch (error) {
            logger.error('Poloniex v3 public API request error:', {
                endpoint: endpoint,
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });
            throw error;
        }
    }
    async getProducts() {
        return this.makePublicRequest('GET', '/market/allInstruments');
    }
    async getProduct(symbol) {
        const params = { symbol };
        return this.makePublicRequest('GET', '/market/instruments', params);
    }
    async getTickers(symbol = null) {
        const params = symbol ? { symbol } : {};
        return this.makePublicRequest('GET', '/market/tickers', params);
    }
    async getOrderBook(symbol, depth = 20) {
        const params = { symbol, depth };
        return this.makePublicRequest('GET', '/market/orderBook', params);
    }
    async getMarketTrades(symbol) {
        const params = { symbol };
        return this.makePublicRequest('GET', '/market/trades', params);
    }
    async getKlines(symbol, granularity, params = {}) {
        const queryParams = { symbol, granularity, ...params };
        return this.makePublicRequest('GET', '/market/candles', queryParams);
    }
    async getMarkPriceKlines(symbol, granularity, params = {}) {
        const queryParams = { symbol, granularity, ...params };
        return this.makePublicRequest('GET', '/market/markPriceCandlesticks', queryParams);
    }
    async getIndexPrice(symbol) {
        const params = { symbol };
        return this.makePublicRequest('GET', '/market/indexPrice', params);
    }
    async getMarkPrice(symbol) {
        const params = { symbol };
        return this.makePublicRequest('GET', '/market/markPrice', params);
    }
    async getFundingRate(symbol) {
        const params = { symbol };
        return this.makePublicRequest('GET', '/market/fundingRate', params);
    }
    async getFundingRateHistory(symbol, params = {}) {
        const queryParams = { symbol, ...params };
        return this.makePublicRequest('GET', '/market/fundingRate/history', queryParams);
    }
    async getOpenInterest(symbol) {
        const params = { symbol };
        return this.makePublicRequest('GET', '/market/openInterest', params);
    }
    async getRiskLimit(symbol) {
        const params = { symbol };
        return this.makePublicRequest('GET', '/market/riskLimit', params);
    }
    async getLiquidationOrders(symbol) {
        const params = { symbol };
        return this.makePublicRequest('GET', '/market/liquidationOrder', params);
    }
    async getInsuranceFund() {
        return this.makePublicRequest('GET', '/market/insurance');
    }
    async syncAccountToDatabase(userId, credentials) {
        try {
            const accountData = await this.getAccountBalance(credentials);
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
        }
        catch (error) {
            logger.error(`Failed to sync account data for user ${userId}:`, error);
            throw error;
        }
    }
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
        }
        catch (error) {
            logger.error(`Failed to sync positions for user ${userId}:`, error);
            throw error;
        }
    }
    async getAccountFromDatabase(userId) {
        const result = await query('SELECT * FROM futures_accounts WHERE user_id = $1 AND is_active = true LIMIT 1', [userId]);
        return result.rows[0] || null;
    }
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
        }
        catch (error) {
            logger.error('Failed to store order in database:', error);
            throw error;
        }
    }
    generateClientOrderId() {
        return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
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
    calculatePositionPnL(position, currentPrice) {
        if (!position.size || position.size === 0) {
            return 0;
        }
        const entryPrice = position.avg_open_price || position.avgEntryPrice || 0;
        const size = position.size || position.currentQty || 0;
        const isLong = position.position_side === 'LONG' || position.side === 'LONG';
        if (isLong) {
            return size * (currentPrice - entryPrice);
        }
        else {
            return size * (entryPrice - currentPrice);
        }
    }
    calculateLiquidationPrice(position, maintenanceMarginRate = 0.005) {
        const entryPrice = position.avg_open_price || position.avgEntryPrice || 0;
        const leverage = position.leverage || 1;
        const isLong = position.position_side === 'LONG' || position.side === 'LONG';
        if (isLong) {
            return entryPrice * (1 - (1 / leverage) + maintenanceMarginRate);
        }
        else {
            return entryPrice * (1 + (1 / leverage) + maintenanceMarginRate);
        }
    }
    async healthCheck() {
        try {
            await this.getProducts();
            return {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                service: 'PoloniexFuturesService'
            };
        }
        catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString(),
                service: 'PoloniexFuturesService'
            };
        }
    }
}
const poloniexFuturesService = new PoloniexFuturesService();
export { PoloniexFuturesService };
export default poloniexFuturesService;
