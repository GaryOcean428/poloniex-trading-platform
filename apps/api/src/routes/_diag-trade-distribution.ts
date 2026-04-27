/**
 * TEMPORARY DIAGNOSTIC ROUTE — to be reverted after data collection.
 *
 * Auth: x-diag-token header must equal INTERSERVICE_AUTH_TOKEN.
 *
 * Returns the 72h exit-reason × mode distribution for autonomous_trades
 * to test two hypotheses about the symmetric small-win/small-loss
 * pattern observed 2026-04-21 → 2026-04-24:
 *
 *   H1 — asymmetric thresholds: most losses are stop_loss while most
 *        wins are trailing_harvest, indicating the SL hits before the
 *        harvest activates → controlled losses but tiny wins.
 *
 *   H2 — DRIFT mode never fires: monkey_decisions never picks DRIFT
 *        despite a flat tape, so Monkey trades in conditions where
 *        her v0.6.5 hasDirection (|basinDir| > 0.30) gate should
 *        have routed her to observe-only.
 *
 * Production schema (per polytrade_schema_drift memory): autonomous_trades
 * uses exit_time / exit_reason, NOT closed_at / close_reason. The base
 * migration shows the older names; the column rename has happened in
 * prod via an unmigrated DDL.
 */
import express from 'express';
import type { Request, Response } from 'express';
import { pool } from '../db/connection.js';

const router = express.Router();

router.get('/trade-distribution', async (req: Request, res: Response) => {
  if (req.header('x-diag-token') !== process.env.INTERSERVICE_AUTH_TOKEN) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  try {
    // Bucket by exit_reason — count + sum + mean PnL.
    const byReason = await pool.query(`
      SELECT
        COALESCE(exit_reason, '<null>') AS exit_reason,
        COUNT(*)::int                   AS n,
        COALESCE(SUM(pnl::numeric), 0)::float AS pnl_sum,
        COALESCE(AVG(pnl::numeric), 0)::float AS pnl_mean,
        COALESCE(MIN(pnl::numeric), 0)::float AS pnl_min,
        COALESCE(MAX(pnl::numeric), 0)::float AS pnl_max
      FROM autonomous_trades
      WHERE status = 'closed'
        AND exit_time > NOW() - INTERVAL '72 hours'
      GROUP BY exit_reason
      ORDER BY n DESC
    `);

    // Bucket by side — should be roughly balanced if Monkey trades both ways.
    const bySide = await pool.query(`
      SELECT
        side,
        COUNT(*)::int                   AS n,
        COALESCE(AVG(pnl::numeric), 0)::float AS pnl_mean
      FROM autonomous_trades
      WHERE status = 'closed'
        AND exit_time > NOW() - INTERVAL '72 hours'
      GROUP BY side
      ORDER BY n DESC
    `);

    // Bucket by reason source (live_signal vs monkey vs FAT) — entry source
    // governs which exit-decision path the trade walked through.
    const byEngine = await pool.query(`
      SELECT
        CASE
          WHEN reason LIKE 'live_signal|%'   THEN 'live_signal'
          WHEN reason LIKE 'monkey|%'        THEN 'monkey'
          WHEN reason LIKE '%FAT%'           THEN 'FAT'
          WHEN reason = 'reconciled'         THEN 'reconciler'
          ELSE 'other'
        END AS engine,
        COUNT(*)::int                  AS n,
        COALESCE(AVG(pnl::numeric), 0)::float AS pnl_mean,
        COALESCE(SUM(pnl::numeric), 0)::float AS pnl_sum
      FROM autonomous_trades
      WHERE status = 'closed'
        AND exit_time > NOW() - INTERVAL '72 hours'
      GROUP BY engine
      ORDER BY n DESC
    `);

    // Mode distribution from monkey_decisions (was Monkey ever in DRIFT?).
    // proposed_action is the field; mode lives inside derivation jsonb.
    const byMode = await pool.query(`
      SELECT
        derivation->>'mode'              AS mode_field,
        derivation->'mode'->>'value'     AS mode_value,
        COUNT(*)::int                    AS n
      FROM monkey_decisions
      WHERE at > NOW() - INTERVAL '72 hours'
      GROUP BY mode_field, mode_value
      ORDER BY n DESC
      LIMIT 30
    `);

    // Action distribution as a sanity check.
    const byAction = await pool.query(`
      SELECT
        proposed_action,
        executed,
        COUNT(*)::int AS n
      FROM monkey_decisions
      WHERE at > NOW() - INTERVAL '72 hours'
      GROUP BY proposed_action, executed
      ORDER BY n DESC
    `);

    // basinDirection distribution from monkey_decisions derivation (H2).
    // Histogram bucketed in 0.10 increments.
    const basinHist = await pool.query(`
      SELECT
        FLOOR((derivation->'basinDir')::float * 10) / 10 AS basin_bucket,
        COUNT(*)::int AS n
      FROM monkey_decisions
      WHERE at > NOW() - INTERVAL '72 hours'
        AND derivation->'basinDir' IS NOT NULL
      GROUP BY basin_bucket
      ORDER BY basin_bucket
    `);

    // Total over the window.
    const total = await pool.query(`
      SELECT
        COUNT(*)::int                   AS n,
        COALESCE(SUM(pnl::numeric), 0)::float AS pnl_sum,
        COALESCE(AVG(pnl::numeric), 0)::float AS pnl_mean
      FROM autonomous_trades
      WHERE status = 'closed'
        AND exit_time > NOW() - INTERVAL '72 hours'
    `);

    res.json({
      window: '72h',
      total: total.rows[0],
      by_exit_reason: byReason.rows,
      by_side: bySide.rows,
      by_engine: byEngine.rows,
      monkey_mode_distribution: byMode.rows,
      monkey_action_distribution: byAction.rows,
      basin_direction_histogram: basinHist.rows,
    });
  } catch (err) {
    res.status(500).json({
      error: 'query_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
