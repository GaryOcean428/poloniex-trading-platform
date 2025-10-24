import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './env.js';
import { logger } from '../utils/logger.js';
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
    crossOriginEmbedderPolicy: false,
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'same-origin' }
});
export const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        error: 'Too many requests from this IP, please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
        error: 'Too many authentication attempts, please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
export function createCorsOptions() {
    const defaultLocalOrigins = env.NODE_ENV === 'production' ? [] : [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:5675'
    ];
    const allowedOrigins = [
        'https://healthcheck.railway.app',
        ...(env.FRONTEND_URL ? [env.FRONTEND_URL] : []),
        ...(env.CORS_ALLOWED_ORIGINS || []),
        ...defaultLocalOrigins
    ];
    const allowedOriginsSet = new Set(allowedOrigins);
    return {
        origin: (origin, callback) => {
            if (!origin) {
                return callback(null, true);
            }
            if (allowedOriginsSet.has(origin)) {
                return callback(null, true);
            }
            logger.warn('CORS blocked origin', { origin });
            return callback(new Error('Not allowed by CORS'), false);
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
        maxAge: 86400,
        preflightContinue: false,
        optionsSuccessStatus: 204
    };
}
export function securityLogger(req, res, next) {
    const suspiciousPatterns = [
        /\.\./,
        /<script/i,
        /union.*select/i,
        /javascript:/i,
        /vbscript:/i,
        /onload=/i,
        /onerror=/i
    ];
    const url = req.url || '';
    const userAgent = req.get('User-Agent') || '';
    const referer = req.get('Referer') || '';
    const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(url) || pattern.test(userAgent) || pattern.test(referer));
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
export function sanitizeRequest(req, res, next) {
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
