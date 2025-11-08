import express from 'express';
const router = express.Router();
// Version endpoint to verify deployment
router.get('/version', (req, res) => {
    res.json({
        version: '2.0.0-FIXED',
        timestamp: new Date().toISOString(),
        commit: '2a968e9',
        message: 'Pre-built dist with permissions fix',
        userServiceFixed: true
    });
});
export default router;
