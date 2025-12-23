import { describe, it, expect, beforeEach, vi } from 'vitest';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import axios from 'axios';

// Mock axios
vi.mock('axios');

// Mock rateLimiter
vi.mock('../utils/rateLimiter.js', () => ({
  default: {
    execute: vi.fn((endpoint, fn) => fn()),
    setVIPLevel: vi.fn(),
    getStatus: vi.fn()
  }
}));

describe('PoloniexFuturesService', () => {
  const mockCredentials = {
    apiKey: 'test_api_key',
    apiSecret: 'test_api_secret'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Signature Generation', () => {
    it('should generate correct signature for GET request with params', () => {
      const method = 'GET';
      const requestPath = '/v3/account/balance';
      const params = { currency: 'USDT' };
      const body = null;
      const timestamp = '1234567890';
      const secret = 'test_secret';

      const signature = poloniexFuturesService.generateSignature(
        method,
        requestPath,
        params,
        body,
        timestamp,
        secret
      );

      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
    });

    it('should generate correct signature for POST request with body', () => {
      const method = 'POST';
      const requestPath = '/v3/trade/order';
      const params = {};
      const body = { symbol: 'BTC_USDT_PERP', side: 'BUY', type: 'LIMIT', size: 1, price: 50000 };
      const timestamp = '1234567890';
      const secret = 'test_secret';

      const signature = poloniexFuturesService.generateSignature(
        method,
        requestPath,
        params,
        body,
        timestamp,
        secret
      );

      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
    });

    it('should generate different signatures for different parameters', () => {
      const method = 'GET';
      const requestPath = '/v3/account/balance';
      const timestamp = '1234567890';
      const secret = 'test_secret';

      const sig1 = poloniexFuturesService.generateSignature(
        method,
        requestPath,
        { currency: 'USDT' },
        null,
        timestamp,
        secret
      );

      const sig2 = poloniexFuturesService.generateSignature(
        method,
        requestPath,
        { currency: 'BTC' },
        null,
        timestamp,
        secret
      );

      expect(sig1).not.toBe(sig2);
    });

    it('should generate signature with only timestamp for no params', () => {
      const method = 'DELETE';
      const requestPath = '/v3/trade/order';
      const params = {};
      const body = null;
      const timestamp = '1234567890';
      const secret = 'test_secret';

      const signature = poloniexFuturesService.generateSignature(
        method,
        requestPath,
        params,
        body,
        timestamp,
        secret
      );

      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
    });
  });

  describe('Market Data Methods', () => {
    beforeEach(() => {
      axios.mockResolvedValue({
        data: {
          code: 200,
          data: { mockData: 'test' },
          msg: 'Success'
        }
      });
    });

    it('should fetch products successfully', async () => {
      const result = await poloniexFuturesService.getProducts();
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });

    it('should fetch product by symbol', async () => {
      const symbol = 'BTC_USDT_PERP';
      const result = await poloniexFuturesService.getProduct(symbol);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });

    it('should fetch tickers', async () => {
      const result = await poloniexFuturesService.getTickers();
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });

    it('should fetch order book', async () => {
      const symbol = 'BTC_USDT_PERP';
      const depth = 20;
      const result = await poloniexFuturesService.getOrderBook(symbol, depth);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });

    it('should fetch mark price', async () => {
      const symbol = 'BTC_USDT_PERP';
      const result = await poloniexFuturesService.getMarkPrice(symbol);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });

    it('should fetch index price', async () => {
      const symbol = 'BTC_USDT_PERP';
      const result = await poloniexFuturesService.getIndexPrice(symbol);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });

    it('should fetch funding rate', async () => {
      const symbol = 'BTC_USDT_PERP';
      const result = await poloniexFuturesService.getFundingRate(symbol);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });

    it('should fetch funding rate history', async () => {
      const symbol = 'BTC_USDT_PERP';
      const params = { from: 1234567890, to: 1234567900 };
      const result = await poloniexFuturesService.getFundingRateHistory(symbol, params);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });

    it('should fetch open interest', async () => {
      const symbol = 'BTC_USDT_PERP';
      const result = await poloniexFuturesService.getOpenInterest(symbol);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      axios.mockRejectedValue(new Error('Network error'));

      await expect(poloniexFuturesService.getProducts()).rejects.toThrow('Network error');
    });

    it('should handle API errors', async () => {
      axios.mockRejectedValue({
        response: {
          status: 400,
          data: { code: 400, msg: 'Invalid request' }
        }
      });

      await expect(poloniexFuturesService.getProducts()).rejects.toBeDefined();
    });

    it('should handle authentication errors', async () => {
      axios.mockRejectedValue({
        response: {
          status: 401,
          data: { code: 401, msg: 'Authentication failed' }
        }
      });

      await expect(
        poloniexFuturesService.getAccountBalance(mockCredentials)
      ).rejects.toBeDefined();
    });

    it('should handle rate limit errors', async () => {
      axios.mockRejectedValue({
        response: {
          status: 429,
          data: { code: 429, msg: 'Rate limit exceeded' }
        }
      });

      await expect(poloniexFuturesService.getProducts()).rejects.toBeDefined();
    });
  });

  describe('Health Check', () => {
    it('should return healthy status when API is accessible', async () => {
      axios.mockResolvedValue({
        data: {
          code: 200,
          data: [],
          msg: 'Success'
        }
      });

      const health = await poloniexFuturesService.healthCheck();
      expect(health).toBeDefined();
      expect(health.status).toBe('healthy');
    });

    it('should return unhealthy status when API is down', async () => {
      axios.mockRejectedValue(new Error('API not available'));

      const health = await poloniexFuturesService.healthCheck();
      expect(health).toBeDefined();
      expect(health.status).toBe('unhealthy');
    });
  });

  describe('Trading Operations', () => {
    beforeEach(() => {
      axios.mockResolvedValue({
        data: {
          code: 200,
          data: { orderId: '12345' },
          msg: 'Success'
        }
      });
    });

    it('should place order successfully', async () => {
      const orderData = {
        symbol: 'BTC_USDT_PERP',
        side: 'BUY',
        type: 'LIMIT',
        size: 1,
        price: 50000
      };

      const result = await poloniexFuturesService.placeOrder(mockCredentials, orderData);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });

    it('should cancel order successfully', async () => {
      const orderId = '12345';
      const result = await poloniexFuturesService.cancelOrder(mockCredentials, orderId);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });

    it('should get current orders', async () => {
      const symbol = 'BTC_USDT_PERP';
      const result = await poloniexFuturesService.getCurrentOrders(mockCredentials, symbol);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });
  });

  describe('Position Management', () => {
    beforeEach(() => {
      axios.mockResolvedValue({
        data: {
          code: 200,
          data: [{ symbol: 'BTC_USDT_PERP', size: 1 }],
          msg: 'Success'
        }
      });
    });

    it('should get positions successfully', async () => {
      const result = await poloniexFuturesService.getPositions(mockCredentials);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });

    it('should set leverage successfully', async () => {
      const symbol = 'BTC_USDT_PERP';
      const leverage = 10;
      const result = await poloniexFuturesService.setLeverage(mockCredentials, symbol, leverage);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });

    it('should adjust margin successfully', async () => {
      const symbol = 'BTC_USDT_PERP';
      const amount = 100;
      const type = 'add';
      const result = await poloniexFuturesService.adjustMargin(mockCredentials, symbol, amount, type);
      expect(result).toBeDefined();
      expect(axios).toHaveBeenCalled();
    });
  });
});
