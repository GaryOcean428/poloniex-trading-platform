import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/connection.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
const router = express.Router();
// Simple health check for auth
router.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'auth' });
});
// Login endpoint (supports username OR email + password)
router.post('/login', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if ((!username && !email) || !password) {
            return res.status(400).json({ error: 'Username/email and password required' });
        }
        // Determine identifier: prefer explicit email if provided, otherwise username
        const identifierRaw = (email || username || '').trim();
        const identifier = identifierRaw.toLowerCase();
        // If identifier looks like an email (has @), lookup by email only; otherwise allow username OR email match (case-insensitive)
        const looksLikeEmail = typeof identifierRaw === 'string' && identifierRaw.includes('@');
        const query = looksLikeEmail
            ? 'SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1'
            : 'SELECT * FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1 LIMIT 1';
        const result = await pool.query(query, [identifier]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = result.rows[0];
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        // Generate access token (short-lived)
        const accessToken = jwt.sign({ id: user.id, userId: user.id, email: user.email }, env.JWT_SECRET, { expiresIn: '1h' } // 1 hour
        );
        // Generate refresh token (long-lived)
        const refreshToken = jwt.sign({ id: user.id, userId: user.id, email: user.email, type: 'refresh' }, env.JWT_SECRET, { expiresIn: '7d' } // 7 days
        );
        res.json({
            token: accessToken, // For backward compatibility
            accessToken,
            refreshToken,
            expiresIn: 3600, // 1 hour in seconds
            user: {
                id: user.id,
                email: user.email,
                name: user.username || user.name
            }
        });
    }
    catch (error) {
        logger.error('Login error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Server error' });
    }
});
/**
 * Verify token endpoint
 * Expects: Authorization: Bearer <jwt>
 * Returns: { success: true, user: { id, email } } on valid token
 */
router.get('/verify', (req, res) => {
    // Defensive, never throw: always return JSON with explicit status
    try {
        const authHeader = req.headers.authorization || '';
        const parts = authHeader.split(' ');
        const token = parts.length === 2 && (parts[0] || '').toLowerCase() === 'bearer' ? parts[1] : null;
        if (!token) {
            return res.status(401).json({ success: false, error: 'Missing token' });
        }
        let decoded;
        try {
            decoded = jwt.verify(token, env.JWT_SECRET);
        }
        catch (e) {
            logger.warn('JWT verify failed', { error: e?.message || e });
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        // Success
        return res.status(200).json({
            success: true,
            user: { id: decoded?.userId, email: decoded?.email }
        });
    }
    catch (err) {
        // Absolute fallback: never escalate to global 500
        logger.error('Verify handler error', { error: err.message, stack: err.stack });
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
});
/**
 * Logout endpoint (no-op for stateless JWT)
 */
router.post('/logout', async (_req, res) => {
    return res.json({ success: true });
});
/**
 * Refresh endpoint - exchange refresh token for new access token
 */
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                error: 'Refresh token required'
            });
        }
        // Verify refresh token
        let decoded;
        try {
            decoded = jwt.verify(refreshToken, env.JWT_SECRET);
        }
        catch (err) {
            logger.warn('Refresh token verification failed', { error: err.message });
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired refresh token'
            });
        }
        // Ensure it's a refresh token
        if (decoded.type !== 'refresh') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token type'
            });
        }
        // Generate new access token
        const newAccessToken = jwt.sign({ id: decoded.id, userId: decoded.userId, email: decoded.email }, env.JWT_SECRET, { expiresIn: '1h' });
        // Optionally generate new refresh token (rotation)
        const newRefreshToken = jwt.sign({ id: decoded.id, userId: decoded.userId, email: decoded.email, type: 'refresh' }, env.JWT_SECRET, { expiresIn: '7d' });
        res.json({
            success: true,
            token: newAccessToken, // For backward compatibility
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            expiresIn: 3600 // 1 hour in seconds
        });
    }
    catch (error) {
        logger.error('Refresh token error', { error: error.message, stack: error.stack });
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
// Register endpoint
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const username = (req.body.username || req.body.name || '').trim();
        if (!email || !password || !username) {
            return res.status(400).json({ error: 'All fields required (email, username, password)' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query('INSERT INTO users (email, password_hash, username) VALUES ($1, $2, $3) RETURNING id, email, username', [email, hashedPassword, username]);
        const user = result.rows[0];
        // Generate access token (short-lived)
        const accessToken = jwt.sign({ id: user.id, userId: user.id, email: user.email }, env.JWT_SECRET, { expiresIn: '1h' });
        // Generate refresh token (long-lived)
        const refreshToken = jwt.sign({ id: user.id, userId: user.id, email: user.email, type: 'refresh' }, env.JWT_SECRET, { expiresIn: '7d' });
        res.json({
            token: accessToken, // For backward compatibility
            accessToken,
            refreshToken,
            expiresIn: 3600, // 1 hour in seconds
            user: {
                id: user.id,
                email: user.email,
                name: user.username
            }
        });
    }
    catch (error) {
        logger.error('Registration error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Server error' });
    }
});
export default router;
