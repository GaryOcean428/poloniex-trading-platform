import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/connection.js';

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
    const identifier = email || username;

    // If identifier looks like an email (has @), lookup by email only; otherwise allow name OR email match
    const looksLikeEmail = typeof identifier === 'string' && identifier.includes('@');

    const query = looksLikeEmail
      ? 'SELECT * FROM users WHERE email = $1 LIMIT 1'
      : 'SELECT * FROM users WHERE name = $1 OR email = $1 LIMIT 1';

    const result = await pool.query(query, [identifier]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: `${process.env.JWT_ACCESS_TOKEN_EXPIRE_MINUTES || 1440}m` }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register endpoint
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, hashedPassword, name]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
