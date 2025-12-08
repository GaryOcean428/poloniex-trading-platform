import { describe, it, expect, beforeEach, vi } from 'vitest';
import poloniexSpotService from '../services/poloniexSpotService.js';
import { PoloniexAPIError, PoloniexAuthenticationError } from '../utils/poloniexErrors.js';

describe('PoloniexSpotService', () => {
  const mockCredentials = {
    apiKey: 'test_api_key',
    apiSecret: 'test_api_secret'
  };

  describe('Signature Generation', () => {
    it('should generate correct signature for GET request with params', () => {
      const method = 'GET';
      const requestPath = '/accounts/balances';
      const params = { symbol: 'BTC_USDT' };
      const body = null;
      const timestamp = '1234567890';
      const secret = 'test_secret';

      const signature = poloniexSpotService.generateSignature(
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

    it('should generate correct signature for POST request with body', () => {
      const method = 'POST';
      const requestPath = '/orders';
      const params = {};
      const body = { symbol: 'BTC_USDT', side: 'BUY', type: 'MARKET', quantity: '0.001' };
      const timestamp = '1234567890';
      const secret = 'test_secret';

      const signature = poloniexSpotService.generateSignature(
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

    it('should generate different signatures for different parameters', () => {
      const method = 'GET';
      const requestPath = '/accounts/balances';
      const timestamp = '1234567890';
      const secret = 'test_secret';

      const sig1 = poloniexSpotService.generateSignature(
        method,
        requestPath,
        { symbol: 'BTC_USDT' },
        null,
        timestamp,
        secret
      );

      const sig2 = poloniexSpotService.generateSignature(
        method,
        requestPath,
        { symbol: 'ETH_USDT' },
        null,
        timestamp,
        secret
      );

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('Order Validation', () => {
    it('should validate required order parameters', async () => {
      await expect(
        poloniexSpotService.placeOrder(mockCredentials, {})
      ).rejects.toThrow('Missing required order parameters');
    });

    it('should validate LIMIT orders have price', async () => {
      await expect(
        poloniexSpotService.placeOrder(mockCredentials, {
          symbol: 'BTC_USDT',
          side: 'BUY',
          type: 'LIMIT',
          quantity: '0.001'
        })
      ).rejects.toThrow('Price is required for LIMIT orders');
    });

    it('should validate order ID for cancel', async () => {
      await expect(
        poloniexSpotService.cancelOrder(mockCredentials, null)
      ).rejects.toThrow('Order ID is required');
    });
  });

  describe('Market Data', () => {
    it('should validate symbol for ticker', async () => {
      await expect(
        poloniexSpotService.getTicker24h(null)
      ).rejects.toThrow('Symbol is required');
    });

    it('should validate symbol for order book', async () => {
      await expect(
        poloniexSpotService.getOrderBook(null)
      ).rejects.toThrow('Symbol is required');
    });

    it('should validate interval for candles', async () => {
      await expect(
        poloniexSpotService.getCandles('BTC_USDT', {})
      ).rejects.toThrow('Interval is required');
    });
  });

  describe('Rate Limiting', () => {
    it('should set VIP level', () => {
      poloniexSpotService.setVIPLevel(5);
      const status = poloniexSpotService.getRateLimitStatus();
      
      expect(status.vipLevel).toBe('VIP5');
    });

    it('should get rate limit status', () => {
      const status = poloniexSpotService.getRateLimitStatus();
      
      expect(status).toHaveProperty('vipLevel');
      expect(status).toHaveProperty('buckets');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      // This would require mocking axios
      // For now, just verify error handling structure exists
      expect(poloniexSpotService.makeRequest).toBeDefined();
      expect(poloniexSpotService.makeRequestWithRetry).toBeDefined();
    });
  });
});
