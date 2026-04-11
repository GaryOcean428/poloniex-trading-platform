/**
 * Debug Routes - Database inspection and diagnostics
 * Consolidates former diagnostic.ts and test-balance.ts routes.
 * WARNING: Should be disabled in production or protected with admin auth
 */

import express from 'express';
import type { Request, Response } from 'express';
import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { authenticateToken } from '../middleware/auth.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';

interface CredentialRow {
  id: string;
  exchange: string;
  is_active: boolean;
  key_length: number;
  secret_length: number;
  has_iv: boolean;
  has_tag: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

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
  } catch (error: unknown) {
    logger.error('Error fetching tables:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errMsg
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
      rowCount: parseInt(countResult.rows[0].count, 10),
      columns: structureResult.rows
    });
  } catch (error: unknown) {
    logger.error('Error fetching table structure:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errMsg
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
    
  } catch (error: unknown) {
    logger.error('Error testing API credentials:', error);
    const err = error as { message?: string; detail?: string };
    res.status(500).json({
      success: false,
      error: err.message ?? String(error),
      detail: err.detail ?? 'No additional details'
    });
  }
});

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
      totalUsers: parseInt(countResult.rows[0].count, 10),
      demoUserExists: demoUserResult.rows.length > 0,
      demoUser: demoUserResult.rows[0] || null,
      garyUserExists: garyUserResult.rows.length > 0,
      garyUser: garyUserResult.rows[0] || null,
      recentUsers: allUsersResult.rows
    });
  } catch (error: unknown) {
    logger.error('Error checking users:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errMsg
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
  } catch (error: unknown) {
    logger.error('Database connection test failed:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      connected: false,
      error: errMsg
    });
  }
});

/**
 * GET /api/debug/credentials-status
 * Check if user has credentials and their status
 * (Consolidated from former diagnostic.ts)
 */
router.get('/credentials-status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    
    // Check database directly
    const result = await pool.query(`
      SELECT 
        id, exchange, is_active, created_at, updated_at, last_used_at,
        LENGTH(api_key_encrypted) as key_length,
        LENGTH(api_secret_encrypted) as secret_length,
        encryption_iv IS NOT NULL as has_iv,
        encryption_tag IS NOT NULL as has_tag
      FROM api_credentials
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    
    const hasCredentials = await apiCredentialsService.hasCredentials(userId);
    
    res.json({
      success: true,
      userId,
      hasCredentials,
      credentialsCount: result.rows.length,
      credentials: result.rows.map((row: CredentialRow) => ({
        id: row.id,
        exchange: row.exchange,
        isActive: row.is_active,
        keyLength: row.key_length,
        secretLength: row.secret_length,
        hasIv: row.has_iv,
        hasTag: row.has_tag,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastUsedAt: row.last_used_at
      }))
    });
  } catch (error: unknown) {
    logger.error('Debug credentials-status error:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errMsg
    });
  }
});

/**
 * GET /api/debug/test-balance
 * Test balance fetch with detailed logging
 * (Consolidated from former test-balance.ts and diagnostic.ts)
 */
router.get('/test-balance', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    logger.info('=== TEST BALANCE REQUEST ===', { userId });
    
    // Step 1: Get credentials
    logger.info('Step 1: Fetching credentials...');
    const credentials = await apiCredentialsService.getCredentials(userId);
    
    if (!credentials) {
      logger.warn('No credentials found');
      return res.json({
        success: false,
        error: 'No API credentials found',
        step: 'credentials'
      });
    }
    
    logger.info('Credentials found:', {
      hasApiKey: !!credentials.apiKey,
      apiKeyLength: credentials.apiKey?.length,
      hasApiSecret: !!credentials.apiSecret,
      apiSecretLength: credentials.apiSecret?.length,
      exchange: credentials.exchange
    });
    
    // Step 2: Test balance fetch
    logger.info('Step 2: Fetching balance from Poloniex...');
    
    try {
      const balance = await poloniexFuturesService.getAccountBalance(credentials);
      
      logger.info('Balance fetched successfully:', {
        balance: JSON.stringify(balance, null, 2)
      });
      
      return res.json({
        success: true,
        balance,
        credentials: {
          hasApiKey: !!credentials.apiKey,
          apiKeyPrefix: credentials.apiKey?.substring(0, 8),
          exchange: credentials.exchange
        }
      });
      
    } catch (apiError: unknown) {
      const ae = apiError as { message?: string; response?: { status?: number; statusText?: string; data?: unknown } };
      logger.error('Poloniex API Error:', {
        message: ae.message,
        status: ae.response?.status,
        statusText: ae.response?.statusText,
        data: JSON.stringify(ae.response?.data)
      });
      
      return res.json({
        success: false,
        error: 'Poloniex API call failed',
        step: 'api_call',
        details: {
          message: ae.message,
          status: ae.response?.status,
          data: ae.response?.data
        }
      });
    }
    
  } catch (error: unknown) {
    logger.error('Test balance error:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: errMsg,
      step: 'unknown'
    });
  }
});

export default router;
