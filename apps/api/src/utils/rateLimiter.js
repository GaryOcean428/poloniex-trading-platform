import { logger } from './logger.js';

/**
 * Rate Limiter for Poloniex API
 * Implements token bucket algorithm with VIP level support
 * Based on: https://api-docs.poloniex.com/spot/api/#rate-limits
 */

// Rate limits per VIP level (requests per second)
const RATE_LIMITS = {
  // Order endpoints
  orders: {
    VIP0: 50,
    VIP1: 75,
    VIP2: 75,
    VIP3: 100,
    VIP4: 100,
    VIP5: 150,
    VIP6: 150,
    VIP7: 200,
    VIP8: 200,
    VIP9: 200
  },
  // Account endpoints
  account: {
    VIP0: 50,
    VIP1: 75,
    VIP2: 75,
    VIP3: 100,
    VIP4: 100,
    VIP5: 150,
    VIP6: 150,
    VIP7: 200,
    VIP8: 200,
    VIP9: 200
  },
  // Market data endpoints (public). Poloniex v3 futures: most market
  // endpoints are 300 req/s per IP — 200 is a safe margin. Limited per
  // IP, not per VIP, so the numbers are flat across levels.
  market: {
    VIP0: 200,
    VIP1: 200,
    VIP2: 200,
    VIP3: 200,
    VIP4: 200,
    VIP5: 200,
    VIP6: 200,
    VIP7: 200,
    VIP8: 200,
    VIP9: 200
  },
  // K-line / candlestick endpoints. Poloniex v3 futures caps
  // /v3/market/candles at 20 req/s per IP — far tighter than the 300/s
  // of other market data. Bucketing it with `market` (200/s) let the
  // MTF-bootstrap candle burst (≈18 calls across 2 kernel instances at
  // startup) sail straight through with no throttling → HTTP 429 on
  // getHistoricalData. 15/s leaves headroom under the real 20/s limit.
  candles: {
    VIP0: 15,
    VIP1: 15,
    VIP2: 15,
    VIP3: 15,
    VIP4: 15,
    VIP5: 15,
    VIP6: 15,
    VIP7: 15,
    VIP8: 15,
    VIP9: 15
  }
};

class RateLimiter {
  constructor() {
    // Token buckets for each endpoint type
    this.buckets = new Map();
    
    // Default VIP level
    this.vipLevel = 'VIP0';
    
    // Request queue for when rate limit is reached
    this.queue = [];
    
    // Processing queue flag
    this.processingQueue = false;
  }

  /**
   * Set VIP level for rate limiting
   * @param {number} level - VIP level (0-9)
   */
  setVIPLevel(level) {
    if (level < 0 || level > 9) {
      logger.warn('Invalid VIP level, using VIP0', { level });
      this.vipLevel = 'VIP0';
      return;
    }
    
    this.vipLevel = `VIP${level}`;
    logger.info('VIP level set for rate limiting', { vipLevel: this.vipLevel });
    
    // Reset buckets with new limits
    this.buckets.clear();
  }

  /**
   * Get rate limit for endpoint type
   * @param {string} endpointType - orders, account, or market
   * @returns {number} - Requests per second
   */
  getRateLimit(endpointType) {
    const limits = RATE_LIMITS[endpointType];
    if (!limits) {
      logger.warn('Unknown endpoint type, using market limits', { endpointType });
      return RATE_LIMITS.market[this.vipLevel];
    }
    
    return limits[this.vipLevel];
  }

  /**
   * Get or create token bucket for endpoint type
   * @param {string} endpointType - orders, account, or market
   * @returns {Object} - Token bucket
   */
  getBucket(endpointType) {
    if (!this.buckets.has(endpointType)) {
      const limit = this.getRateLimit(endpointType);
      
      this.buckets.set(endpointType, {
        tokens: limit,
        maxTokens: limit,
        lastRefill: Date.now(),
        refillRate: limit // tokens per second
      });
    }
    
    return this.buckets.get(endpointType);
  }

