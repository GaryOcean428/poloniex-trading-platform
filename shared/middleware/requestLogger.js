"use strict";
/**
 * Request/Response Logging Middleware
 * Provides structured logging for API requests and responses
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = exports.RequestResponseLogger = void 0;
const logger_js_1 = require("../logger.js");
const DEFAULT_CONFIG = {
    enabled: true,
    logLevel: 'info',
    logRequestBody: true,
    logResponseBody: true,
    maxBodySize: 10000, // 10KB
    excludePaths: ['/health', '/ping', '/metrics'],
    sensitiveFields: ['password', 'token', 'apiKey', 'secret', 'authorization']
};
class RequestResponseLogger {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Express middleware for request/response logging
     */
    expressMiddleware() {
        return (req, res, next) => {
            if (!this.config.enabled || this.shouldExcludePath(req.path)) {
                return next();
            }
            const startTime = Date.now();
            const requestId = this.generateRequestId();
            // Add request ID to request object for correlation
            req.requestId = requestId;
            // Log incoming request
            this.logRequest(req, requestId);
            // Capture response
            const originalSend = res.send;
            let responseBody;
            res.send = function (data) {
                responseBody = data;
                return originalSend.call(this, data);
            };
            // Log response when finished
            res.on('finish', () => {
                const duration = Date.now() - startTime;
                this.logResponse(req, res, responseBody, duration, requestId);
            });
            next();
        };
    }
    /**
     * Fetch API wrapper for client-side logging
     */
    wrapFetch(originalFetch = fetch) {
        return async (input, init) => {
            const startTime = Date.now();
            const requestId = this.generateRequestId();
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            // Log request
            if (this.config.enabled && !this.shouldExcludePath(new URL(url).pathname)) {
                this.logFetchRequest(url, init, requestId);
            }
            try {
                const response = await originalFetch(input, init);
                const duration = Date.now() - startTime;
                // Log response
                if (this.config.enabled && !this.shouldExcludePath(new URL(url).pathname)) {
                    await this.logFetchResponse(url, response.clone(), duration, requestId);
                }
                return response;
            }
            catch (error) {
                const duration = Date.now() - startTime;
                if (this.config.enabled) {
                    logger_js_1.logger.error('Fetch request failed', error, {
                        requestId,
                        method: init?.method || 'GET',
                        url,
                        duration,
                        component: 'http-client'
                    });
                }
                throw error;
            }
        };
    }
    logRequest(req, requestId) {
        const context = {
            requestId,
            method: req.method,
            url: req.originalUrl || req.url,
            userAgent: req.get('User-Agent'),
            ip: req.ip || req.connection?.remoteAddress,
            component: 'http-server',
            action: 'request'
        };
        let message = `${req.method} ${req.originalUrl || req.url}`;
        if (this.config.logRequestBody && req.body) {
            const sanitizedBody = this.sanitizeObject(req.body);
            const bodyString = JSON.stringify(sanitizedBody);
            if (bodyString.length <= this.config.maxBodySize) {
                context.requestBody = sanitizedBody;
                message += ` - Body: ${bodyString.substring(0, 200)}${bodyString.length > 200 ? '...' : ''}`;
            }
            else {
                context.bodyTruncated = true;
                message += ` - Body: [${bodyString.length} bytes, truncated]`;
            }
        }
        logger_js_1.logger.info(message, context);
    }
    logResponse(req, res, body, duration, requestId) {
        const statusCode = res.statusCode;
        const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
        const context = {
            requestId,
            method: req.method,
            url: req.originalUrl || req.url,
            statusCode,
            duration,
            component: 'http-server',
            action: 'response'
        };
        let message = `${req.method} ${req.originalUrl || req.url} ${statusCode} (${duration}ms)`;
        if (this.config.logResponseBody && body && logLevel !== 'error') {
            try {
                const bodyObj = typeof body === 'string' ? JSON.parse(body) : body;
                const sanitizedBody = this.sanitizeObject(bodyObj);
                const bodyString = JSON.stringify(sanitizedBody);
                if (bodyString.length <= this.config.maxBodySize) {
                    context.responseBody = sanitizedBody;
                }
                else {
                    context.bodyTruncated = true;
                }
            }
            catch (e) {
                // Body is not JSON or failed to parse
                if (typeof body === 'string' && body.length <= 200) {
                    context.responseBody = body;
                }
            }
        }
        if (logLevel === 'error') {
            logger_js_1.logger.error(message, undefined, context);
        }
        else if (logLevel === 'warn') {
            logger_js_1.logger.warn(message, context);
        }
        else {
            logger_js_1.logger.info(message, context);
        }
    }
    logFetchRequest(url, init, requestId) {
        const method = init?.method || 'GET';
        const context = {
            requestId,
            method,
            url,
            component: 'http-client',
            action: 'request'
        };
        let message = `${method} ${url}`;
        if (this.config.logRequestBody && init?.body) {
            try {
                const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
                const sanitizedBody = this.sanitizeObject(body);
                const bodyString = JSON.stringify(sanitizedBody);
                if (bodyString.length <= this.config.maxBodySize) {
                    context.requestBody = sanitizedBody;
                }
                else {
                    context.bodyTruncated = true;
                }
            }
            catch (e) {
                // Body is not JSON
            }
        }
        logger_js_1.logger.info(message, context);
    }
    async logFetchResponse(url, response, duration, requestId) {
        const statusCode = response.status;
        const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
        const context = {
            requestId,
            method: 'GET', // Default, actual method would need to be passed separately
            url,
            statusCode,
            duration,
            component: 'http-client',
            action: 'response'
        };
        let message = `Response ${url} ${statusCode} (${duration}ms)`;
        if (this.config.logResponseBody && logLevel !== 'error') {
            try {
                const body = await response.text();
                const bodyObj = JSON.parse(body);
                const sanitizedBody = this.sanitizeObject(bodyObj);
                const bodyString = JSON.stringify(sanitizedBody);
                if (bodyString.length <= this.config.maxBodySize) {
                    context.responseBody = sanitizedBody;
                }
                else {
                    context.bodyTruncated = true;
                }
            }
            catch (e) {
                // Response is not JSON or failed to read
            }
        }
        if (logLevel === 'error') {
            logger_js_1.logger.error(message, undefined, context);
        }
        else if (logLevel === 'warn') {
            logger_js_1.logger.warn(message, context);
        }
        else {
            logger_js_1.logger.info(message, context);
        }
    }
    sanitizeObject(obj) {
        if (!obj || typeof obj !== 'object') {
            return obj;
        }
        const sanitized = Array.isArray(obj) ? [] : {};
        for (const [key, value] of Object.entries(obj)) {
            if (this.config.sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
                sanitized[key] = '[REDACTED]';
            }
            else if (typeof value === 'object' && value !== null) {
                sanitized[key] = this.sanitizeObject(value);
            }
            else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
    shouldExcludePath(path) {
        return this.config.excludePaths.some(excludePath => path.startsWith(excludePath));
    }
    generateRequestId() {
        return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
    getConfig() {
        return { ...this.config };
    }
}
exports.RequestResponseLogger = RequestResponseLogger;
// Export singleton instance
exports.requestLogger = new RequestResponseLogger();
