import express from 'express';
const router = express.Router();
router.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'paper-trading',
        endpoints: [
            'GET /api/paper-trading/health',
            'GET /api/paper-trading/positions',
            'POST /api/paper-trading/trade'
        ]
    });
});
router.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'paper-trading' });
});
router.get('/positions', (req, res) => {
    res.json({
        status: 'ok',
        positions: [],
        timestamp: new Date().toISOString()
    });
});
router.post('/trade', (req, res) => {
    res.json({
        status: 'ok',
        trade: {
            id: `trade_${Date.now()}`,
            ...req.body,
            timestamp: new Date().toISOString(),
            mode: 'paper'
        }
    });
});
export default router;
