import express from 'express';
import { logger } from '../utils/logger.js';
const router = express.Router();
router.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'autonomous-trading',
        endpoints: [
            'GET /api/autonomous-trading/health - Service health check',
            'GET /api/autonomous-trading/data - Get autonomous trading data',
            'POST /api/autonomous-trading/start - Start autonomous trading',
            'POST /api/autonomous-trading/stop - Stop autonomous trading'
        ]
    });
});
router.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'autonomous-trading' });
});
router.get('/data', (req, res) => {
    res.json({
        status: 'ok',
        data: [],
        timestamp: new Date().toISOString()
    });
});
router.post('/start', (req, res) => {
    try {
        res.json({
            status: 'ok',
            action: 'start',
            message: 'Autonomous trading started',
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        logger.error('Error starting autonomous trading', { error: error.message, stack: error.stack });
        res.status(500).json({
            error: 'Failed to start autonomous trading',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
router.post('/stop', (req, res) => {
    try {
        res.json({
            status: 'ok',
            action: 'stop',
            message: 'Autonomous trading stopped',
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        logger.error('Error stopping autonomous trading', { error: error.message, stack: error.stack });
        res.status(500).json({
            error: 'Failed to stop autonomous trading',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
export default router;
