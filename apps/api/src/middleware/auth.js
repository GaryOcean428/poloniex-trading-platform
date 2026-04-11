import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';

const AUTH_LOG_COOLDOWN_MS = 60_000;
const MAX_AUTH_LOG_KEYS = 20;
const authFailureLogState = new Map();

const normalizeAuthHeader = (authHeader) => {
  if (!authHeader) return '';
  if (Array.isArray(authHeader)) return authHeader[0] || '';
  if (typeof authHeader !== 'string') return '';
  return authHeader.trim();
};

const extractBearerToken = (authHeader) => {
  const normalizedHeader = normalizeAuthHeader(authHeader);
  if (!normalizedHeader) return null;

  const match = normalizedHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match || !match[1]) {
    return null;
  }

  const token = match[1].trim();
  if (!token || token === 'null' || token === 'undefined') {
    return null;
  }

  return token;
};

const isLikelyJwt = (token) => {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every(part => part.length > 0);
};

const logJwtVerificationFailure = (errorMessage) => {
  const key = errorMessage || 'unknown';
  const now = Date.now();
  const previous = authFailureLogState.get(key);

  if (!previous && authFailureLogState.size >= MAX_AUTH_LOG_KEYS) {
    const oldestEntry = Array.from(authFailureLogState.entries())
      .sort((a, b) => a[1].lastLoggedAt - b[1].lastLoggedAt)[0];
    if (oldestEntry) {
      authFailureLogState.delete(oldestEntry[0]);
    }
  }

  if (!previous || now - previous.lastLoggedAt >= AUTH_LOG_COOLDOWN_MS) {
    if (previous?.suppressedCount > 0) {
      logger.warn('JWT verification failed', { error: key, suppressed: previous.suppressedCount });
    } else {
      logger.warn('JWT verification failed', { error: key });
    }
    authFailureLogState.set(key, { lastLoggedAt: now, suppressedCount: 0 });
    return;
  }

  previous.suppressedCount += 1;
  authFailureLogState.set(key, previous);
};

/**
 * JWT Authentication Middleware
 * Verifies JWT tokens and adds user information to request
 */
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = extractBearerToken(authHeader);

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      code: 'NO_TOKEN'
    });
  }

  if (!isLikelyJwt(token)) {
    logJwtVerificationFailure('jwt malformed');
    return res.status(403).json({
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN'
    });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    logger.error('JWT_SECRET environment variable is required');
    throw new Error('JWT_SECRET environment variable is required');
  }
  
  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) {
      logJwtVerificationFailure(err.message);
      return res.status(403).json({
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN'
      });
    }

    req.user = user;
    next();
  });
};

/**
 * Optional authentication middleware - continues even if no token
 */
export const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = extractBearerToken(authHeader);

  if (!token) {
    req.user = null;
    return next();
  }

  if (!isLikelyJwt(token)) {
    req.user = null;
    return next();
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    logger.error('JWT_SECRET environment variable is required');
    throw new Error('JWT_SECRET environment variable is required');
  }
  
  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) {
      logJwtVerificationFailure(err.message);
      req.user = null;
    } else {
      req.user = user;
    }
    next();
  });
};

/**
 * Generate JWT token
 */
export const generateToken = (payload, expiresIn = '1h') => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    logger.error('JWT_SECRET environment variable is required');
    throw new Error('JWT_SECRET environment variable is required');
  }
  
  return jwt.sign(payload, jwtSecret, {
    expiresIn
  });
};

/**
 * Generate refresh token (longer expiry)
 */
export const generateRefreshToken = (payload) => {
  return generateToken(payload, '7d');
};

/**
 * Verify and decode token without middleware
 */
export const verifyToken = (token) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    logger.error('JWT_SECRET environment variable is required');
    throw new Error('JWT_SECRET environment variable is required');
  }
  
  try {
    return jwt.verify(token, jwtSecret);
  } catch (error) {
    return null;
  }
};
