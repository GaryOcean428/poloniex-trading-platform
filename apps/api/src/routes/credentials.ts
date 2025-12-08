/**
 * API Credentials Routes
 * Endpoints for managing encrypted API credentials
 */

import express from 'express';
import { apiCredentialsService } from '../services/apiCredentialsService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * Store or update API credentials
 * POST /api/credentials
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { apiKey, apiSecret, exchange = 'poloniex' } = req.body;
    const userId = (req as any).user.userId;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'API key and secret are required' });
    }

    await apiCredentialsService.storeCredentials(userId, apiKey, apiSecret, exchange);

    res.json({
      success: true,
      message: 'API credentials stored successfully'
    });
  } catch (error: any) {
    console.error('Error storing credentials:', error);
    res.status(500).json({ error: error.message || 'Failed to store credentials' });
  }
});

/**
 * Check if user has credentials
 * GET /api/credentials/status
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const exchange = req.query.exchange as string || 'poloniex';

    const hasCredentials = await apiCredentialsService.hasCredentials(userId, exchange);

    res.json({
      hasCredentials,
      exchange
    });
  } catch (error: any) {
    console.error('Error checking credentials:', error);
    res.status(500).json({ error: error.message || 'Failed to check credentials' });
  }
});

/**
 * Delete API credentials
 * DELETE /api/credentials
 */
router.delete('/', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const exchange = req.query.exchange as string || 'poloniex';

    await apiCredentialsService.deleteCredentials(userId, exchange);

    res.json({
      success: true,
      message: 'API credentials deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting credentials:', error);
    res.status(500).json({ error: error.message || 'Failed to delete credentials' });
  }
});

/**
 * Deactivate API credentials (soft delete)
 * POST /api/credentials/deactivate
 */
router.post('/deactivate', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const exchange = req.body.exchange || 'poloniex';

    await apiCredentialsService.deactivateCredentials(userId, exchange);

    res.json({
      success: true,
      message: 'API credentials deactivated successfully'
    });
  } catch (error: any) {
    console.error('Error deactivating credentials:', error);
    res.status(500).json({ error: error.message || 'Failed to deactivate credentials' });
  }
});

export default router;
