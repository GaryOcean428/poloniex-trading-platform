import express from 'express';
import { UserService } from '../services/userService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * POST /api/keys - Store new API credentials
 */
router.post('/', async (req, res) => {
  try {
    const { credentialName, apiKey, apiSecret, passphrase, permissions } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!credentialName || !apiKey || !apiSecret) {
      return res.status(400).json({
        error: 'Missing required fields: credentialName, apiKey, apiSecret'
      });
    }

    // Validate credential name
    if (credentialName.length < 3 || credentialName.length > 100) {
      return res.status(400).json({
        error: 'Credential name must be between 3 and 100 characters'
      });
    }

    // Default permissions if not provided
    const defaultPermissions = {
      read: true,
      trade: permissions?.trade || false,
      withdraw: permissions?.withdraw || false
    };

    const credential = await UserService.storeApiCredentials({
      userId,
      exchange: 'poloniex',
      credentialName,
      apiKey,
      apiSecret,
      passphrase,
      permissions: defaultPermissions
    });

    res.status(201).json({
      success: true,
      message: 'API credentials stored successfully',
      credential: {
        id: credential.id,
        credentialName: credential.credential_name,
        exchange: credential.exchange,
        permissions: credential.permissions,
        createdAt: credential.created_at
      }
    });
  } catch (error) {
    console.error('Error storing API credentials:', error);

    if (error.message.includes('duplicate key')) {
      return res.status(409).json({
        error: 'API credentials with this name already exist'
      });
    }

    res.status(500).json({
      error: 'Failed to store API credentials',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/keys - List user's API credentials (without sensitive data)
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const credentials = await UserService.listApiCredentials(userId);

    res.json({
      success: true,
      credentials: credentials.map(cred => ({
        id: cred.id,
        exchange: cred.exchange,
        credentialName: cred.credential_name,
        permissions: cred.permissions,
        isActive: cred.is_active,
        lastUsedAt: cred.last_used_at,
        createdAt: cred.created_at
      }))
    });
  } catch (error) {
    console.error('Error listing API credentials:', error);
    res.status(500).json({
      error: 'Failed to retrieve API credentials',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/keys/:id - Delete API credentials
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const credentialId = req.params.id;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(credentialId)) {
      return res.status(400).json({
        error: 'Invalid credential ID format'
      });
    }

    const deleted = await UserService.deleteApiCredentials(userId, credentialId);

    res.json({
      success: true,
      message: 'API credentials deleted successfully',
      deleted: {
        exchange: deleted.exchange,
        credentialName: deleted.credential_name
      }
    });
  } catch (error) {
    console.error('Error deleting API credentials:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'API credentials not found'
      });
    }

    res.status(500).json({
      error: 'Failed to delete API credentials',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/keys/:id/test - Test API credentials
 */
router.post('/:id/test', async (req, res) => {
  try {
    const userId = req.user.id;
    const credentialId = req.params.id;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(credentialId)) {
      return res.status(400).json({
        error: 'Invalid credential ID format'
      });
    }

    const testResult = await UserService.testApiCredentials(userId, credentialId);

    res.json({
      success: true,
      message: 'API credentials test completed',
      result: testResult
    });
  } catch (error) {
    console.error('Error testing API credentials:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'API credentials not found'
      });
    }

    res.status(400).json({
      error: 'API credentials test failed',
      details: error.message
    });
  }
});

/**
 * GET /api/keys/:id - Get specific API credential details (without sensitive data)
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const credentialId = req.params.id;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(credentialId)) {
      return res.status(400).json({
        error: 'Invalid credential ID format'
      });
    }

    const credentials = await UserService.listApiCredentials(userId);
    const credential = credentials.find(cred => cred.id === credentialId);

    if (!credential) {
      return res.status(404).json({
        error: 'API credentials not found'
      });
    }

    res.json({
      success: true,
      credential: {
        id: credential.id,
        exchange: credential.exchange,
        credentialName: credential.credential_name,
        permissions: credential.permissions,
        isActive: credential.is_active,
        lastUsedAt: credential.last_used_at,
        createdAt: credential.created_at
      }
    });
  } catch (error) {
    console.error('Error getting API credentials:', error);
    res.status(500).json({
      error: 'Failed to retrieve API credentials',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
