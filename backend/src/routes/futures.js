import express from 'express';

const router = express.Router();

// Root endpoint for futures
router.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'futures',
    endpoints: [
      'GET /api/futures/health',
      'GET /api/futures/data'
    ]
  });
});

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