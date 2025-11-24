import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PoloniexWebSocketService } from '../services/poloniexWebSocket.js';
import { EventEmitter } from 'events';

describe('PoloniexWebSocketService', () => {
  let wsService;

  beforeEach(() => {
    wsService = new PoloniexWebSocketService();
  });

  afterEach(() => {
    if (wsService) {
      wsService.disconnect();
    }
  });

  describe('Initialization', () => {
    it('should be an instance of EventEmitter', () => {
      expect(wsService).toBeInstanceOf(EventEmitter);
    });

    it('should have correct WebSocket URLs', () => {
      expect(wsService.wsUrl).toBe('wss://ws.poloniex.com/ws/public');
      expect(wsService.wsPrivateUrl).toBe('wss://ws.poloniex.com/ws/private');
    });

    it('should start with disconnected state', () => {
      expect(wsService.isConnected).toBe(false);
      expect(wsService.isPrivateConnected).toBe(false);
    });
  });

  describe('Signature Generation', () => {
    it('should generate signature for authentication', () => {
      const timestamp = Date.now();
      const secret = 'test_secret';
      
      const signature = wsService.generateSignature(timestamp, secret);
      
      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
    });

    it('should generate different signatures for different timestamps', () => {
      const secret = 'test_secret';
      const timestamp1 = Date.now();
      const timestamp2 = timestamp1 + 1000;
      
      const sig1 = wsService.generateSignature(timestamp1, secret);
      const sig2 = wsService.generateSignature(timestamp2, secret);
      
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('Subscription Management', () => {
    it('should add subscription to queue when not connected', () => {
      wsService.subscribe('ticker', ['BTC_USDT']);
      
      expect(wsService.subscriptions.size).toBeGreaterThan(0);
    });

    it('should track multiple subscriptions', () => {
      wsService.subscribe('ticker', ['BTC_USDT']);
      wsService.subscribe('book', ['ETH_USDT']);
      
      expect(wsService.subscriptions.size).toBe(2);
    });
  });

  describe('Channel Subscriptions', () => {
    it('should subscribe to ticker', () => {
      const spy = vi.spyOn(wsService, 'subscribe');
      
      wsService.subscribeTicker(['BTC_USDT']);
      
      expect(spy).toHaveBeenCalledWith('ticker', ['BTC_USDT']);
    });

    it('should subscribe to order book', () => {
      const spy = vi.spyOn(wsService, 'subscribe');
      
      wsService.subscribeOrderBook(['BTC_USDT']);
      
      expect(spy).toHaveBeenCalledWith('book', ['BTC_USDT']);
    });

    it('should subscribe to trades', () => {
      const spy = vi.spyOn(wsService, 'subscribe');
      
      wsService.subscribeTrades(['BTC_USDT']);
      
      expect(spy).toHaveBeenCalledWith('trades', ['BTC_USDT']);
    });

    it('should subscribe to candles with interval', () => {
      const spy = vi.spyOn(wsService, 'subscribe');
      
      wsService.subscribeCandles('minute_1', ['BTC_USDT']);
      
      expect(spy).toHaveBeenCalledWith('candles_minute_1', ['BTC_USDT']);
    });
  });

  describe('Message Handling', () => {
    it('should emit ticker event for ticker messages', () => {
      const tickerData = { symbol: 'BTC_USDT', price: '50000' };
      const message = { channel: 'ticker', data: tickerData };
      
      let emittedData;
      wsService.on('ticker', (data) => {
        emittedData = data;
      });
      
      wsService.handleMessage(message);
      
      expect(emittedData).toEqual(tickerData);
    });

    it('should emit orderbook event for book messages', () => {
      const bookData = { symbol: 'BTC_USDT', bids: [], asks: [] };
      const message = { channel: 'book', data: bookData };
      
      let emittedData;
      wsService.on('orderbook', (data) => {
        emittedData = data;
      });
      
      wsService.handleMessage(message);
      
      expect(emittedData).toEqual(bookData);
    });

    it('should emit trades event for trades messages', () => {
      const tradesData = [{ price: '50000', size: '0.1' }];
      const message = { channel: 'trades', data: tradesData };
      
      let emittedData;
      wsService.on('trades', (data) => {
        emittedData = data;
      });
      
      wsService.handleMessage(message);
      
      expect(emittedData).toEqual(tradesData);
    });

    it('should emit candles event for candle messages', () => {
      const candleData = { open: '50000', close: '51000' };
      const message = { channel: 'candles_minute_1', data: candleData };
      
      let emittedData;
      wsService.on('candles', (data) => {
        emittedData = data;
      });
      
      wsService.handleMessage(message);
      
      expect(emittedData.interval).toBe('minute_1');
      expect(emittedData.data).toEqual(candleData);
    });
  });

  describe('Private Message Handling', () => {
    it('should emit order_update for orders channel', () => {
      const orderData = { orderId: '123', status: 'filled' };
      const message = { channel: 'orders', data: orderData };
      
      let emittedData;
      wsService.on('order_update', (data) => {
        emittedData = data;
      });
      
      wsService.handlePrivateMessage(message);
      
      expect(emittedData).toEqual(orderData);
    });

    it('should emit balance_update for balances channel', () => {
      const balanceData = { currency: 'USDT', available: '1000' };
      const message = { channel: 'balances', data: balanceData };
      
      let emittedData;
      wsService.on('balance_update', (data) => {
        emittedData = data;
      });
      
      wsService.handlePrivateMessage(message);
      
      expect(emittedData).toEqual(balanceData);
    });
  });

  describe('Status', () => {
    it('should return connection status', () => {
      const status = wsService.getStatus();
      
      expect(status).toHaveProperty('public');
      expect(status).toHaveProperty('private');
      expect(status.public).toHaveProperty('connected');
      expect(status.private).toHaveProperty('connected');
    });

    it('should reflect disconnected state initially', () => {
      const status = wsService.getStatus();
      
      expect(status.public.connected).toBe(false);
      expect(status.private.connected).toBe(false);
    });
  });

  describe('Reconnection', () => {
    it('should have reconnection parameters', () => {
      expect(wsService.reconnectDelay).toBe(1000);
      expect(wsService.maxReconnectDelay).toBe(30000);
      expect(wsService.reconnectAttempts).toBe(0);
    });
  });

  describe('Cleanup', () => {
    it('should clear subscriptions on disconnect', () => {
      wsService.subscribe('ticker', ['BTC_USDT']);
      
      wsService.disconnect();
      
      expect(wsService.subscriptions.size).toBe(0);
    });

    it('should set connected flags to false on disconnect', () => {
      wsService.disconnect();
      
      expect(wsService.isConnected).toBe(false);
      expect(wsService.isPrivateConnected).toBe(false);
    });
  });
});
