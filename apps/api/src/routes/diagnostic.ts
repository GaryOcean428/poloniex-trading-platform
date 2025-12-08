/**
 * Diagnostic Routes
 * For debugging balance and credentials issues
 */

import express, { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';
import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/diagnostic/credentials-status
 * Check if user has credentials and their status
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
      credentials: result.rows.map(row => ({
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
  } catch (error: any) {
    logger.error('Diagnostic credentials-status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/diagnostic/test-balance
 * Test balance fetch with detailed logging
 */
router.get('/test-balance', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);
    
    logger.info('Diagnostic test-balance started', { userId });
    
    // Step 1: Check credentials
    const credentials = await apiCredentialsService.getCredentials(userId);
    
    if (!credentials) {
      return res.json({
        success: false,
        step: 'credentials',
        message: 'No credentials found for user',
        userId
      });
    }
    
    logger.info('Credentials retrieved', {
      userId,
      exchange: credentials.exchange,
      hasApiKey: !!credentials.apiKey,
      apiKeyLength: credentials.apiKey?.length,
      hasApiSecret: !!credentials.apiSecret,
      apiSecretLength: credentials.apiSecret?.length
    });
    
    // Step 2: Try to fetch balance
    const poloniexFuturesService = (await import('../services/poloniexFuturesService.js')).default;
    
    try {
      const balance = await poloniexFuturesService.getAccountBalance(credentials);
      
      logger.info('Balance fetched successfully', {
        userId,
        balance: JSON.stringify(balance)
      });
      
      res.json({
        success: true,
        step: 'complete',
        balance,
        balanceKeys: Object.keys(balance),
        transformed: {
          totalBalance: parseFloat(balance.eq || balance.totalEquity || '0'),
          availableBalance: parseFloat(balance.availMgn || balance.availableBalance || '0'),
          marginBalance: parseFloat(balance.eq || balance.totalEquity || '0'),
          unrealizedPnL: parseFloat(balance.upl || balance.unrealizedPnL || '0')
        }
      });
    } catch (apiError: any) {
      logger.error('Poloniex API error in diagnostic', {
        userId,
        status: apiError.response?.status,
        statusText: apiError.response?.statusText,
        data: apiError.response?.data,
        message: apiError.message
      });
      
      res.json({
        success: false,
        step: 'poloniex_api',
        error: apiError.message,
        status: apiError.response?.status,
        statusText: apiError.response?.statusText,
        poloniexError: apiError.response?.data
      });
    }
  } catch (error: any) {
    logger.error('Diagnostic test-balance error:', error);
    res.status(500).json({
      success: false,
      step: 'unknown',
      error: error.message,
      stack: error.stack
    });
  }
});

export default router;
