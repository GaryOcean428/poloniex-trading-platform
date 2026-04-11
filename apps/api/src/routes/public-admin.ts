import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db/connection.js';
import { authRateLimiter } from '../config/security.js';

const router = express.Router();

// Apply rate limiting to all public-admin routes
router.use(authRateLimiter);

/**
 * Validate the SECRET_ADMIN_KEY. Rejects if not set or using default placeholder.
 */
function validateAdminKey(adminKey: string | undefined): boolean {
  const expectedKey = process.env.SECRET_ADMIN_KEY?.trim();
  if (!expectedKey || expectedKey === 'CHANGE_ME_IN_PRODUCTION') {
    return false;
  }
  if (!adminKey) {
    return false;
  }
  // Use constant-time comparison to prevent timing attacks
  const adminBuf = Buffer.from(adminKey, 'utf8');
  const expectedBuf = Buffer.from(expectedKey, 'utf8');
  if (adminBuf.length !== expectedBuf.length) {
    // Still perform a comparison to avoid leaking length via timing
    crypto.timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return crypto.timingSafeEqual(adminBuf, expectedBuf);
}

// Public password reset endpoint (no authentication required)
// Only works if SECRET_ADMIN_KEY environment variable matches
router.post('/reset-password', async (req, res) => {
  try {
    const { username, password, adminKey } = req.body;
    
    if (!validateAdminKey(adminKey)) {
      return res.status(403).json({ error: 'Invalid admin key' });
    }
    
    // Run migration 005 first
    try {
      await pool.query(`ALTER TABLE api_credentials ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{"read": true, "trade": true, "withdraw": false}'::jsonb;`);
    } catch (_migError: unknown) {
      // migration may have already been applied
    }
    
    if (!username || !password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Username and password (min 8 chars) required' });
    }
    
    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Update user password
    const result = await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE username = $2 RETURNING id, username',
      [hashedPassword, username]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      success: true,
      message: `Password reset successful for user: ${username}`,
      user: { id: result.rows[0].id, username: result.rows[0].username }
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Quick reset for GaryOcean (temporary convenience endpoint) + Run migration
router.post('/reset-garyocean', async (req, res) => {
  try {
    const { adminKey, password } = req.body;
    
    if (!validateAdminKey(adminKey)) {
      return res.status(403).json({ error: 'Invalid admin key' });
    }
    
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password (min 8 chars) required in request body' });
    }
    
    // Run migration 005: Add permissions column
    try {
      await pool.query(`
        ALTER TABLE api_credentials 
        ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{"read": true, "trade": true, "withdraw": false}'::jsonb;
      `);
    } catch (_migError: unknown) {
      // migration may have already been applied
    }
    
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Update GaryOcean password
    const result = await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE username = $2 RETURNING id, username',
      [hashedPassword, 'GaryOcean']
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'GaryOcean user not found' });
    }
    
    res.json({
      success: true,
      message: 'GaryOcean password reset successfully',
      user: { id: result.rows[0].id, username: result.rows[0].username }
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Run database migration endpoint
router.post('/run-migration', async (req, res) => {
  try {
    const { migrationNumber, adminKey } = req.body;
    
    if (!validateAdminKey(adminKey)) {
      return res.status(403).json({ error: 'Invalid admin key' });
    }
    
    if (!migrationNumber) {
      return res.status(400).json({ error: 'Migration number required' });
    }
    
    // Run migration 005: Add permissions column
    if (migrationNumber === '005') {
      await pool.query(`
        ALTER TABLE api_credentials 
        ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{"read": true, "trade": true, "withdraw": false}'::jsonb;
        
        CREATE INDEX IF NOT EXISTS idx_api_credentials_permissions ON api_credentials USING gin(permissions);
      `);
      
      res.json({
        success: true,
        message: 'Migration 005 completed: Added permissions column to api_credentials table'
      });
    } else {
      res.status(400).json({ error: 'Unknown migration number' });
    }
  } catch (error: unknown) {
    console.error('Migration error:', error);
    res.status(500).json({ error: 'Failed to run migration' });
  }
});

export default router;
