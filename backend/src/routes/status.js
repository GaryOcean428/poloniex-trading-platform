import express from 'express';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/status
 * Get system status information
 */
router.get('/', async (req, res) => {
  try {
    const status = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      services: {
        api: {
          status: 'healthy',
          uptime: process.uptime(),
          version: process.env.npm_package_version || '1.0.0'
        },
        database: {
          status: 'unknown', // Placeholder - implement actual DB health check
          lastCheck: new Date().toISOString(),
          note: 'Health check not implemented'
        },
        websocket: {
          status: 'unknown', // Placeholder - implement actual WS health check
          connections: 0,
          note: 'Health check not implemented'
        }
      },
      features: {
        liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
        mockMode: process.env.MOCK_MODE === 'true' || process.env.NODE_ENV !== 'production',
        extensionSupported: true,
        webSocketConnected: true
      },
      notifications: [
        ...(process.env.NODE_ENV !== 'production' ? [{
          id: 'demo-mode',
          type: 'warning',
          title: 'Demo Mode Active',
          message: 'Using simulated trading data',
          details: [
            'No real trades will be executed',
            'All data is simulated for testing purposes'
          ],
          dismissible: true
        }] : []),
        ...(process.env.LIVE_TRADING_ENABLED !== 'true' ? [{
          id: 'live-trading-disabled',
          type: 'info',
          title: 'Live Trading Disabled',
          message: 'Live trading mode is currently disabled',
          details: [
            'Enable live trading in environment configuration',
            'Ensure API credentials are properly configured'
          ],
          dismissible: false
        }] : []),
        {
          id: 'extension-available',
          type: 'info',
          title: 'Browser Extension Available',
          message: 'Get our Chrome extension for enhanced trading experience',
          details: [
            'Trade directly from your browser',
            'Real-time notifications and alerts',
            'Quick access to your portfolio'
          ],
          dismissible: true,
          actionUrl: '/extension'
        }
      ]
    };

    res.json(status);
  } catch (error) {
    logger.error('Error fetching status:', error);
    res.status(500).json({
      error: 'Failed to fetch status',
      message: error.message
    });
  }
});

/**
 * GET /api/status/health
 * Simple health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

export default router;