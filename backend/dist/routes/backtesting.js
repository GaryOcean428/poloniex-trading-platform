import express from 'express';
const router = express.Router();
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
router.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'backtesting' });
});
router.get('/results', (req, res) => {
    res.json({
        status: 'ok',
        results: [],
        timestamp: new Date().toISOString()
    });
});
export default router;