  /**
   * Refill tokens in bucket
   * @param {Object} bucket - Token bucket
   */
  refillBucket(bucket) {
    const now = Date.now();
    const timePassed = (now - bucket.lastRefill) / 1000; // seconds
    
    // Calculate tokens to add
    const tokensToAdd = timePassed * bucket.refillRate;
    
    // Add tokens, but don't exceed max
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  /**
   * Determine endpoint type from path
   * @param {string} endpoint - API endpoint path
   * @returns {string} - Endpoint type
   */
  getEndpointType(endpoint) {
    // K-line / candlestick endpoints have a much tighter per-IP cap
    // (20 req/s on v3 futures vs 300 for other market data) — must be
    // its own bucket or a candle burst blows the limit → 429. Checked
    // before the generic market fallthrough.
    if (endpoint.includes('/market/candles') ||
        endpoint.includes('/market/get-kline') ||
        endpoint.includes('Candlesticks')) {
      return 'candles';
    }

    // Futures trading and position endpoints
    if (endpoint.includes('/trade/') || endpoint.includes('/position/')) {
      return 'orders';
    }
    
    // Spot trading endpoints
    if (endpoint.includes('/orders') || endpoint.includes('/smartorders')) {
      return 'orders';
    }
    
    // Account endpoints (both spot and futures)
    if (endpoint.includes('/account') || 
        endpoint.includes('/wallets') || 
        endpoint.includes('/margin') ||
        endpoint.includes('/subaccounts') ||
        endpoint.includes('/feeinfo')) {
      return 'account';
    }
    
    // Everything else is market data (default)
    return 'market';
  }

  /**
   * Wait for token availability
   * @param {string} endpoint - API endpoint
   * @returns {Promise<void>}
   */
  async waitForToken(endpoint) {
    const endpointType = this.getEndpointType(endpoint);
    const bucket = this.getBucket(endpointType);

    // Loop until a token is actually available. The previous version
    // waited ONCE then unconditionally consumed — so N concurrent
    // waiters (e.g. the MTF-bootstrap candle burst) would all wake at
    // the same tick, each see the single refilled token, and each
    // decrement, driving `tokens` deep negative and defeating the
    // throttle. Re-checking in a loop makes the bucket actually bound
    // the request rate under concurrency.
    for (;;) {
      this.refillBucket(bucket);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return;
      }
      // Wait long enough for the bucket to climb back to >= 1 token.
      // (1 - tokens) handles a negative balance left by older callers.
      const deficit = 1 - bucket.tokens;
      const waitTime = Math.max((deficit / bucket.refillRate) * 1000, 5);
      logger.debug('Rate limit reached, waiting for token', {
        endpointType,
        waitTime,
        tokens: bucket.tokens,
        vipLevel: this.vipLevel
      });
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  /**
   * Execute function with rate limiting
   * @param {string} endpoint - API endpoint
   * @param {Function} fn - Function to execute
   * @returns {Promise<any>} - Function result
   */
  async execute(endpoint, fn) {
    await this.waitForToken(endpoint);
    return fn();
  }

  /**
   * Get current rate limit status
   * @returns {Object} - Rate limit status for all endpoint types
   */
  getStatus() {
    const status = {};
    
    for (const [type, bucket] of this.buckets.entries()) {
      this.refillBucket(bucket);
      
      status[type] = {
        available: Math.floor(bucket.tokens),
        max: bucket.maxTokens,
        percentage: Math.floor((bucket.tokens / bucket.maxTokens) * 100)
      };
    }
    
    return {
      vipLevel: this.vipLevel,
      buckets: status
    };
  }

  /**
   * Reset all rate limiters
   */
  reset() {
    this.buckets.clear();
    logger.info('Rate limiters reset');
  }
}

// Export singleton instance
const rateLimiter = new RateLimiter();
export default rateLimiter;

// Export class for testing
export { RateLimiter };
