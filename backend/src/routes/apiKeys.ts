/**
 * API Keys Routes (Frontend Compatibility Layer)
 * Provides compatibility with frontend ApiKeyManagement component
 * Uses apiCredentialsService for actual storage
 */

import express from 'express';
import { apiCredentialsService } from '../services/apiCredentialsService.js';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * Health check for API keys
 * GET /api/keys/health
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-keys' });
});

/**
 * Get all API credentials for the authenticated user
 * GET /api/keys
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    
    // Check if user has credentials for Poloniex
    const hasCredentials = await apiCredentialsService.hasCredentials(userId, 'poloniex');
    
    // Return credentials list (without exposing actual keys)
    const credentials = hasCredentials ? [{
      id: `${userId}-poloniex`,
      exchange: 'poloniex',
      credentialName: 'Poloniex API',
      permissions: {
        read: true,
        trade: true,
        withdraw: false
      },
      isActive: true,
      lastUsedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    }] : [];

    res.json({
      success: true,
      credentials,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('Error fetching API keys:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch API keys',
      credentials: []
    });
  }
});

/**
 * Create or update API credentials
 * POST /api/keys
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { apiKey, apiSecret, credentialName, passphrase, permissions } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        success: false,
        error: 'API key and secret are required'
      });
    }

    // Store credentials using the credentials service
    await apiCredentialsService.storeCredentials(userId, apiKey, apiSecret, 'poloniex');

    logger.info('API credentials stored successfully', {
      userId,
      credentialName: credentialName || 'Poloniex API',
      exchange: 'poloniex'
    });

    res.json({
      success: true,
      message: 'API credentials stored successfully',
      credential: {
        id: `${userId}-poloniex`,
        exchange: 'poloniex',
        credentialName: credentialName || 'Poloniex API',
        permissions: permissions || {
          read: true,
          trade: true,
          withdraw: false
        },
        isActive: true,
        createdAt: new Date().toISOString()
      }
    });
  } catch (error: any) {
    logger.error('Error storing API keys:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to store API credentials'
    });
  }
});

/**
 * Delete API credentials
 * DELETE /api/keys/:id
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;

    // Extract exchange from ID (format: userId-exchange)
    const exchange = id.split('-')[1] || 'poloniex';

    await apiCredentialsService.deleteCredentials(userId, exchange);

    logger.info('API credentials deleted', {
      userId,
      credentialId: id,
      exchange
    });

    res.json({
      success: true,
      message: 'API credentials deleted successfully'
    });
  } catch (error: any) {
    logger.error('Error deleting API keys:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete API credentials'
    });
  }
});

/**
 * Update API credential status (activate/deactivate)
 * PATCH /api/keys/:id
 */
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { id } = req.params;
    const { isActive } = req.body;

    // Extract exchange from ID
    const exchange = id.split('-')[1] || 'poloniex';

    if (isActive === false) {
      await apiCredentialsService.deactivateCredentials(userId, exchange);
    }

    logger.info('API credential status updated', {
      userId,
      credentialId: id,
      isActive
    });

    res.json({
      success: true,
      message: 'API credential status updated successfully'
    });
  } catch (error: any) {
    logger.error('Error updating API key status:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update API credential status'
    });
  }
});

export default router;
