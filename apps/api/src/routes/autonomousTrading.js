import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import fullyAutonomousTrader from '../services/fullyAutonomousTrader.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Root endpoint for autonomous trading
router.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'autonomous-trading', 
    endpoints: [
      'GET /api/autonomous-trading/health - Service health check',
      'GET /api/autonomous-trading/data - Get autonomous trading data (alias for /api/autonomous/status)',
      'POST /api/autonomous-trading/start - Start autonomous trading (alias for /api/autonomous/enable)',
      'POST /api/autonomous-trading/stop - Stop autonomous trading (alias for /api/autonomous/disable)'
    ]
  });
});

// Health check for autonomous trading
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'autonomous-trading' });
});

// Get autonomous trading data - delegates to the real autonomous trading status
router.get('/data', authenticateToken, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const status = await fullyAutonomousTrader.getStatus(userId);
    res.json({
      status: 'ok',
      data: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting autonomous trading data', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to get autonomous trading data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Start autonomous trading - delegates to the real autonomous trading system
router.post('/start', authenticateToken, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const config = req.body;

    await fullyAutonomousTrader.enableAutonomousTrading(userId, config);

    res.json({
      status: 'ok',
      action: 'start',
      message: 'Autonomous trading started',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error starting autonomous trading', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to start autonomous trading',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Stop autonomous trading - delegates to the real autonomous trading system
router.post('/stop', authenticateToken, async (req, res) => {
  try {
    const userId = String(req.user.id);

    await fullyAutonomousTrader.disableAutonomousTrading(userId);

    res.json({
      status: 'ok',
      action: 'stop',
      message: 'Autonomous trading stopped',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error stopping autonomous trading', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to stop autonomous trading',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
