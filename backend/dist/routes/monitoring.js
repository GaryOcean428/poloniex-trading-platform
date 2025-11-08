import express from 'express';
import { monitoringService } from '../services/monitoringService.js';
import { authenticateToken } from '../middleware/auth.js';
const router = express.Router();
/**
 * GET /api/monitoring/health
 * Get system health status
 */
router.get('/health', (_req, res) => {
    const health = monitoringService.getSystemHealth();
    res.json(health);
});
/**
 * GET /api/monitoring/errors
 * Get recent errors (requires auth)
 */
router.get('/errors', authenticateToken, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const errors = monitoringService.getRecentErrors(limit);
    res.json({
        success: true,
        errors
    });
});
/**
 * GET /api/monitoring/warnings
 * Get recent warnings (requires auth)
 */
router.get('/warnings', authenticateToken, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const warnings = monitoringService.getRecentWarnings(limit);
    res.json({
        success: true,
        warnings
    });
});
/**
 * GET /api/monitoring/performance
 * Get performance statistics (requires auth)
 */
router.get('/performance', authenticateToken, (req, res) => {
    const operation = req.query.operation;
    const stats = monitoringService.getPerformanceStats(operation);
    res.json({
        success: true,
        stats
    });
});
/**
 * GET /api/monitoring/error-stats
 * Get error statistics (requires auth)
 */
router.get('/error-stats', authenticateToken, (_req, res) => {
    const stats = monitoringService.getErrorStats();
    res.json({
        success: true,
        stats
    });
});
export default router;
