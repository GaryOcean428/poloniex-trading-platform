/**
 * Debug Routes - Database inspection and diagnostics
 * WARNING: Should be disabled in production or protected with admin auth
 */

import express from 'express';
import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * Get all tables in the database
 * GET /api/debug/tables
 */
router.get('/tables', async (req, res) => {
  try {
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    const tables = tablesResult.rows.map(row => row.table_name);
    
    res.json({
      success: true,
      count: tables.length,
      tables
    });
  } catch (error: any) {
    logger.error('Error fetching tables:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get table structure
 * GET /api/debug/table/:tableName
 */
router.get('/table/:tableName', async (req, res) => {
  try {
    const { tableName } = req.params;
    
    // Check if table exists
    const existsResult = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      );
    `, [tableName]);
    
    if (!existsResult.rows[0].exists) {
      return res.status(404).json({
        success: false,
        error: `Table '${tableName}' does not exist`
      });
    }
    
    // Get table structure
    const structureResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = $1
      ORDER BY ordinal_position;
    `, [tableName]);
    
    // Get row count
    const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
    
    res.json({
      success: true,
      tableName,
      rowCount: parseInt(countResult.rows[0].count),
      columns: structureResult.rows
    });
  } catch (error: any) {
    logger.error('Error fetching table structure:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Check environment variables
 * GET /api/debug/env
 */
router.get('/env', (req, res) => {
  res.json({
    success: true,
    env: {
      NODE_ENV: process.env.NODE_ENV || 'not set',
      DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'not set',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ? 'set' : 'not set',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? 'set' : 'not set',
      PORT: process.env.PORT || 'not set'
    }
  });
});

/**
 * Test API credentials creation
 * POST /api/debug/test-api-creds
 */
router.post('/test-api-creds', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }
    
    // Check if api_credentials table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'api_credentials'
      );
    `);
    
    if (!tableExists.rows[0].exists) {
      return res.json({
        success: false,
        error: 'api_credentials table does not exist',
        suggestion: 'Run migration 003_add_encrypted_api_credentials.sql'
      });
    }
    
    // Try to insert a test record
    const testInsert = await pool.query(`
      INSERT INTO api_credentials (
        user_id, exchange, api_key_encrypted, api_secret_encrypted, encryption_iv, is_active
      ) VALUES ($1, 'test', 'test_key', 'test_secret', 'test_iv', false)
      ON CONFLICT (user_id, exchange) DO UPDATE SET
        api_key_encrypted = EXCLUDED.api_key_encrypted
      RETURNING id;
    `, [userId]);
    
    // Delete the test record
    await pool.query('DELETE FROM api_credentials WHERE exchange = $1', ['test']);
    
    res.json({
      success: true,
      message: 'api_credentials table is working correctly',
      testId: testInsert.rows[0].id
    });
    
  } catch (error: any) {
    logger.error('Error testing API credentials:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      detail: error.detail || 'No additional details'
    });
  }
});

export default router;

/**
 * Check users table and demo user
 * GET /api/debug/users
 */
router.get('/users', async (req, res) => {
  try {
    // Check if users table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);
    
    if (!tableExists.rows[0].exists) {
      return res.json({
        success: false,
        error: 'users table does not exist',
        suggestion: 'Run database migrations'
      });
    }
    
    // Get user count
    const countResult = await pool.query('SELECT COUNT(*) as count FROM users');
    
    // Check if demo user exists
    const demoUserResult = await pool.query(
      'SELECT id, username, email, created_at FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1',
      ['demo']
    );
    
    // Check if GaryOcean user exists
    const garyUserResult = await pool.query(
      'SELECT id, username, email, created_at FROM users WHERE LOWER(username) = $1',
      ['garyocean']
    );
    
    // Get all usernames (without sensitive data)
    const allUsersResult = await pool.query(
      'SELECT id, username, email, created_at FROM users ORDER BY created_at DESC LIMIT 10'
    );
    
    res.json({
      success: true,
      totalUsers: parseInt(countResult.rows[0].count),
      demoUserExists: demoUserResult.rows.length > 0,
      demoUser: demoUserResult.rows[0] || null,
      garyUserExists: garyUserResult.rows.length > 0,
      garyUser: garyUserResult.rows[0] || null,
      recentUsers: allUsersResult.rows
    });
  } catch (error: any) {
    logger.error('Error checking users:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Test database connection
 * GET /api/debug/db-connection
 */
router.get('/db-connection', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
    res.json({
      success: true,
      connected: true,
      timestamp: result.rows[0].current_time,
      postgresVersion: result.rows[0].pg_version
    });
  } catch (error: any) {
    logger.error('Database connection test failed:', error);
    res.status(500).json({
      success: false,
      connected: false,
      error: error.message
    });
  }
});
