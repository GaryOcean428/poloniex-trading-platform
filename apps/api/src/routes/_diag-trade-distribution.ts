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

    // Mode distribution from monkey_decisions — aggregated by mode_value
    // alone (not the full derivation JSON, which fragments by per-tick noise).
    // H2 hypothesis: DRIFT count == 0 in 72h while market has been flat,
    // implying hasDirection gate (|basinDir| > 0.30) is too loose and
    // Monkey trades flat-tape conditions.
    const byMode = await pool.query(`
      SELECT
        derivation->'mode'->>'value' AS mode_value,
        COUNT(*)::int                AS n
      FROM monkey_decisions
      WHERE at > NOW() - INTERVAL '72 hours'
      GROUP BY mode_value
      ORDER BY n DESC
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

    // basinDirection distribution — text path because JSONB scalar values
    // come out as text and need explicit cast. Bucket = round to 0.1.
    // hasDirection gate fires at |basinDir| > 0.30 — H2 wants to know
    // what the distribution looks like and whether 0.30 is too loose.
    const basinHist = await pool.query(`
      SELECT
        ROUND((derivation->>'basinDir')::numeric, 1) AS basin_bucket,
        COUNT(*)::int AS n
      FROM monkey_decisions
      WHERE at > NOW() - INTERVAL '72 hours'
        AND derivation->>'basinDir' IS NOT NULL
        AND derivation->>'basinDir' ~ '^-?[0-9.]+$'
      GROUP BY basin_bucket
      ORDER BY basin_bucket
    `);

    // Hits-of-DRIFT-mode count specifically — definitive answer for H2.
    const driftCount = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE derivation->'mode'->>'value' = 'drift')::int   AS drift_n,
        COUNT(*) FILTER (WHERE derivation->'mode'->>'value' = 'exploration')::int AS exploration_n,
        COUNT(*) FILTER (WHERE derivation->'mode'->>'value' = 'investigation')::int AS investigation_n,
        COUNT(*) FILTER (WHERE derivation->'mode'->>'value' = 'integration')::int  AS integration_n,
        COUNT(*)::int AS total_decisions
      FROM monkey_decisions
      WHERE at > NOW() - INTERVAL '72 hours'
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
      monkey_mode_counts: driftCount.rows[0],
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
