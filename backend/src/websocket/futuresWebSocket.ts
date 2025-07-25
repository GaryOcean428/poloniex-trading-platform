import WebSocket from 'ws';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { pool } from '../db/connection.js';

// Query helper function
const query = async (text: string, params?: any[]) => {
  return await pool.query(text, params);
};
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { WebSocketEvents, PoloniexEvents, PoloniexTopics, MessageTypes } from '../types/websocketEvents.js';

// WebSocket event handler type definitions aligned with @types/ws
type WebSocketEventHandler = (ws: WebSocket, message: Buffer) => void | Promise<void>;
type WebSocketErrorHandler = (ws: WebSocket, error: Error) => void | Promise<void>;
type WebSocketConnectionHandler = (ws: WebSocket) => void | Promise<void>;
type WebSocketCloseHandler = (ws: WebSocket, code: number, reason: Buffer) => void | Promise<void>;

// Message interfaces for type safety
interface PoloniexMessage {
  type: string;
  topic?: string;
  subject?: string;
  data?: any;
  id?: number;
}

interface SubscriptionMessage {
  id: number;
  type: 'subscribe' | 'unsubscribe';
  topic: string;
  privateChannel?: boolean;
  response?: boolean;
  apiKey?: string;
  sign?: string;
  timestamp?: string;
  passphrase?: string;
}

interface ConnectionCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

interface ConnectionStatus {
  public: {
    connected: boolean;
    subscriptions: string[];
  };
  private: {
    connected: boolean;
    subscriptions: string[];
  };
  reconnectAttempts: number;
}

interface HealthCheckResult {
  healthy: boolean;
  details: ConnectionStatus;
  timestamp: string;
}

/**
 * Poloniex Futures WebSocket Client
 * Handles real-time market data and private account updates
 * Based on https://api-docs.poloniex.com/v3/futures/websocket
 */
class FuturesWebSocketClient extends EventEmitter {
  private publicWS: WebSocket | null = null;
  private privateWS: WebSocket | null = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 5;
  private readonly reconnectDelay: number = 5000;
  private pingInterval: NodeJS.Timeout | null = null;
  private credentials: ConnectionCredentials | null = null;
  private subscriptions: Map<string, any> = new Map();
  
  // WebSocket URLs - Updated to correct Poloniex V3 API endpoints
  private readonly publicURL: string = 'wss://futures-apiws.poloniex.com/endpoint';
  private readonly privateURL: string = 'wss://futures-apiws.poloniex.com/endpoint';
  
  // Subscription tracking
  private marketDataSubscriptions: Set<string> = new Set();
  private privateSubscriptions: Set<string> = new Set();

  constructor() {
    super();
  }

  // =================== CONNECTION MANAGEMENT ===================

  /**
   * Connect to WebSocket (general method)
   */
  async connect(): Promise<void> {
    try {
      // Add error handler to prevent uncaught errors
      this.on('error', (errorInfo: { type: string; error: Error }) => {
        logger.error(`WebSocket ${errorInfo.type} error:`, errorInfo.error);
        // Don't crash the application, just log the error
      });
      
      await this.connectPublic();
      logger.info('✅ Futures WebSocket connected');
    } catch (error) {
      logger.error('Failed to connect to Futures WebSocket:', error);
      // Don't throw error to prevent application crash
      logger.info('WebSocket connection failed, continuing without WebSocket');
    }
  }

