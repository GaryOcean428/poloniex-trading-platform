import WebSocket from 'ws';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { pool } from '../db/connection.js';
import alertingService from '../services/alertingService.js';
// Query helper function
const query = async (text, params) => {
    return await pool.query(text, params);
};
import { isAccountData, isPositionData, isOrderData, isTradeExecutionData } from '../types/websocketData.js';
/**
 * Poloniex Futures WebSocket Client
 * Handles real-time market data and private account updates
 * Based on https://api-docs.poloniex.com/v3/futures/websocket
 */
class FuturesWebSocketClient extends EventEmitter {
    constructor() {
        super();
        this.publicWS = null;
        this.privateWS = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
        this.pingInterval = null;
        this.credentials = null;
        this.subscriptions = new Map();
        // WebSocket URLs - Correct Poloniex V3 API endpoints (per official docs)
        this.publicURL = 'wss://ws.poloniex.com/ws/v3/public';
        this.privateURL = 'wss://ws.poloniex.com/ws/v3/private';
        // Subscription tracking
        this.marketDataSubscriptions = new Set();
        this.privateSubscriptions = new Set();
    }
    // =================== CONNECTION MANAGEMENT ===================
    /**
     * Connect to WebSocket (general method)
     */
    async connect() {
        try {
            // Add error handler to prevent uncaught errors
            this.on('error', (errorInfo) => {
                logger.error(`WebSocket ${errorInfo.type} error:`, errorInfo.error);
                // Don't crash the application, just log the error
            });
            await this.connectPublic();
            logger.info('✅ Futures WebSocket connected');
        }
        catch (error) {
            logger.error('Failed to connect to Futures WebSocket:', error);
            // Don't throw error to prevent application crash
            logger.info('WebSocket connection failed, continuing without WebSocket');
        }
    }
    /**
     * NOTE: Poloniex V3 API does not require token endpoint.
     * Public WebSocket connects directly without authentication.
     * Private WebSocket uses HMAC-SHA256 signed subscription messages.
     * Removed deprecated getWebSocketToken() method.
     */
    /**
     * Connect to public WebSocket
     */
    async connectPublic() {
        try {
            if (this.publicWS?.readyState === WebSocket.OPEN) {
                logger.info('Public WebSocket already connected');
                return;
            }
            logger.info('Connecting to Poloniex Futures public WebSocket...');
            // V3 API: Direct connection, no token required for public channel
            this.publicWS = new WebSocket(this.publicURL);
            // Properly typed event handlers following @types/ws
            this.publicWS.on('open', () => {
                logger.info('✅ Public WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.startPingInterval();
                this.emit('connected', { type: 'public' });
            });
            this.publicWS.on('message', (data) => {
                this.handleMessage(data, 'public');
            });
            this.publicWS.on('error', (error) => {
                logger.error('Public WebSocket error:', error);
                this.emit('error', { type: 'public', error });
            });
            this.publicWS.on('close', (code, reason) => {
                logger.warn(`Public WebSocket closed: ${code} - ${reason.toString()}`);
                this.isConnected = false;
                this.stopPingInterval();
                this.emit('disconnected', { type: 'public', code, reason: reason.toString() });
                // Alert if multiple reconnect attempts
                if (this.reconnectAttempts >= 3) {
                    alertingService.alertDisconnection({
                        service: 'public_websocket',
                        code,
                        reason: reason.toString(),
                        reconnectAttempts: this.reconnectAttempts
                    });
                }
                this.scheduleReconnect('public');
            });
        }
        catch (error) {
            logger.error('Failed to connect public WebSocket:', error);
            this.emit('error', { type: 'public', error });
        }
    }
    /**
     * Connect to private WebSocket with authentication
     */
    async connectPrivate(credentials) {
        try {
            if (this.privateWS?.readyState === WebSocket.OPEN) {
                logger.info('Private WebSocket already connected');
                return;
            }
            this.credentials = credentials;
            logger.info('Connecting to Poloniex Futures private WebSocket...');
            this.privateWS = new WebSocket(this.privateURL);
            // Properly typed event handlers following @types/ws
            this.privateWS.on('open', () => {
                logger.info('✅ Private WebSocket connected, authenticating...');
                this.authenticatePrivate();
            });
            this.privateWS.on('message', (data) => {
                this.handleMessage(data, 'private');
            });
            this.privateWS.on('error', (error) => {
                logger.error('Private WebSocket error:', error);
                this.emit('error', { type: 'private', error });
            });
            this.privateWS.on('close', (code, reason) => {
                logger.warn(`Private WebSocket closed: ${code} - ${reason.toString()}`);
                this.emit('disconnected', { type: 'private', code, reason: reason.toString() });
                // Alert if multiple reconnect attempts
                if (this.reconnectAttempts >= 3) {
                    alertingService.alertDisconnection({
                        service: 'private_websocket',
                        code,
                        reason: reason.toString(),
                        reconnectAttempts: this.reconnectAttempts
                    });
                }
                this.scheduleReconnect('private');
            });
        }
        catch (error) {
            logger.error('Failed to connect private WebSocket:', error);
            this.emit('error', { type: 'private', error });
        }
    }
    /**
     * Generate HMAC-SHA256 signature for private WebSocket messages
     * @private
     */
    generatePrivateSignature(timestamp) {
        if (!this.credentials) {
            throw new Error('No credentials available for signature generation');
        }
        const message = `${timestamp}GET/users/self/verify`;
        return crypto
            .createHmac('sha256', this.credentials.apiSecret)
            .update(message)
            .digest('base64');
    }
    /**
     * Authenticate private WebSocket connection
     */
    authenticatePrivate() {
        if (!this.credentials) {
            logger.error('No credentials provided for private WebSocket authentication');
            return;
        }
        try {
            const timestamp = Date.now().toString();
            const signature = this.generatePrivateSignature(timestamp);
            const authMessage = {
                id: Date.now(),
                type: 'subscribe',
                topic: '/contractAccount/wallet',
                privateChannel: true,
                response: true,
                apiKey: this.credentials.apiKey,
                sign: signature,
                timestamp: timestamp,
                passphrase: this.credentials.passphrase || ''
            };
            this.privateWS?.send(JSON.stringify(authMessage));
            logger.info('Private WebSocket authentication sent');
        }
        catch (error) {
            logger.error('Failed to authenticate private WebSocket:', error);
            this.emit('error', { type: 'private', error });
        }
    }
    /**
     * Disconnect WebSocket connections
     */
    disconnect() {
        this.stopPingInterval();
        if (this.publicWS) {
            this.publicWS.close();
            this.publicWS = null;
        }
        if (this.privateWS) {
            this.privateWS.close();
            this.privateWS = null;
        }
        this.isConnected = false;
        this.subscriptions.clear();
        this.marketDataSubscriptions.clear();
        this.privateSubscriptions.clear();
        logger.info('WebSocket connections closed');
    }
    // =================== MESSAGE HANDLING ===================
    /**
     * Handle incoming WebSocket messages
     * @param data - Raw message data from WebSocket (Buffer type from @types/ws)
     * @param type - Connection type ('public' or 'private')
     */
    handleMessage(data, type) {
        try {
            const message = JSON.parse(data.toString());
            // Handle different message types
            switch (message.type) {
                case 'welcome':
                    this.handleWelcome(message, type);
                    break;
                case 'ack':
                    this.handleAck(message, type);
                    break;
                case 'error':
                    this.handleError(message, type);
                    break;
                case 'message':
                    this.handleDataMessage(message, type);
                    break;
                case 'pong':
                    // Pong response, connection is alive
                    break;
                default:
                    logger.debug(`Unknown message type: ${message.type}`, message);
            }
        }
        catch (error) {
            logger.error('Failed to parse WebSocket message:', error);
            logger.debug('Raw message:', data.toString());
        }
    }
    /**
     * Handle welcome message
     */
    handleWelcome(message, type) {
        logger.info(`${type} WebSocket welcome received`);
        this.emit('welcome', { type, message });
    }
    /**
     * Handle acknowledgment message
     */
    handleAck(message, type) {
        logger.debug(`${type} WebSocket ack received:`, message);
        this.emit('ack', { type, message });
    }
    /**
     * Handle error message
     */
    handleError(message, type) {
        logger.error(`${type} WebSocket error:`, message);
        this.emit('error', { type, message });
    }
    /**
     * Handle data message
     */
    async handleDataMessage(message, type) {
        try {
            const { topic, subject, data } = message;
            // Route message based on topic
            switch (topic) {
                case '/contractMarket/ticker':
                    await this.handleTickerUpdate(data);
                    break;
                case '/contractMarket/level2':
                    await this.handleOrderBookUpdate(data);
                    break;
                case '/contractMarket/execution':
                    await this.handleTradeUpdate(data);
                    break;
                case '/contractAccount/wallet':
                    await this.handleAccountUpdate(data);
                    break;
                case '/contractAccount/position':
                    await this.handlePositionUpdate(data);
                    break;
                case '/contractAccount/orders':
                    await this.handleOrderUpdate(data);
                    break;
                case '/contractAccount/trades':
                    await this.handleTradeExecutionUpdate(data);
                    break;
                case '/contract/funding':
                    await this.handleFundingUpdate(data);
                    break;
                default:
                    logger.debug(`Unhandled topic: ${topic}`, data);
            }
            // Emit generic message event
            this.emit('message', { type, topic, subject, data });
        }
        catch (error) {
            logger.error('Failed to handle data message:', error);
        }
    }
    // =================== DATA HANDLERS ===================
    /**
     * Handle ticker updates
     */
    async handleTickerUpdate(data) {
        try {
            // Type assertion for ticker data
            const tickerData = data;
            await query(`
        INSERT INTO futures_market_data (
          symbol, last_price, mark_price, index_price, best_bid, best_ask,
          high_24h, low_24h, volume_24h, turnover_24h, change_24h,
          funding_rate, next_funding_time, open_interest, market_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (symbol, market_time) DO UPDATE SET
          last_price = EXCLUDED.last_price,
          mark_price = EXCLUDED.mark_price,
          index_price = EXCLUDED.index_price,
          best_bid = EXCLUDED.best_bid,
          best_ask = EXCLUDED.best_ask,
          high_24h = EXCLUDED.high_24h,
          low_24h = EXCLUDED.low_24h,
          volume_24h = EXCLUDED.volume_24h,
          turnover_24h = EXCLUDED.turnover_24h,
          change_24h = EXCLUDED.change_24h,
          funding_rate = EXCLUDED.funding_rate,
          next_funding_time = EXCLUDED.next_funding_time,
          open_interest = EXCLUDED.open_interest,
          updated_at = CURRENT_TIMESTAMP
      `, [
                tickerData.symbol,
                tickerData.price || tickerData.lastPrice || 0,
                tickerData.markPrice || 0,
                tickerData.indexPrice || 0,
                tickerData.bestBid || 0,
                tickerData.bestAsk || 0,
                tickerData.high24h || 0,
                tickerData.low24h || 0,
                tickerData.volume24h || 0,
                tickerData.turnover24h || 0,
                tickerData.change24h || 0,
                tickerData.fundingRate || 0,
                tickerData.nextFundingTime ? new Date(tickerData.nextFundingTime) : null,
                tickerData.openInterest || 0,
                new Date(tickerData.ts || Date.now())
            ]);
            this.emit('ticker', data);
        }
        catch (error) {
            logger.error('Failed to handle ticker update:', error);
        }
    }
    /**
     * Handle order book updates
     */
    async handleOrderBookUpdate(data) {
        // Store in memory or cache for real-time access
        this.emit('orderbook', data);
    }
    /**
     * Handle trade updates
     */
    async handleTradeUpdate(data) {
        this.emit('trade', data);
    }
    /**
     * Handle account updates
     */
    async handleAccountUpdate(data) {
        try {
            // Type assertion for account data with validation
            if (!isAccountData(data)) {
                logger.warn('Invalid account data format:', data);
                return;
            }
            const accountData = data;
            // Update account balance in database
            await query(`
        UPDATE futures_accounts 
        SET total_equity = $1, available_balance = $2, 
            initial_margin = $3, maintenance_margin = $4,
            margin_ratio = $5, last_synced_at = CURRENT_TIMESTAMP
        WHERE poloniex_account_id = $6
      `, [
                accountData.equity || 0,
                accountData.availableBalance || 0,
                accountData.initialMargin || 0,
                accountData.maintenanceMargin || 0,
                accountData.marginRatio || 0,
                accountData.accountId || 'default'
            ]);
            this.emit('account', data);
        }
        catch (error) {
            logger.error('Failed to handle account update:', error);
        }
    }
    /**
     * Handle position updates
     */
    async handlePositionUpdate(data) {
        try {
            // Type assertion for position data with validation
            if (!isPositionData(data)) {
                logger.warn('Invalid position data format:', data);
                return;
            }
            const positionData = data;
            // Update position in database
            await query(`
        UPDATE futures_positions 
        SET size = $1, available_size = $2, mark_price = $3,
            unrealized_pnl = $4, liquidation_price = $5,
            last_updated_at = CURRENT_TIMESTAMP
        WHERE symbol = $6 AND position_side = $7
      `, [
                positionData.currentQty || 0,
                positionData.availableQty || 0,
                positionData.markPrice || 0,
                positionData.unrealisedPnl || 0,
                positionData.liquidationPrice || 0,
                positionData.symbol,
                positionData.side?.toUpperCase() || 'BOTH'
            ]);
            this.emit('position', data);
        }
        catch (error) {
            logger.error('Failed to handle position update:', error);
        }
    }
    /**
     * Handle order updates
     */
    async handleOrderUpdate(data) {
        try {
            // Type assertion for order data with validation
            if (!isOrderData(data)) {
                logger.warn('Invalid order data format:', data);
                return;
            }
            const orderData = data;
            // Update order status in database
            await query(`
        UPDATE futures_orders 
        SET status = $1, filled_size = $2, filled_value = $3,
            avg_filled_price = $4, fee = $5, updated_at = CURRENT_TIMESTAMP
        WHERE poloniex_order_id = $6
      `, [
                orderData.status?.toUpperCase() || 'UNKNOWN',
                orderData.filledSize || 0,
                orderData.filledValue || 0,
                orderData.avgPrice || 0,
                orderData.fee || 0,
                orderData.orderId
            ]);
            this.emit('order', data);
        }
        catch (error) {
            logger.error('Failed to handle order update:', error);
        }
    }
    /**
     * Handle trade execution updates
     */
    async handleTradeExecutionUpdate(data) {
        try {
            // Type assertion for trade execution data with validation
            if (!isTradeExecutionData(data)) {
                logger.warn('Invalid trade execution data format:', data);
                return;
            }
            const tradeData = data;
            // Store trade execution in database
            const orderResult = await query('SELECT id, user_id, account_id FROM futures_orders WHERE poloniex_order_id = $1', [tradeData.orderId]);
            if (orderResult.rows.length > 0) {
                const order = orderResult.rows[0];
                await query(`
          INSERT INTO futures_trades (
            user_id, account_id, order_id, poloniex_trade_id, symbol,
            side, position_side, price, size, value, fee, role,
            trade_time, poloniex_trade_time
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (poloniex_trade_id) DO NOTHING
        `, [
                    order.user_id,
                    order.account_id,
                    order.id,
                    tradeData.tradeId,
                    tradeData.symbol,
                    tradeData.side?.toUpperCase(),
                    tradeData.side?.toUpperCase() || 'BOTH',
                    tradeData.price || 0,
                    tradeData.size || 0,
                    tradeData.value || 0,
                    tradeData.fee || 0,
                    tradeData.liquidity || 'TAKER',
                    new Date(),
                    new Date(tradeData.ts || Date.now())
                ]);
            }
            this.emit('tradeExecution', data);
        }
        catch (error) {
            logger.error('Failed to handle trade execution update:', error);
        }
    }
    /**
     * Handle funding updates
     */
    async handleFundingUpdate(data) {
        this.emit('funding', data);
    }
    // =================== SUBSCRIPTION MANAGEMENT ===================
    /**
     * Subscribe to market data
     */
    subscribeToMarketData(symbol, channels = ['ticker', 'level2', 'execution']) {
        if (!this.publicWS || this.publicWS.readyState !== WebSocket.OPEN) {
            logger.warn('Public WebSocket not connected, cannot subscribe to market data');
            return;
        }
        channels.forEach(channel => {
            const topic = `/contractMarket/${channel}:${symbol}`;
            const subscriptionId = `${symbol}_${channel}`;
            if (this.marketDataSubscriptions.has(subscriptionId)) {
                logger.debug(`Already subscribed to ${topic}`);
                return;
            }
            const message = {
                id: Date.now(),
                type: 'subscribe',
                topic: topic,
                response: true
            };
            this.publicWS?.send(JSON.stringify(message));
            this.marketDataSubscriptions.add(subscriptionId);
            logger.info(`Subscribed to ${topic}`);
        });
    }
    /**
     * Subscribe to private channels with HMAC-SHA256 authentication
     */
    subscribeToPrivateChannels(channels = ['wallet', 'position', 'orders', 'trades']) {
        if (!this.privateWS || this.privateWS.readyState !== WebSocket.OPEN) {
            logger.warn('Private WebSocket not connected, cannot subscribe to private channels');
            return;
        }
        if (!this.credentials) {
            logger.error('No credentials available for private channel subscription');
            return;
        }
        channels.forEach(channel => {
            const topic = `/contractAccount/${channel}`;
            if (this.privateSubscriptions.has(channel)) {
                logger.debug(`Already subscribed to ${topic}`);
                return;
            }
            try {
                const timestamp = Date.now().toString();
                const signature = this.generatePrivateSignature(timestamp);
                const message = {
                    id: Date.now(),
                    type: 'subscribe',
                    topic: topic,
                    privateChannel: true,
                    response: true,
                    apiKey: this.credentials.apiKey,
                    sign: signature,
                    timestamp: timestamp,
                    passphrase: this.credentials.passphrase || ''
                };
                this.privateWS?.send(JSON.stringify(message));
                this.privateSubscriptions.add(channel);
                logger.info(`Subscribed to ${topic} with authentication`);
            }
            catch (error) {
                logger.error(`Failed to subscribe to ${topic}:`, error);
                this.emit('error', { type: 'private', error });
            }
        });
    }
    /**
     * Unsubscribe from topic
     */
    unsubscribe(topic) {
        const ws = topic.includes('contractAccount') ? this.privateWS : this.publicWS;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            logger.warn('WebSocket not connected, cannot unsubscribe');
            return;
        }
        const message = {
            id: Date.now(),
            type: 'unsubscribe',
            topic: topic,
            response: true
        };
        ws.send(JSON.stringify(message));
        // Remove from tracking
        this.marketDataSubscriptions.delete(topic);
        this.privateSubscriptions.delete(topic);
        logger.info(`Unsubscribed from ${topic}`);
    }
    // =================== UTILITY METHODS ===================
    /**
     * Start ping interval to keep connection alive
     */
    startPingInterval() {
        this.pingInterval = setInterval(() => {
            if (this.publicWS?.readyState === WebSocket.OPEN) {
                this.publicWS.send(JSON.stringify({ type: 'ping' }));
            }
            if (this.privateWS?.readyState === WebSocket.OPEN) {
                this.privateWS.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000); // Ping every 30 seconds
    }
    /**
     * Stop ping interval
     */
    stopPingInterval() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
    /**
     * Schedule reconnection
     */
    scheduleReconnect(type) {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error(`Max reconnection attempts reached for ${type} WebSocket`);
            return;
        }
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;
        logger.info(`Scheduling ${type} WebSocket reconnection in ${delay}ms (attempt ${this.reconnectAttempts})`);
        setTimeout(() => {
            if (type === 'public') {
                this.connectPublic();
            }
            else {
                this.connectPrivate(this.credentials);
            }
        }, delay);
    }
    /**
     * Get connection status
     */
    getConnectionStatus() {
        return {
            public: {
                connected: this.publicWS?.readyState === WebSocket.OPEN || false,
                subscriptions: Array.from(this.marketDataSubscriptions)
            },
            private: {
                connected: this.privateWS?.readyState === WebSocket.OPEN || false,
                subscriptions: Array.from(this.privateSubscriptions)
            },
            reconnectAttempts: this.reconnectAttempts
        };
    }
    /**
     * Health check
     */
    healthCheck() {
        const status = this.getConnectionStatus();
        return {
            healthy: status.public.connected,
            details: status,
            timestamp: new Date().toISOString()
        };
    }
}
// Create singleton instance
const futuresWebSocket = new FuturesWebSocketClient();
export { FuturesWebSocketClient };
export default futuresWebSocket;
