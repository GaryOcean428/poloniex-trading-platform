/**
 * Resilient Database Connection with Retry Logic
 *
 * This module provides a robust database connection that handles:
 * - Connection resets (ECONNRESET)
 * - Connection timeouts
 * - Automatic retry with exponential backoff
 * - Connection pool health monitoring
 * - Circuit breaker pattern
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
dotenv.config();
const { Pool } = pg;
// Configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 10000; // 10 seconds
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
class ResilientDatabaseConnection {
    constructor() {
        this.pool = null;
        this.isHealthy = false;
        this.retryCount = 0;
        this.circuitBreakerOpen = false;
        this.circuitBreakerResetTime = null;
        this.healthCheckInterval = null;
        this.initializePool();
        this.startHealthCheck();
    }
    initializePool() {
        const config = {
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            // Connection pool settings optimized for Railway
            max: 10, // Reduced from 20 to prevent exhaustion
            min: 2, // Keep minimum connections alive
            // Timeout settings
            idleTimeoutMillis: 30000, // Close idle connections after 30s
            connectionTimeoutMillis: 10000, // Wait 10s for new connection
            // Keep-alive settings to prevent connection resets
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000,
            // Statement timeout
            statement_timeout: 30000, // 30 second query timeout
            // Query timeout
            query_timeout: 30000,
            // Application name for debugging
            application_name: 'poloniex-trading-platform'
        };
        this.pool = new Pool(config);
        // Connection event handlers
        this.pool.on('connect', (client) => {
            logger.info('New database client connected', {
                totalCount: this.pool.totalCount,
                idleCount: this.pool.idleCount,
                waitingCount: this.pool.waitingCount
            });
            this.isHealthy = true;
            this.retryCount = 0;
            this.circuitBreakerOpen = false;
        });
        this.pool.on('acquire', (client) => {
            logger.debug('Client acquired from pool', {
                totalCount: this.pool.totalCount,
                idleCount: this.pool.idleCount,
                waitingCount: this.pool.waitingCount
            });
        });
        this.pool.on('remove', (client) => {
            logger.info('Client removed from pool', {
                totalCount: this.pool.totalCount,
                idleCount: this.pool.idleCount,
                waitingCount: this.pool.waitingCount
            });
        });
        this.pool.on('error', (err, client) => {
            logger.error('Unexpected database pool error', {
                error: err.message,
                code: err.code,
                stack: err.stack
            });
            this.isHealthy = false;
            // Handle specific error codes
            if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') {
                logger.warn('Database connection lost - will retry on next query');
            }
        });
    }
    /**
     * Execute a query with automatic retry logic
     */
    async query(text, params, options = {}) {
        const maxRetries = options.maxRetries || MAX_RETRIES;
        const retryDelay = options.retryDelay || INITIAL_RETRY_DELAY;
        // Check circuit breaker
        if (this.circuitBreakerOpen) {
            const now = Date.now();
            if (now < this.circuitBreakerResetTime) {
                const waitTime = Math.ceil((this.circuitBreakerResetTime - now) / 1000);
                throw new Error(`Circuit breaker open - database unavailable. Retry in ${waitTime}s`);
            }
            else {
                // Reset circuit breaker
                logger.info('Circuit breaker reset - attempting database connection');
                this.circuitBreakerOpen = false;
                this.circuitBreakerResetTime = null;
            }
        }
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Get client from pool
                const client = await this.pool.connect();
                try {
                    // Execute query
                    const result = await client.query(text, params);
                    // Success - reset retry count
                    this.retryCount = 0;
                    this.isHealthy = true;
                    return result;
                }
                finally {
                    // Always release client back to pool
                    client.release();
                }
            }
            catch (error) {
                lastError = error;
                this.retryCount++;
                logger.warn(`Database query failed (attempt ${attempt + 1}/${maxRetries + 1})`, {
                    error: error.message,
                    code: error.code,
                    query: text.substring(0, 100)
                });
                // Check if error is retryable
                const isRetryable = this.isRetryableError(error);
                if (!isRetryable || attempt === maxRetries) {
                    // Non-retryable error or max retries reached
                    if (this.retryCount >= maxRetries) {
                        // Open circuit breaker
                        this.circuitBreakerOpen = true;
                        this.circuitBreakerResetTime = Date.now() + 60000; // 1 minute
                        logger.error('Circuit breaker opened - too many database failures');
                    }
                    throw error;
                }
                // Calculate exponential backoff delay
                const delay = Math.min(retryDelay * Math.pow(2, attempt), MAX_RETRY_DELAY);
                logger.info(`Retrying in ${delay}ms...`);
                await this.sleep(delay);
            }
        }
        throw lastError;
    }
    /**
     * Check if an error is retryable
     */
    isRetryableError(error) {
        const retryableCodes = [
            'ECONNRESET',
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENOTFOUND',
            'ENETUNREACH',
            'EAI_AGAIN',
            '57P01', // PostgreSQL: admin_shutdown
            '57P02', // PostgreSQL: crash_shutdown
            '57P03', // PostgreSQL: cannot_connect_now
            '58000', // PostgreSQL: system_error
            '58030', // PostgreSQL: io_error
            '53300', // PostgreSQL: too_many_connections
            '08000', // PostgreSQL: connection_exception
            '08003', // PostgreSQL: connection_does_not_exist
            '08006', // PostgreSQL: connection_failure
            '08001', // PostgreSQL: sqlclient_unable_to_establish_sqlconnection
            '08004' // PostgreSQL: sqlserver_rejected_establishment_of_sqlconnection
        ];
        return retryableCodes.includes(error.code);
    }
    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Health check to keep connections alive
     */
    async healthCheck() {
        try {
            const result = await this.query('SELECT 1 as health', [], { maxRetries: 1 });
            if (result.rows[0].health === 1) {
                this.isHealthy = true;
                logger.debug('Database health check passed', {
                    totalCount: this.pool.totalCount,
                    idleCount: this.pool.idleCount,
                    waitingCount: this.pool.waitingCount
                });
            }
        }
        catch (error) {
            this.isHealthy = false;
            logger.error('Database health check failed', {
                error: error.message,
                code: error.code
            });
        }
    }
    /**
     * Start periodic health checks
     */
    startHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        this.healthCheckInterval = setInterval(() => {
            this.healthCheck();
        }, HEALTH_CHECK_INTERVAL);
        // Run initial health check
        this.healthCheck();
    }
    /**
     * Stop health checks
     */
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }
    /**
     * Get pool status
     */
    getStatus() {
        return {
            isHealthy: this.isHealthy,
            circuitBreakerOpen: this.circuitBreakerOpen,
            retryCount: this.retryCount,
            totalCount: this.pool.totalCount,
            idleCount: this.pool.idleCount,
            waitingCount: this.pool.waitingCount
        };
    }
    /**
     * Close all connections
     */
    async end() {
        this.stopHealthCheck();
        await this.pool.end();
        logger.info('Database connection pool closed');
    }
}
// Create singleton instance
const resilientConnection = new ResilientDatabaseConnection();
// Export query function
export const query = (text, params, options) => resilientConnection.query(text, params, options);
// Export pool for direct access if needed
export const pool = resilientConnection.pool;
// Export connection instance
export default resilientConnection;
