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
    // Market data endpoints (public)
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
        if (endpoint.includes('/orders') || endpoint.includes('/smartorders')) {
            return 'orders';
        }
        if (endpoint.includes('/accounts') ||
            endpoint.includes('/wallets') ||
            endpoint.includes('/margin') ||
            endpoint.includes('/subaccounts') ||
            endpoint.includes('/feeinfo')) {
            return 'account';
        }
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
        // Refill tokens based on time passed
        this.refillBucket(bucket);
        // If we have tokens, consume one and proceed
        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return;
        }
        // Calculate wait time until next token
        const waitTime = (1 / bucket.refillRate) * 1000; // milliseconds
        logger.debug('Rate limit reached, waiting for token', {
            endpointType,
            waitTime,
            vipLevel: this.vipLevel
        });
        // Wait for next token
        await new Promise(resolve => setTimeout(resolve, waitTime));
        // Refill and consume token
        this.refillBucket(bucket);
        bucket.tokens -= 1;
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
