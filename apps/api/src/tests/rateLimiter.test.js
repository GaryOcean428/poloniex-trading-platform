import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../utils/rateLimiter.js';

describe('RateLimiter', () => {
  let rateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter();
  });

  describe('VIP Level Management', () => {
    it('should default to VIP0', () => {
      const status = rateLimiter.getStatus();
      expect(status.vipLevel).toBe('VIP0');
    });

    it('should set VIP level correctly', () => {
      rateLimiter.setVIPLevel(5);
      const status = rateLimiter.getStatus();
      expect(status.vipLevel).toBe('VIP5');
    });

    it('should handle invalid VIP levels', () => {
      rateLimiter.setVIPLevel(15);
      const status = rateLimiter.getStatus();
      expect(status.vipLevel).toBe('VIP0');
    });

    it('should handle negative VIP levels', () => {
      rateLimiter.setVIPLevel(-1);
      const status = rateLimiter.getStatus();
      expect(status.vipLevel).toBe('VIP0');
    });
  });

  describe('Rate Limit Calculation', () => {
    it('should return correct rate limit for orders endpoint', () => {
      const limit = rateLimiter.getRateLimit('orders');
      expect(limit).toBe(50); // VIP0 default
    });

    it('should return correct rate limit for account endpoint', () => {
      const limit = rateLimiter.getRateLimit('account');
      expect(limit).toBe(50); // VIP0 default
    });

    it('should return correct rate limit for market endpoint', () => {
      const limit = rateLimiter.getRateLimit('market');
      expect(limit).toBe(200); // All VIP levels
    });

    it('should increase rate limit with higher VIP level', () => {
      rateLimiter.setVIPLevel(5);
      const limit = rateLimiter.getRateLimit('orders');
      expect(limit).toBe(150); // VIP5
    });
  });

  describe('Endpoint Type Detection', () => {
    it('should detect orders endpoint', () => {
      const type = rateLimiter.getEndpointType('/orders');
      expect(type).toBe('orders');
    });

    it('should detect account endpoint', () => {
      const type = rateLimiter.getEndpointType('/accounts/balances');
      expect(type).toBe('account');
    });

    it('should detect market endpoint', () => {
      const type = rateLimiter.getEndpointType('/markets/BTC_USDT/ticker24h');
      expect(type).toBe('market');
    });

    it('should detect futures trade endpoints as orders', () => {
      const type = rateLimiter.getEndpointType('/trade/order');
      expect(type).toBe('orders');
    });

    it('should detect futures position endpoints as orders', () => {
      const type = rateLimiter.getEndpointType('/position/leverage');
      expect(type).toBe('orders');
    });

    it('should detect futures account endpoints', () => {
      const type = rateLimiter.getEndpointType('/account/balance');
      expect(type).toBe('account');
    });

    it('should detect futures market endpoints', () => {
      const type = rateLimiter.getEndpointType('/market/orderBook');
      expect(type).toBe('market');
    });

    it('should default to market for unknown endpoints', () => {
      const type = rateLimiter.getEndpointType('/unknown/endpoint');
      expect(type).toBe('market');
    });
  });

  describe('Token Bucket', () => {
    it('should create bucket on first access', () => {
      const bucket = rateLimiter.getBucket('orders');
      expect(bucket).toBeDefined();
      expect(bucket.tokens).toBeGreaterThan(0);
      expect(bucket.maxTokens).toBeGreaterThan(0);
    });

    it('should refill tokens over time', async () => {
      const bucket = rateLimiter.getBucket('orders');
      const initialTokens = bucket.tokens;
      
      // Consume some tokens
      bucket.tokens = 0;
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Refill
      rateLimiter.refillBucket(bucket);
      
      expect(bucket.tokens).toBeGreaterThan(0);
    });

    it('should not exceed max tokens', () => {
      const bucket = rateLimiter.getBucket('orders');
      const maxTokens = bucket.maxTokens;
      
      // Try to add more tokens
      bucket.tokens = maxTokens + 100;
      rateLimiter.refillBucket(bucket);
      
      expect(bucket.tokens).toBeLessThanOrEqual(maxTokens);
    });
  });

  describe('Rate Limiting Execution', () => {
    it('should execute function immediately when tokens available', async () => {
      let executed = false;
      
      await rateLimiter.execute('/orders', async () => {
        executed = true;
      });
      
      expect(executed).toBe(true);
    });

    it('should wait when no tokens available', async () => {
      const bucket = rateLimiter.getBucket('orders');
      bucket.tokens = 0;
      
      const startTime = Date.now();
      
      await rateLimiter.execute('/orders', async () => {
        // Function body
      });
      
      const endTime = Date.now();
      const elapsed = endTime - startTime;
      
      // Should have waited at least a few milliseconds
      expect(elapsed).toBeGreaterThan(0);
    });
  });

  describe('Status Reporting', () => {
    it('should report status for all buckets', () => {
      // Create buckets by accessing them
      rateLimiter.getBucket('orders');
      rateLimiter.getBucket('account');
      rateLimiter.getBucket('market');
      
      const status = rateLimiter.getStatus();
      
      expect(status.buckets).toHaveProperty('orders');
      expect(status.buckets).toHaveProperty('account');
      expect(status.buckets).toHaveProperty('market');
    });

    it('should report available tokens', () => {
      rateLimiter.getBucket('orders');
      const status = rateLimiter.getStatus();
      
      expect(status.buckets.orders).toHaveProperty('available');
      expect(status.buckets.orders).toHaveProperty('max');
      expect(status.buckets.orders).toHaveProperty('percentage');
    });
  });

  describe('Reset', () => {
    it('should clear all buckets', () => {
      rateLimiter.getBucket('orders');
      rateLimiter.getBucket('account');
      
      rateLimiter.reset();
      
      const status = rateLimiter.getStatus();
      expect(Object.keys(status.buckets).length).toBe(0);
    });
  });
});
