/**
 * Request/Response Logging Middleware
 * Provides structured logging for API requests and responses
 */

import { logger } from '../logger.js';

export interface LoggingConfig {
  enabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logRequestBody: boolean;
  logResponseBody: boolean;
  maxBodySize: number; // in bytes
  excludePaths: string[];
  sensitiveFields: string[];
}

const DEFAULT_CONFIG: LoggingConfig = {
  enabled: true,
  logLevel: 'info',
  logRequestBody: true,
  logResponseBody: true,
  maxBodySize: 10000, // 10KB
  excludePaths: ['/health', '/ping', '/metrics'],
  sensitiveFields: ['password', 'token', 'apiKey', 'secret', 'authorization']
};

export class RequestResponseLogger {
  private config: LoggingConfig;

  constructor(config: Partial<LoggingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Express middleware for request/response logging
   */
  expressMiddleware() {
    return (req: any, res: any, next: any) => {
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
      let responseBody: any;

      res.send = function(data: any) {
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
  wrapFetch(originalFetch: typeof fetch = fetch): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
      } catch (error) {
        const duration = Date.now() - startTime;
        
        if (this.config.enabled) {
          logger.error('Fetch request failed', error as Error, {
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

  private logRequest(req: any, requestId: string): void {
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
      } else {
        context.bodyTruncated = true;
        message += ` - Body: [${bodyString.length} bytes, truncated]`;
      }
    }

    logger.info(message, context);
  }

  private logResponse(req: any, res: any, body: any, duration: number, requestId: string): void {
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
        } else {
          context.bodyTruncated = true;
        }
      } catch (e) {
        // Body is not JSON or failed to parse
        if (typeof body === 'string' && body.length <= 200) {
          context.responseBody = body;
        }
      }
    }

    if (logLevel === 'error') {
      logger.error(message, undefined, context);
    } else if (logLevel === 'warn') {
      logger.warn(message, context);
    } else {
      logger.info(message, context);
    }
  }

  private logFetchRequest(url: string, init: RequestInit | undefined, requestId: string): void {
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
        } else {
          context.bodyTruncated = true;
        }
      } catch (e) {
        // Body is not JSON
      }
    }

    logger.info(message, context);
  }

  private async logFetchResponse(url: string, response: Response, duration: number, requestId: string): Promise<void> {
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
        } else {
          context.bodyTruncated = true;
        }
      } catch (e) {
        // Response is not JSON or failed to read
      }
    }

    if (logLevel === 'error') {
      logger.error(message, undefined, context);
    } else if (logLevel === 'warn') {
      logger.warn(message, context);
    } else {
      logger.info(message, context);
    }
  }

  private sanitizeObject(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    const sanitized = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      if (this.config.sensitiveFields.some(field => 
        key.toLowerCase().includes(field.toLowerCase())
      )) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private shouldExcludePath(path: string): boolean {
    return this.config.excludePaths.some(excludePath => 
      path.startsWith(excludePath)
    );
  }

  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  updateConfig(newConfig: Partial<LoggingConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig(): LoggingConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const requestLogger = new RequestResponseLogger();

// Export for custom configurations
export { RequestResponseLogger };