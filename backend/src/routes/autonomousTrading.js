import express from 'express';

const router = express.Router();

// Health check for autonomous trading
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'autonomous-trading' });
});

// Get autonomous trading data
router.get('/data', (req, res) => {
  res.json({
    status: 'ok',
    data: [],
    timestamp: new Date().toISOString()
  });
});

export default router;