  /**
   * Get WebSocket token for V3 API
   */
  private async getWebSocketToken(): Promise<string> {
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
      } else {
        throw new Error('Invalid token response format');
      }
    } catch (error) {
      logger.error('Failed to get WebSocket token:', error);
      throw error;
    }
  }

  /**
   * Connect to public WebSocket
   */
  private async connectPublic(): Promise<void> {
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
      
      // Properly typed event handlers following @types/ws
      this.publicWS.on('open', () => {
        logger.info('✅ Public WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startPingInterval();
        this.emit('connected', { type: 'public' });
      });

      this.publicWS.on('message', (data: Buffer) => {
        this.handleMessage(data, 'public');
      });

      this.publicWS.on('error', (error: Error) => {
        logger.error('Public WebSocket error:', error);
        this.emit('error', { type: 'public', error });
      });

      this.publicWS.on('close', (code: number, reason: Buffer) => {
        logger.warn(`Public WebSocket closed: ${code} - ${reason.toString()}`);
        this.isConnected = false;
        this.stopPingInterval();
        this.emit('disconnected', { type: 'public', code, reason: reason.toString() });
        this.scheduleReconnect('public');
      });

    } catch (error) {
      logger.error('Failed to connect public WebSocket:', error);
      this.emit('error', { type: 'public', error });
    }
  }

  /**
   * Connect to private WebSocket with authentication
   */
  async connectPrivate(credentials: ConnectionCredentials): Promise<void> {
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

      this.privateWS.on('message', (data: Buffer) => {
        this.handleMessage(data, 'private');
      });

      this.privateWS.on('error', (error: Error) => {
        logger.error('Private WebSocket error:', error);
        this.emit('error', { type: 'private', error });
      });

      this.privateWS.on('close', (code: number, reason: Buffer) => {
        logger.warn(`Private WebSocket closed: ${code} - ${reason.toString()}`);
        this.emit('disconnected', { type: 'private', code, reason: reason.toString() });
        this.scheduleReconnect('private');
      });

    } catch (error) {
      logger.error('Failed to connect private WebSocket:', error);
      this.emit('error', { type: 'private', error });
    }
  }

  /**
   * Authenticate private WebSocket connection
   */
  private authenticatePrivate(): void {
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

      const authMessage: SubscriptionMessage = {
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

    } catch (error) {
      logger.error('Failed to authenticate private WebSocket:', error);
      this.emit('error', { type: 'private', error });
    }
  }

  /**
   * Disconnect WebSocket connections
   */
  disconnect(): void {
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
  private handleMessage(data: Buffer, type: string): void {
    try {
      const message: PoloniexMessage = JSON.parse(data.toString());
      
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
      
    } catch (error) {
      logger.error('Failed to parse WebSocket message:', error);
      logger.debug('Raw message:', data.toString());
    }
  }

  /**
   * Handle welcome message
   */
  private handleWelcome(message: PoloniexMessage, type: string): void {
    logger.info(`${type} WebSocket welcome received`);
    this.emit('welcome', { type, message });
  }

  /**
   * Handle acknowledgment message
   */
  private handleAck(message: PoloniexMessage, type: string): void {
    logger.debug(`${type} WebSocket ack received:`, message);
    this.emit('ack', { type, message });
  }

  /**
   * Handle error message
   */
  private handleError(message: PoloniexMessage, type: string): void {
    logger.error(`${type} WebSocket error:`, message);
    this.emit('error', { type, message });
  }

  /**
   * Handle data message
   */
  private async handleDataMessage(message: PoloniexMessage, type: string): Promise<void> {
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
      
    } catch (error) {
      logger.error('Failed to handle data message:', error);
    }
  }

  // =================== DATA HANDLERS ===================

  /**
   * Handle ticker updates
   */
  private async handleTickerUpdate(data: any): Promise<void> {
    try {
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
        data.symbol,
        data.price || data.lastPrice || 0,
        data.markPrice || 0,
        data.indexPrice || 0,
        data.bestBid || 0,
        data.bestAsk || 0,
        data.high24h || 0,
        data.low24h || 0,
        data.volume24h || 0,
        data.turnover24h || 0,
        data.change24h || 0,
        data.fundingRate || 0,
        data.nextFundingTime ? new Date(data.nextFundingTime) : null,
        data.openInterest || 0,
        new Date(data.ts || Date.now())
      ]);
      
      this.emit('ticker', data);
      
    } catch (error) {
      logger.error('Failed to handle ticker update:', error);
    }
  }

  /**
   * Handle order book updates
   */
  private async handleOrderBookUpdate(data: any): Promise<void> {
    // Store in memory or cache for real-time access
    this.emit('orderbook', data);
  }

  /**
   * Handle trade updates
   */
  private async handleTradeUpdate(data: any): Promise<void> {
    this.emit('trade', data);
  }

  /**
   * Handle account updates
   */
  private async handleAccountUpdate(data: any): Promise<void> {
    try {
      // Update account balance in database
      await query(`
        UPDATE futures_accounts 
        SET total_equity = $1, available_balance = $2, 
            initial_margin = $3, maintenance_margin = $4,
            margin_ratio = $5, last_synced_at = CURRENT_TIMESTAMP
        WHERE poloniex_account_id = $6
      `, [
        data.equity || 0,
        data.availableBalance || 0,
        data.initialMargin || 0,
        data.maintenanceMargin || 0,
        data.marginRatio || 0,
        data.accountId || 'default'
      ]);
      
      this.emit('account', data);
      
    } catch (error) {
      logger.error('Failed to handle account update:', error);
    }
  }

  /**
   * Handle position updates
   */
  private async handlePositionUpdate(data: any): Promise<void> {
    try {
      // Update position in database
      await query(`
        UPDATE futures_positions 
        SET size = $1, available_size = $2, mark_price = $3,
            unrealized_pnl = $4, liquidation_price = $5,
            last_updated_at = CURRENT_TIMESTAMP
        WHERE symbol = $6 AND position_side = $7
      `, [
        data.currentQty || 0,
        data.availableQty || 0,
        data.markPrice || 0,
        data.unrealisedPnl || 0,
        data.liquidationPrice || 0,
        data.symbol,
        data.side?.toUpperCase() || 'BOTH'
      ]);
      
      this.emit('position', data);
      
    } catch (error) {
      logger.error('Failed to handle position update:', error);
    }
  }

  /**
   * Handle order updates
   */
  private async handleOrderUpdate(data: any): Promise<void> {
    try {
      // Update order status in database
      await query(`
        UPDATE futures_orders 
        SET status = $1, filled_size = $2, filled_value = $3,
            avg_filled_price = $4, fee = $5, updated_at = CURRENT_TIMESTAMP
        WHERE poloniex_order_id = $6
      `, [
        data.status?.toUpperCase() || 'UNKNOWN',
        data.filledSize || 0,
        data.filledValue || 0,
        data.avgPrice || 0,
        data.fee || 0,
        data.orderId
      ]);
      
      this.emit('order', data);
      
    } catch (error) {
      logger.error('Failed to handle order update:', error);
    }
  }

  /**
   * Handle trade execution updates
   */
  private async handleTradeExecutionUpdate(data: any): Promise<void> {
    try {
      // Store trade execution in database
      const orderResult = await query(
        'SELECT id, user_id, account_id FROM futures_orders WHERE poloniex_order_id = $1',
        [data.orderId]
      );
      
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
          data.tradeId,
          data.symbol,
          data.side?.toUpperCase(),
          data.side?.toUpperCase() || 'BOTH',
          data.price || 0,
          data.size || 0,
          data.value || 0,
          data.fee || 0,
          data.liquidity || 'TAKER',
          new Date(),
          new Date(data.ts || Date.now())
        ]);
      }
      
      this.emit('tradeExecution', data);
      
    } catch (error) {
      logger.error('Failed to handle trade execution update:', error);
    }
  }

  /**
   * Handle funding updates
   */
  private async handleFundingUpdate(data: any): Promise<void> {
    this.emit('funding', data);
  }

  // =================== SUBSCRIPTION MANAGEMENT ===================

  /**
   * Subscribe to market data
   */
  subscribeToMarketData(symbol: string, channels: string[] = ['ticker', 'level2', 'execution']): void {
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

      const message: SubscriptionMessage = {
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
   * Subscribe to private channels
   */
  subscribeToPrivateChannels(channels: string[] = ['wallet', 'position', 'orders', 'trades']): void {
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

      const message: SubscriptionMessage = {
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

  /**
   * Unsubscribe from topic
   */
  unsubscribe(topic: string): void {
    const ws = topic.includes('contractAccount') ? this.privateWS : this.publicWS;
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.warn('WebSocket not connected, cannot unsubscribe');
      return;
    }

    const message: SubscriptionMessage = {
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
  private startPingInterval(): void {
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
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(type: 'public' | 'private'): void {
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
      } else {
        this.connectPrivate(this.credentials!);
      }
    }, delay);
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): ConnectionStatus {
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
  healthCheck(): HealthCheckResult {
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

export { FuturesWebSocketClient, type ConnectionCredentials, type ConnectionStatus, type HealthCheckResult };
export default futuresWebSocket;
