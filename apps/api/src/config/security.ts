/**
 * Security Middleware Configuration
 *
 * Configures comprehensive security middleware including helmet, CORS hardening,
 * rate limiting, and other security measures.
 */

import type { CorsOptions } from 'cors';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { logger } from '../utils/logger.js';
import { env } from './env.js';

/**
 * Enhanced security headers configuration using helmet
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'wss:', 'https:'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow for Railway deployment
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'same-origin' }
});

/**
 * Rate limiting configuration
 */
export const rateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // Limit each IP to 1000 requests per minute (higher for dashboard polling)
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Stricter rate limiting for authentication endpoints
 */
export const authRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // Limit auth attempts to 20 per minute per IP
  message: {
    error: 'Too many authentication attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Enhanced CORS configuration with security hardening
 */
export function createCorsOptions(): CorsOptions {
  const defaultLocalOrigins = env.NODE_ENV === 'production' ? [] : [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5675'
  ];

  const allowedOrigins = [
    'https://healthcheck.railway.app',
    // Prefer FRONTEND_URL when provided
    ...(env.FRONTEND_URL ? [env.FRONTEND_URL] : []),
    // Allow backend's own origin (Swagger, health page, internal calls)
    // RAILWAY_PUBLIC_DOMAIN is auto-set by Railway, not in our Zod schema
    ...(process.env.RAILWAY_PUBLIC_DOMAIN ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`] : []),
    // Custom set via env variable
    ...(env.CORS_ALLOWED_ORIGINS || []),
    // Local development fallbacks when not in production
    ...defaultLocalOrigins
  ];

  // De-duplicate entries
  const allowedOriginsSet = new Set(allowedOrigins);

  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void => {
      // In production, reject requests with no origin header to prevent
      // cross-origin attacks from non-browser clients (only allow in dev)
      if (!origin) {
        if (env.NODE_ENV === 'production') {
          return callback(null, false);
        }
        return callback(null, true);
      }

      // Check if origin is in allowed list
      if (allowedOriginsSet.has(origin)) {
        return callback(null, true);
      }

      // Log blocked origins for debugging (limit spam with rate limiting)
      logger.warn('CORS blocked origin', { origin });
      // Return false instead of an Error to avoid Express treating this as a 500.
      // The browser still sees a proper CORS rejection.
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'X-API-Key'
    ],
    exposedHeaders: ['X-Total-Count'],
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204
  };
}

/**
 * Security logging middleware
 */
export function securityLogger(req: Request, _res: Response, next: NextFunction): void {
  // Log suspicious requests
  const suspiciousPatterns = [
    /\.\./,           // Path traversal
    /<script/i,       // XSS attempts
    /union.*select/i, // SQL injection
    /javascript:/i,   // XSS attempts
    /vbscript:/i,     // XSS attempts
    /onload=/i,       // XSS attempts
    /onerror=/i       // XSS attempts
  ];

  const url = req.url || '';
  const userAgent = req.get('User-Agent') || '';
  const referer = req.get('Referer') || '';

  const isSuspicious = suspiciousPatterns.some(pattern =>
    pattern.test(url) || pattern.test(userAgent) || pattern.test(referer)
  );

  if (isSuspicious) {
    logger.warn('Suspicious request detected', {
      ip: req.ip,
      method: req.method,
      url: url,
      userAgent: userAgent,
      referer: referer,
      timestamp: new Date().toISOString()
    });
  }

  next();
}

/**
 * Request sanitization middleware
 */
export function sanitizeRequest(req: Request, _res: Response, next: NextFunction): void {
  // Remove potential XSS vectors from query parameters
  if (req.query) {
    for (const key in req.query) {
      if (typeof req.query[key] === 'string') {
        req.query[key] = req.query[key]
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/vbscript:/gi, '')
          .replace(/on\w+\s*=/gi, '');
      }
    }
  }

  next();
}
