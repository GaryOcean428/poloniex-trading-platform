import express from 'express';

const router = express.Router();

// Health check for futures
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'futures' });
});

// Get futures data
router.get('/data', (req, res) => {
  res.json({
    status: 'ok',
    data: [],
    timestamp: new Date().toISOString()
  });
});

export default router;
