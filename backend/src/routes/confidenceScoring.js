import express from 'express';

const router = express.Router();

// Root endpoint for confidence scoring
router.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'confidence-scoring', endpoints: ['/health', '/scores'] });
});

// Health check for confidence scoring
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'confidence-scoring' });
});

// Get confidence scores
router.get('/scores', (req, res) => {
  res.json({
    status: 'ok',
    scores: [],
    timestamp: new Date().toISOString()
  });
});

export default router;
