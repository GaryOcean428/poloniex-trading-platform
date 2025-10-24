import express from 'express';
const router = express.Router();
router.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'api-keys' });
});
router.get('/', (req, res) => {
    res.json({
        status: 'ok',
        keys: [],
        timestamp: new Date().toISOString()
    });
});
export default router;
