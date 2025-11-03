import express from 'express';
import { logger } from '../utils/logger.js';
import { pool } from '../db/connection.js';

const router = express.Router();

/**
 * GET /api/status
 * Get system status information
 */
router.get('/', async (req, res) => {
  try {
    // Check database connectivity
    let databaseStatus = 'unknown';
    let databaseNote = 'Health check not implemented';
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      databaseStatus = 'healthy';
      databaseNote = 'Database connection successful';
    } catch (dbError) {
      logger.error('Database health check failed:', dbError);
      databaseStatus = 'unhealthy';
      databaseNote = `Database connection failed: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`;
    }

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
          status: databaseStatus,
          lastCheck: new Date().toISOString(),
          note: databaseNote
        },
        websocket: {
          status: 'unknown', // Placeholder - implement actual WS health check
          connections: 0,
          note: 'Health check not implemented'
        }
      },
      features: {
        liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
        mockMode: false, // Always use real data
        extensionSupported: true,
        webSocketConnected: true
      },
      notifications: [
        // Removed demo mode notification - always using real data
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
 * Simple health check endpoint with database connectivity
 */
router.get('/health', async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected'
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;