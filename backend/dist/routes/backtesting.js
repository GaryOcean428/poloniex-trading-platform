import express from 'express';
const router = express.Router();
// Root endpoint for backtesting
router.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'backtesting',
        endpoints: [
            'GET /api/backtesting/health',
            'GET /api/backtesting/results'
        ]
    });
});
// Health check for backtesting
router.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'backtesting' });
});
// Get backtesting results
router.get('/results', (req, res) => {
    res.json({
        status: 'ok',
        results: [],
        timestamp: new Date().toISOString()
    });
});
export default router;
