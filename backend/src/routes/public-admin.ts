import express from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/connection.js';

const router = express.Router();

// Public password reset endpoint (no authentication required)
// Only works if SECRET_ADMIN_KEY environment variable matches
router.post('/reset-password', async (req, res) => {
  try {
    const { username, password, adminKey } = req.body;
    
    // Check admin key
    const expectedKey = process.env.SECRET_ADMIN_KEY || 'CHANGE_ME_IN_PRODUCTION';
    if (adminKey !== expectedKey) {
      return res.status(403).json({ error: 'Invalid admin key' });
    }
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Update user password
    const result = await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE username = $2 RETURNING id, username, email',
      [hashedPassword, username]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      success: true,
      message: `Password reset successful for user: ${username}`,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Quick reset for GaryOcean (temporary convenience endpoint)
router.post('/reset-garyocean', async (req, res) => {
  try {
    const { adminKey } = req.body;
    
    // Check admin key
    const expectedKey = process.env.SECRET_ADMIN_KEY || 'CHANGE_ME_IN_PRODUCTION';
    if (adminKey !== expectedKey) {
      return res.status(403).json({ error: 'Invalid admin key' });
    }
    
    // Hash the password "I.Am.Dev.1"
    const hashedPassword = await bcrypt.hash('I.Am.Dev.1', 10);
    
    // Update GaryOcean password
    const result = await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE username = $2 RETURNING id, username, email',
      [hashedPassword, 'GaryOcean']
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'GaryOcean user not found' });
    }
    
    res.json({
      success: true,
      message: 'GaryOcean password reset to: I.Am.Dev.1',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

export default router;
