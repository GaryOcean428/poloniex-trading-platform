import redisService from '../services/redisService.js';
import { logger } from '../utils/logger.js';
export class RedisRateLimiter {
    constructor(options = {}) {
        this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes
        this.max = options.max || 100; // requests per window
        this.keyGenerator = options.keyGenerator || this.defaultKeyGenerator;
    }
    defaultKeyGenerator(req) {
        // Use IP address as default key
        return `rate_limit:${req.ip || req.connection?.remoteAddress || 'unknown'}`;
    }
    middleware() {
        return async (req, res, next) => {
            try {
                const key = this.keyGenerator(req);
                const result = await redisService.checkRateLimit(key, this.max, Math.floor(this.windowMs / 1000));
                // Set rate limit headers
                res.set({
                    'X-RateLimit-Limit': this.max,
                    'X-RateLimit-Remaining': result.remaining,
                    'X-RateLimit-Reset': result.resetTime
                });
                if (!result.allowed) {
                    res.status(429).json({
                        error: 'Too many requests',
                        message: `Rate limit exceeded. Try again in ${Math.ceil((result.resetTime - Date.now()) / 1000)} seconds.`,
                        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
                    });
                    return;
                }
                next();
            }
            catch (error) {
                // If Redis is down, allow the request but log the error
                logger.warn('Rate limiting disabled due to Redis error', { error: error.message, stack: error.stack });
                next();
            }
        };
    }
}
// Socket.IO rate limiting
export class SocketIORateLimiter {
    constructor(options = {}) {
        this.maxEventsPerMinute = options.maxEventsPerMinute || 30;
    }
    async check(socketId, eventType) {
        const key = `socket_rate:${socketId}:${eventType}`;
        return await redisService.checkRateLimit(key, this.maxEventsPerMinute, 60);
    }
}
