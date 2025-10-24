import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/connection.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
const router = express.Router();
router.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'auth' });
});
router.post('/login', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if ((!username && !email) || !password) {
            return res.status(400).json({ error: 'Username/email and password required' });
        }
        const identifierRaw = (email || username || '').trim();
        const identifier = identifierRaw.toLowerCase();
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
        const token = jwt.sign({ userId: user.id, email: user.email }, env.JWT_SECRET, { expiresIn: `${process.env.JWT_ACCESS_TOKEN_EXPIRE_MINUTES || 1440}m` });
        res.json({
            token,
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
router.get('/verify', (req, res) => {
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
        return res.status(200).json({
            success: true,
            user: { id: decoded?.userId, email: decoded?.email }
        });
    }
    catch (err) {
        logger.error('Verify handler error', { error: err.message, stack: err.stack });
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
});
router.post('/logout', async (_req, res) => {
    return res.json({ success: true });
});
router.post('/refresh', async (_req, res) => {
    return res.status(501).json({ success: false, error: 'Not implemented' });
});
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
        const token = jwt.sign({ userId: user.id, email: user.email }, env.JWT_SECRET, { expiresIn: `${process.env.JWT_ACCESS_TOKEN_EXPIRE_MINUTES || 1440}m` });
        res.json({
            token,
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
