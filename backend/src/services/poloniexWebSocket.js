import WebSocket from 'ws';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';

/**
 * Poloniex WebSocket Service
 * Handles real-time data streams from Poloniex
 * Based on: https://api-docs.poloniex.com/spot/websocket/
 */
class PoloniexWebSocketService extends EventEmitter {
  constructor() {
    super();
    this.wsUrl = 'wss://ws.poloniex.com/ws/public';
    this.wsPrivateUrl = 'wss://ws.poloniex.com/ws/private';
    this.ws = null;
    this.wsPrivate = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.reconnectAttempts = 0;
    this.subscriptions = new Set();
    this.isConnected = false;
    this.isPrivateConnected = false;
    this.pingInterval = null;
    this.credentials = null;
  }

  /**
   * Generate signature for private WebSocket authentication
   */
  generateSignature(timestamp, apiSecret) {
    const message = `${timestamp}`;
    return crypto
      .createHmac('sha256', apiSecret)
      .update(message)
      .digest('hex');
  }

  /**
   * Connect to public WebSocket
   */
  connectPublic() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      logger.info('Public WebSocket already connected');
      return;
    }

    logger.info('Connecting to Poloniex public WebSocket...');
    
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      logger.info('Public WebSocket connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      
      // Start ping interval
      this.startPingInterval();
      
      // Resubscribe to channels
      this.resubscribe();
      
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        logger.error('Error parsing WebSocket message:', error);
      }
    });

    this.ws.on('error', (error) => {
      logger.error('Public WebSocket error:', error);
      this.emit('error', error);
    });

    this.ws.on('close', () => {
      logger.info('Public WebSocket disconnected');
      this.isConnected = false;
      this.stopPingInterval();
      
      // Attempt reconnection
      this.scheduleReconnect();
      
      this.emit('disconnected');
    });
  }

  /**
   * Connect to private WebSocket (authenticated)
   */
  connectPrivate(credentials) {
    if (this.wsPrivate && this.wsPrivate.readyState === WebSocket.OPEN) {
      logger.info('Private WebSocket already connected');
      return;
    }

    if (!credentials || !credentials.apiKey || !credentials.apiSecret) {
      throw new Error('API credentials required for private WebSocket');
    }

    this.credentials = credentials;
    logger.info('Connecting to Poloniex private WebSocket...');
    
    this.wsPrivate = new WebSocket(this.wsPrivateUrl);

    this.wsPrivate.on('open', () => {
      logger.info('Private WebSocket connected, authenticating...');
      
      // Authenticate
      const timestamp = Date.now();
      const signature = this.generateSignature(timestamp, credentials.apiSecret);
      
      const authMessage = {
        event: 'subscribe',
        channel: ['auth'],
        params: {
          key: credentials.apiKey,
          signTimestamp: timestamp,
          signature: signature
        }
      };
      
      this.wsPrivate.send(JSON.stringify(authMessage));
    });

    this.wsPrivate.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Check for authentication response
        if (message.channel === 'auth' && message.data && message.data[0] === 'success') {
          logger.info('Private WebSocket authenticated successfully');
          this.isPrivateConnected = true;
          this.emit('private_connected');
        } else {
          this.handlePrivateMessage(message);
        }
      } catch (error) {
        logger.error('Error parsing private WebSocket message:', error);
      }
    });

    this.wsPrivate.on('error', (error) => {
      logger.error('Private WebSocket error:', error);
      this.emit('private_error', error);
    });

    this.wsPrivate.on('close', () => {
      logger.info('Private WebSocket disconnected');
      this.isPrivateConnected = false;
      this.emit('private_disconnected');
      
      // Attempt reconnection if credentials are available
      if (this.credentials) {
        setTimeout(() => this.connectPrivate(this.credentials), this.reconnectDelay);
      }
    });
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );
    
    logger.info(`Scheduling reconnection in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connectPublic();
    }, delay);
  }

  /**
   * Start ping interval to keep connection alive
   */
  startPingInterval() {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
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
   * Subscribe to a channel
   */
  subscribe(channel, symbols = []) {
    if (!this.isConnected) {
      logger.warn('WebSocket not connected, queuing subscription');
      this.subscriptions.add({ channel, symbols });
      return;
    }

    const message = {
      event: 'subscribe',
      channel: [channel],
      symbols: symbols
    };

    logger.info('Subscribing to channel:', { channel, symbols });
    this.ws.send(JSON.stringify(message));
    this.subscriptions.add({ channel, symbols });
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel, symbols = []) {
    if (!this.isConnected) {
      return;
    }

    const message = {
      event: 'unsubscribe',
      channel: [channel],
      symbols: symbols
    };

    logger.info('Unsubscribing from channel:', { channel, symbols });
    this.ws.send(JSON.stringify(message));
    
    // Remove from subscriptions
    this.subscriptions.forEach(sub => {
      if (sub.channel === channel && JSON.stringify(sub.symbols) === JSON.stringify(symbols)) {
        this.subscriptions.delete(sub);
      }
    });
  }

  /**
   * Resubscribe to all channels after reconnection
   */
  resubscribe() {
    this.subscriptions.forEach(({ channel, symbols }) => {
      const message = {
        event: 'subscribe',
        channel: [channel],
        symbols: symbols
      };
      
      this.ws.send(JSON.stringify(message));
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  handleMessage(message) {
    const { channel, data } = message;

    switch (channel) {
      case 'ticker':
        this.emit('ticker', data);
        break;
      
      case 'book':
        this.emit('orderbook', data);
        break;
      
      case 'trades':
        this.emit('trades', data);
        break;
      
      case 'candles_minute_1':
      case 'candles_minute_5':
      case 'candles_minute_15':
      case 'candles_minute_30':
      case 'candles_hour_1':
      case 'candles_hour_2':
      case 'candles_hour_4':
      case 'candles_hour_6':
      case 'candles_hour_12':
      case 'candles_day_1':
      case 'candles_day_3':
      case 'candles_week_1':
      case 'candles_month_1':
        this.emit('candles', { interval: channel.replace('candles_', ''), data });
        break;
      
      default:
        logger.debug('Unhandled channel:', channel);
        this.emit('message', message);
    }
  }

  /**
   * Handle incoming private WebSocket message
   */
  handlePrivateMessage(message) {
    const { channel, data } = message;

    switch (channel) {
      case 'orders':
        this.emit('order_update', data);
        break;
      
      case 'balances':
        this.emit('balance_update', data);
        break;
      
      default:
        logger.debug('Unhandled private channel:', channel);
        this.emit('private_message', message);
    }
  }

  /**
   * Subscribe to ticker updates
   */
  subscribeTicker(symbols = []) {
    this.subscribe('ticker', symbols);
  }

  /**
   * Subscribe to order book updates
   */
  subscribeOrderBook(symbols = []) {
    this.subscribe('book', symbols);
  }

  /**
   * Subscribe to trade updates
   */
  subscribeTrades(symbols = []) {
    this.subscribe('trades', symbols);
  }

  /**
   * Subscribe to candle updates
   */
  subscribeCandles(interval, symbols = []) {
    const channel = `candles_${interval}`;
    this.subscribe(channel, symbols);
  }

  /**
   * Subscribe to order updates (private)
   */
  subscribeOrders() {
    if (!this.isPrivateConnected) {
      logger.warn('Private WebSocket not connected');
      return;
    }

    const message = {
      event: 'subscribe',
      channel: ['orders']
    };

    this.wsPrivate.send(JSON.stringify(message));
  }

  /**
   * Subscribe to balance updates (private)
   */
  subscribeBalances() {
    if (!this.isPrivateConnected) {
      logger.warn('Private WebSocket not connected');
      return;
    }

    const message = {
      event: 'subscribe',
      channel: ['balances']
    };

    this.wsPrivate.send(JSON.stringify(message));
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect() {
    logger.info('Disconnecting WebSocket...');
    
    this.stopPingInterval();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    if (this.wsPrivate) {
      this.wsPrivate.close();
      this.wsPrivate = null;
    }
    
    this.isConnected = false;
    this.isPrivateConnected = false;
    this.subscriptions.clear();
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      public: {
        connected: this.isConnected,
        readyState: this.ws ? this.ws.readyState : null,
        subscriptions: Array.from(this.subscriptions).filter(s => !s.private)
      },
      private: {
        connected: this.isPrivateConnected,
        readyState: this.wsPrivate ? this.wsPrivate.readyState : null,
        authenticated: this.isPrivateConnected
      }
    };
  }
}

// Export singleton instance
const poloniexWebSocketService = new PoloniexWebSocketService();
export default poloniexWebSocketService;

// Export class for testing
export { PoloniexWebSocketService };
