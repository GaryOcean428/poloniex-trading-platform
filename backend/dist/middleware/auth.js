import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
export const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({
            error: 'Access token required',
            code: 'NO_TOKEN'
        });
    }
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        logger.error('JWT_SECRET environment variable is required');
        throw new Error('JWT_SECRET environment variable is required');
    }
    jwt.verify(token, jwtSecret, (err, user) => {
        if (err) {
            logger.warn('JWT verification failed', { error: err.message });
            return res.status(403).json({
                error: 'Invalid or expired token',
                code: 'INVALID_TOKEN'
            });
        }
        req.user = user;
        next();
    });
};
export const optionalAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
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
            logger.warn('Optional JWT verification failed', { error: err.message });
            req.user = null;
        }
        else {
            req.user = user;
        }
        next();
    });
};
export const generateToken = (payload, expiresIn = '1h') => {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        logger.error('JWT_SECRET environment variable is required');
        throw new Error('JWT_SECRET environment variable is required');
    }
    return jwt.sign(payload, jwtSecret, {
        expiresIn,
        issuer: 'poloniex-trading-platform',
        audience: 'poloniex-trading-app'
    });
};
export const generateRefreshToken = (payload) => {
    return generateToken(payload, '7d');
};
export const verifyToken = (token) => {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        logger.error('JWT_SECRET environment variable is required');
        throw new Error('JWT_SECRET environment variable is required');
    }
    try {
        return jwt.verify(token, jwtSecret);
    }
    catch (error) {
        return null;
    }
};
