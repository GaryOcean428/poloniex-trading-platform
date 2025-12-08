import express, { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';
import poloniexFuturesService from '../services/poloniexFuturesService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/test-balance
 * Test balance fetch with detailed logging
 */
router.get('/', authenticateToken, async (req: Request, res: Response) => {
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
      
    } catch (apiError: any) {
      logger.error('Poloniex API Error:', {
        message: apiError.message,
        status: apiError.response?.status,
        statusText: apiError.response?.statusText,
        data: JSON.stringify(apiError.response?.data),
        headers: apiError.config?.headers
      });
      
      return res.json({
        success: false,
        error: 'Poloniex API call failed',
        step: 'api_call',
        details: {
          message: apiError.message,
          status: apiError.response?.status,
          data: apiError.response?.data
        }
      });
    }
    
  } catch (error: any) {
    logger.error('Test balance error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      step: 'unknown'
    });
  }
});

export default router;
