/**
 * TEMPORARY DIAGNOSTIC — to be reverted after tagging completes.
 *
 * Auth: x-diag-token header must equal INTERSERVICE_AUTH_TOKEN.
 *
 * Purpose: tag any open autonomous_trades rows whose entry_time predates
 * the basinDirection saturation fix (commit 589c775, deployed
 * 2026-04-27T02:39:32Z) with `|pre_fix_legacy` appended to the reason
 * column. These positions were opened under broken inputs (basinDir
 * pegged at -1.0) and shouldn't be counted in post-fix performance.
 *
 * Routes:
 *   GET  /api/_diag/legacy-status — list open trades with entry_time
 *        and whether they're already tagged
 *   POST /api/_diag/legacy-tag    — append |pre_fix_legacy to reason
 *        for open trades opened pre-fix; idempotent
 */
import express from 'express';
import type { Request, Response } from 'express';
import { pool } from '../db/connection.js';

const router = express.Router();

// Basin fix deploy time: 2026-04-27T02:39:32Z (commit 589c775).
const BASIN_FIX_DEPLOY_AT = '2026-04-27T02:39:32Z';

function authOk(req: Request): boolean {
  return req.header('x-diag-token') === process.env.INTERSERVICE_AUTH_TOKEN;
}

router.get('/legacy-status', async (req: Request, res: Response) => {
  if (!authOk(req)) { res.status(403).json({ error: 'forbidden' }); return; }
  try {
    const rows = await pool.query(
      `SELECT id, symbol, side, entry_price, quantity, status,
              created_at, reason,
              (created_at < $1::timestamptz)            AS is_pre_fix,
              (reason LIKE '%|pre_fix_legacy%')         AS already_tagged
         FROM autonomous_trades
        WHERE status = 'open'
        ORDER BY created_at ASC`,
      [BASIN_FIX_DEPLOY_AT],
    );
    res.json({
      basin_fix_deploy_at: BASIN_FIX_DEPLOY_AT,
      n_open: rows.rows.length,
      n_pre_fix: rows.rows.filter((r: any) => r.is_pre_fix && !r.already_tagged).length,
      n_already_tagged: rows.rows.filter((r: any) => r.already_tagged).length,
      rows: rows.rows,
    });
  } catch (err) {
    res.status(500).json({
      error: 'query_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/legacy-tag', async (req: Request, res: Response) => {
  if (!authOk(req)) { res.status(403).json({ error: 'forbidden' }); return; }
  try {
    const result = await pool.query(
      `UPDATE autonomous_trades
          SET reason = reason || '|pre_fix_legacy'
        WHERE status = 'open'
          AND created_at < $1::timestamptz
          AND reason NOT LIKE '%|pre_fix_legacy%'
        RETURNING id, symbol, side, created_at, reason`,
      [BASIN_FIX_DEPLOY_AT],
    );
    res.json({
      basin_fix_deploy_at: BASIN_FIX_DEPLOY_AT,
      tagged: result.rows.length,
      rows: result.rows,
    });
  } catch (err) {
    res.status(500).json({
      error: 'update_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
