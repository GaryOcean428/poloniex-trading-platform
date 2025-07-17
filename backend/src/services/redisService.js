import { createClient } from 'redis';
import { logger } from '../utils/logger.js';

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    if (this.client) return this.client;

    try {
      // Skip Redis connection if no Redis URL is configured
      if (!process.env.REDIS_URL && !process.env.REDIS_PUBLIC_URL) {
        logger.info('ℹ️ Redis not configured - running without Redis cache');
        return null;
      }

      // Use Railway's Redis Stack configuration - use public URL for local development
      const redisUrl = process.env.REDIS_PUBLIC_URL ||
                      process.env.REDIS_URL;

      this.client = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            // Limit reconnection attempts to prevent spam
            if (retries > 10) return false;
            return Math.min(retries * 50, 500);
          }
        }
      });

      this.client.on('error', (err) => {
        logger.error('Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('✅ Redis connected successfully');
        this.isConnected = true;
      });

      this.client.on('reconnecting', () => {
        logger.info('🔄 Redis reconnecting...');
      });

      await this.client.connect();
      return this.client;
    } catch (error) {
      logger.error('❌ Failed to connect to Redis:', error);
      logger.info('ℹ️ Continuing without Redis cache');
      this.client = null;
      return null;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
      this.isConnected = false;
      logger.info('🔌 Redis disconnected');
    }
  }

  async set(key, value, ttl = null) {
    try {
      if (!this.client) await this.connect();

      const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;

      if (ttl) {
        await this.client.setEx(key, ttl, serializedValue);
      } else {
        await this.client.set(key, serializedValue);
      }

      logger.debug(`✅ Redis SET: ${key}`);
    } catch (error) {
      logger.error(`❌ Redis SET error for ${key}:`, error);
      throw error;
    }
  }

  async get(key) {
    try {
      if (!this.client) await this.connect();

      const value = await this.client.get(key);
      if (!value) return null;

      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      logger.error(`❌ Redis GET error for ${key}:`, error);
      return null;
    }
  }

  async del(key) {
    try {
      if (!this.client) await this.connect();

      const result = await this.client.del(key);
      logger.debug(`🗑️ Redis DEL: ${key}`);
      return result;
    } catch (error) {
      logger.error(`❌ Redis DEL error for ${key}:`, error);
      return 0;
    }
  }

  async exists(key) {
    try {
      if (!this.client) await this.connect();

      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`❌ Redis EXISTS error for ${key}:`, error);
      return false;
    }
  }

  async expire(key, ttl) {
    try {
      if (!this.client) await this.connect();
      
      // If Redis is not available, return a mock value
      if (!this.client) {
        logger.debug(`⏰ Redis EXPIRE (mock): ${key} (${ttl}s)`);
        return true;
      }

      const result = await this.client.expire(key, ttl);
      logger.debug(`⏰ Redis EXPIRE: ${key} (${ttl}s)`);
      return result;
    } catch (error) {
      logger.error(`❌ Redis EXPIRE error for ${key}:`, error);
      return false;
    }
  }

  async incr(key) {
    try {
      if (!this.client) await this.connect();
      
      // If Redis is not available, return a mock value
      if (!this.client) {
        logger.debug(`➕ Redis INCR (mock): ${key} = 1`);
        return 1;
      }

      const result = await this.client.incr(key);
      logger.debug(`➕ Redis INCR: ${key} = ${result}`);
      return result;
    } catch (error) {
      logger.error(`❌ Redis INCR error for ${key}:`, error);
      throw error;
    }
  }

  async decr(key) {
    try {
      if (!this.client) await this.connect();

      const result = await this.client.decr(key);
      logger.debug(`➖ Redis DECR: ${key} = ${result}`);
      return result;
    } catch (error) {
      logger.error(`❌ Redis DECR error for ${key}:`, error);
      throw error;
    }
  }

  // Rate limiting utility
  async checkRateLimit(key, limit, window = 3600) {
    try {
      const count = await this.incr(`rate_limit:${key}`);

      if (count === 1) {
        await this.expire(`rate_limit:${key}`, window);
      }

      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        resetTime: Date.now() + (window * 1000)
      };
    } catch (error) {
      logger.error(`❌ Rate limiting error for ${key}:`, error);
      return { allowed: true, remaining: limit, resetTime: Date.now() + (window * 1000) };
    }
  }

  // Cache management
  async cacheGet(key, fetchFunction, ttl = 300) {
    try {
      const cached = await this.get(`cache:${key}`);
      if (cached) {
        logger.debug(`🎯 Cache HIT: ${key}`);
        return cached;
      }

      logger.debug(`❌ Cache MISS: ${key}`);
      const freshData = await fetchFunction();
      await this.set(`cache:${key}`, freshData, ttl);

      return freshData;
    } catch (error) {
      logger.error(`❌ Cache error for ${key}:`, error);
      return fetchFunction();
    }
  }

  // Session management
  async createSession(sessionId, data, ttl = 3600) {
    return this.set(`session:${sessionId}`, data, ttl);
  }

  async getSession(sessionId) {
    return this.get(`session:${sessionId}`);
  }

  async deleteSession(sessionId) {
    return this.del(`session:${sessionId}`);
  }

  // Health check
  async healthCheck() {
    try {
      if (!this.client) await this.connect();

      await this.client.ping();
      const info = await this.client.info();

      return {
        healthy: true,
        connected: this.isConnected,
        version: info.split('\r\n').find(line => line.startsWith('redis_version'))?.split(':')[1] || 'unknown'
      };
    } catch (error) {
      return {
        healthy: false,
        connected: false,
        error: error.message
      };
    }
  }
}

// Create singleton instance
const redisService = new RedisService();

// Export both instance and class
export { RedisService };
export default redisService;
