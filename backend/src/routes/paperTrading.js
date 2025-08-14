import express from 'express';

const router = express.Router();

// Health check for paper trading
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'paper-trading' });
});

// Get paper trading data
router.get('/data', (req, res) => {
  res.json({
    status: 'ok',
    data: [],
    timestamp: new Date().toISOString()
  });
});

export default router;
