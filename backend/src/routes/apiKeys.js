import express from 'express';

const router = express.Router();

// Health check for API keys
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-keys' });
});

// Get API keys
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    keys: [],
    timestamp: new Date().toISOString()
  });
});

export default router;
