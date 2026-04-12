import express, { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { stateReconciliationService } from '../services/stateReconciliationService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/reconciliation/status
 * Returns the latest reconciliation result for the authenticated user.
 * Triggers a fresh reconciliation run if no cached result exists.
 */
router.get('/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user.id);

    let result = stateReconciliationService.getLatestResult(userId);

    if (!result) {
      // Run reconciliation on-demand if no cached result is available
      result = await stateReconciliationService.reconcile(userId);
    }

    res.json({
      success: true,
      reconciliation: {
        userId: result.userId,
        timestamp: result.timestamp,
        orphanedPositions: result.orphans,
        ghostRecords: result.ghosts,
        balanceDrift: result.balanceDrift,
        exchangeBalance: result.exchangeBalance,
        dbBalance: result.dbBalance,
        error: result.error ?? null
      }
    });
  } catch (error: unknown) {
    logger.error('Error fetching reconciliation status:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch reconciliation status' });
  }
});

export default router;
