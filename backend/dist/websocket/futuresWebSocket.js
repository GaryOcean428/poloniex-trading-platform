import WebSocket from 'ws';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { pool } from '../db/connection.js';
import alertingService from '../services/alertingService.js';
const query = async (text, params) => {
    return await pool.query(text, params);
};
import { isAccountData, isPositionData, isOrderData, isTradeExecutionData } from '../types/websocketData.js';
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
        this.publicURL = 'wss://futures-apiws.poloniex.com/endpoint';
        this.privateURL = 'wss://futures-apiws.poloniex.com/endpoint';
        this.marketDataSubscriptions = new Set();
        this.privateSubscriptions = new Set();
    }
    async connect() {
        try {
            this.on('error', (errorInfo) => {
                logger.error(`WebSocket ${errorInfo.type} error:`, errorInfo.error);
            });
            await this.connectPublic();
            logger.info('✅ Futures WebSocket connected');
        }
        catch (error) {
            logger.error('Failed to connect to Futures WebSocket:', error);
            logger.info('WebSocket connection failed, continuing without WebSocket');
        }
    }
    async getWebSocketToken() {
        try {
            const response = await globalThis.fetch('https://futures-api.poloniex.com/api/v1/bullet-public', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`Failed to get WebSocket token: ${response.status}`);
            }
            const data = await response.json();
            if (data?.data?.token) {
                return data.data.token;
            }
            else {
                throw new Error('Invalid token response format');
            }
        }
        catch (error) {
            logger.error('Failed to get WebSocket token:', error);
            throw error;
        }
    }
    async connectPublic() {
        try {
            if (this.publicWS?.readyState === WebSocket.OPEN) {
                logger.info('Public WebSocket already connected');
                return;
            }
            logger.info('Getting WebSocket token...');
            const token = await this.getWebSocketToken();
            logger.info('Connecting to Poloniex Futures public WebSocket...');
            const wsUrl = `${this.publicURL}?token=${token}`;
            this.publicWS = new WebSocket(wsUrl);
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
    async connectPrivate(credentials) {
        try {
            if (this.privateWS?.readyState === WebSocket.OPEN) {
                logger.info('Private WebSocket already connected');
                return;
            }
            this.credentials = credentials;
            logger.info('Connecting to Poloniex Futures private WebSocket...');
            this.privateWS = new WebSocket(this.privateURL);
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
    authenticatePrivate() {
        if (!this.credentials) {
            logger.error('No credentials provided for private WebSocket authentication');
            return;
        }
        try {
            const timestamp = Date.now().toString();
            const message = `${timestamp}GET/users/self/verify`;
            const signature = crypto
                .createHmac('sha256', this.credentials.apiSecret)
                .update(message)
                .digest('base64');
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
    handleMessage(data, type) {
        try {
            const message = JSON.parse(data.toString());
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
    handleWelcome(message, type) {
        logger.info(`${type} WebSocket welcome received`);
        this.emit('welcome', { type, message });
    }
    handleAck(message, type) {
        logger.debug(`${type} WebSocket ack received:`, message);
        this.emit('ack', { type, message });
    }
    handleError(message, type) {
        logger.error(`${type} WebSocket error:`, message);
        this.emit('error', { type, message });
    }
    async handleDataMessage(message, type) {
        try {
            const { topic, subject, data } = message;
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
            this.emit('message', { type, topic, subject, data });
        }
        catch (error) {
            logger.error('Failed to handle data message:', error);
        }
    }
    async handleTickerUpdate(data) {
        try {
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
    async handleOrderBookUpdate(data) {
        this.emit('orderbook', data);
    }
    async handleTradeUpdate(data) {
        this.emit('trade', data);
    }
    async handleAccountUpdate(data) {
        try {
            if (!isAccountData(data)) {
                logger.warn('Invalid account data format:', data);
                return;
            }
            const accountData = data;
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
    async handlePositionUpdate(data) {
        try {
            if (!isPositionData(data)) {
                logger.warn('Invalid position data format:', data);
                return;
            }
            const positionData = data;
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
    async handleOrderUpdate(data) {
        try {
            if (!isOrderData(data)) {
                logger.warn('Invalid order data format:', data);
                return;
            }
            const orderData = data;
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
    async handleTradeExecutionUpdate(data) {
        try {
            if (!isTradeExecutionData(data)) {
                logger.warn('Invalid trade execution data format:', data);
                return;
            }
            const tradeData = data;
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
    async handleFundingUpdate(data) {
        this.emit('funding', data);
    }
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
    subscribeToPrivateChannels(channels = ['wallet', 'position', 'orders', 'trades']) {
        if (!this.privateWS || this.privateWS.readyState !== WebSocket.OPEN) {
            logger.warn('Private WebSocket not connected, cannot subscribe to private channels');
            return;
        }
        channels.forEach(channel => {
            const topic = `/contractAccount/${channel}`;
            if (this.privateSubscriptions.has(channel)) {
                logger.debug(`Already subscribed to ${topic}`);
                return;
            }
            const message = {
                id: Date.now(),
                type: 'subscribe',
                topic: topic,
                privateChannel: true,
                response: true
            };
            this.privateWS?.send(JSON.stringify(message));
            this.privateSubscriptions.add(channel);
            logger.info(`Subscribed to ${topic}`);
        });
    }
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
        this.marketDataSubscriptions.delete(topic);
        this.privateSubscriptions.delete(topic);
        logger.info(`Unsubscribed from ${topic}`);
    }
    startPingInterval() {
        this.pingInterval = setInterval(() => {
            if (this.publicWS?.readyState === WebSocket.OPEN) {
                this.publicWS.send(JSON.stringify({ type: 'ping' }));
            }
            if (this.privateWS?.readyState === WebSocket.OPEN) {
                this.privateWS.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    }
    stopPingInterval() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
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
    healthCheck() {
        const status = this.getConnectionStatus();
        return {
            healthy: status.public.connected,
            details: status,
            timestamp: new Date().toISOString()
        };
    }
}
const futuresWebSocket = new FuturesWebSocketClient();
export { FuturesWebSocketClient };
export default futuresWebSocket;
