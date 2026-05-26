/**
 * predictionResidualJob.ts — Phase 2 of issue #941 prediction-corpus.
 *
 * Matrix tier-3 directive (2026-05-27): every 60s, scan kernel_predictions
 * rows whose predicted_horizon_seconds has elapsed and don't yet have a
 * residual row at that horizon. Compute realised PnL at the horizon from
 * the trade's actual pnl trajectory; write a kernel_outcome_residuals row.
 *
 * **Idempotent**: candidate query filters out any prediction that already
 * has a residual row, so each prediction gets exactly one residual at the
 * elapsed-time the job first evaluated it. One process owns the timer, so
 * there is no concurrent-scan race to defend against.
 *
 * **P15-safe**: try/catch per row, log-and-skip on error, never blocks
 * live writes. The kernel decision path is independent of this job's
 * success or failure.
 *
 * **At trade close**: populate `autonomous_trades.final_residual_usdt`
 * and `final_residual_normalized` from the prediction closest to the
 * exit_time (the kernel's most recent forecast before the close).
 *
 * Pairs with Phase 3 (`predictionRewardEmitter.ts`), which reads from
 * the residual rows this job writes to compute MAD-normalised
 * direction-match and calibration composites for the chemistry feed.
 *
 * **Doctrinal anchors**:
 * - P5 (Observer Sets All Params): no env knobs in this module.
 *   Scan cadence (60s) is a structural setInterval; thresholds for
 *   "horizon elapsed" come from the prediction row's own
 *   predicted_horizon_seconds. No operator-tunable constants.
 * - P15 (Fail-Closed Safety): every DB call is try/catch wrapped.
 */

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

// Structural constants (not operator knobs).
// 60s scan cadence: matches the typical kernel tick × 2 (30s × 2 ≈ 60s
// gives a one-tick buffer). Faster scans would multiply DB load without
// new information; slower scans would delay chemistry feedback.
const SCAN_INTERVAL_MS = 60_000;
// Maximum rows per scan — bounded to keep individual scans short.
// At kernel ~3 snapshots/min × 2 symbols × 2 kernels = 12/min steady
// state; 200 leaves comfortable headroom for catch-up after downtime.
const SCAN_LIMIT = 200;

export interface ResidualScanResult {
  scannedRows: number;
  residualsWritten: number;
  errors: number;
  finalResidualsBackfilled: number;
}

/**
 * One scan pass: find ready predictions, compute residuals, write rows.
 * Returns counts for telemetry.
 *
 * "Ready" = `predicted_horizon_seconds` is non-null AND
 * `now() - snapshot_at >= predicted_horizon_seconds` AND no residual
 * row exists at the elapsed time horizon.
 */
export async function scanPredictionResiduals(): Promise<ResidualScanResult> {
  const result: ResidualScanResult = {
    scannedRows: 0,
    residualsWritten: 0,
    errors: 0,
    finalResidualsBackfilled: 0,
  };

  try {
    // Find predictions whose horizon has elapsed and lack a residual at
    // ANY horizon (we write one residual per (prediction, horizon-bucket)
    // pair; bucket = floor of actual elapsed seconds, so re-running
    // doesn't duplicate when the elapsed time crosses several "ticks"
    // of the same bucket).
    const candidates = await pool.query<{
      id: string;
      trade_id: string | null;
      snapshot_at: Date;
      predicted_horizon_seconds: number;
      predicted_terminal_pnl_usdt: number | null;
      predicted_pnl_stddev_usdt: number | null;
      predicted_direction: number | null;
    }>(
      `SELECT p.id, p.trade_id, p.snapshot_at,
              p.predicted_horizon_seconds,
              p.predicted_terminal_pnl_usdt,
              p.predicted_pnl_stddev_usdt,
              p.predicted_direction
         FROM kernel_predictions p
         WHERE p.predicted_horizon_seconds IS NOT NULL
           AND p.predicted_horizon_seconds > 0
           AND EXTRACT(EPOCH FROM (NOW() - p.snapshot_at)) >= p.predicted_horizon_seconds
           AND NOT EXISTS (
             SELECT 1 FROM kernel_outcome_residuals r
              WHERE r.prediction_id = p.id
           )
         ORDER BY p.snapshot_at DESC
         LIMIT $1`,
      [SCAN_LIMIT],
    );
    result.scannedRows = candidates.rows.length;

    for (const row of candidates.rows) {
      try {
        const predictionId = row.id;
        const snapshotMs = row.snapshot_at.getTime();
        const elapsedSec = (Date.now() - snapshotMs) / 1000;
        const horizonSec = Number(row.predicted_horizon_seconds);
        const predictedTerminal = Number(row.predicted_terminal_pnl_usdt ?? 0);
        const predictedStddev = Math.max(
          1e-9,
          Number(row.predicted_pnl_stddev_usdt ?? 1e-9),
        );
        const predictedDirection = Number(row.predicted_direction ?? 0);

        // Realised PnL: if there's a parent trade, look up its current
        // pnl (closed) or the kernel-computed unrealized pnl proxy
        // (open). For closed trades, `pnl` is authoritative. For open
        // trades, we use 0 as a baseline — the residual still gets a
        // row so downstream telemetry sees the prediction's status,
        // but the realised value is "not yet decided."
        let realisedPnl = 0;
        if (row.trade_id) {
          const tradeQ = await pool.query<{ pnl: string | null; status: string }>(
            `SELECT pnl, status FROM autonomous_trades WHERE id = $1`,
            [row.trade_id],
          );
          if (tradeQ.rows[0]?.status === 'closed') {
            realisedPnl = Number(tradeQ.rows[0].pnl ?? 0);
          }
        }

        // Compute residual at the actual elapsed time (the horizon may
        // have been overshot by some seconds depending on scan cadence).
        // The predicted_pnl_at_eval is a linear interpolation toward
        // the terminal forecast based on the elapsed/horizon ratio.
        // This is the simplest faithful interpolation; future revisions
        // could use the kernel's actual forecast curve if exposed.
        const linearProgress = Math.min(1, elapsedSec / Math.max(1e-9, horizonSec));
        const predictedAtEval = predictedTerminal * linearProgress;
        const residual = realisedPnl - predictedAtEval;
        const residualNormalized = residual / predictedStddev;
        const directionMatch =
          Math.sign(realisedPnl) === Math.sign(predictedDirection)
          && predictedDirection !== 0;
        const within1Sigma = Math.abs(residualNormalized) <= 1;
        const within2Sigma = Math.abs(residualNormalized) <= 2;

        await pool.query(
          `INSERT INTO kernel_outcome_residuals (
             prediction_id, time_since_prediction_s,
             predicted_pnl_at_eval_usdt, realised_pnl_at_eval_usdt,
             residual_usdt, residual_normalized,
             direction_match, within_1_sigma, within_2_sigma
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            predictionId,
            elapsedSec,
            predictedAtEval,
            realisedPnl,
            residual,
            residualNormalized,
            directionMatch,
            within1Sigma,
            within2Sigma,
          ],
        );
        result.residualsWritten += 1;
      } catch (err) {
        result.errors += 1;
        logger.warn('[predictionResidualJob] row scan failed — skipped', {
          predictionId: row.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Backfill autonomous_trades.final_residual_* for any trade that just
    // closed and has residual data from this scan. The "closest prediction
    // to exit_time" is the kernel's most recent forecast before close.
    try {
      const backfill = await pool.query<{ id: string }>(
        `UPDATE autonomous_trades t
            SET final_residual_usdt =
                  (SELECT r.residual_usdt
                     FROM kernel_outcome_residuals r
                     JOIN kernel_predictions p ON p.id = r.prediction_id
                    WHERE p.trade_id = t.id
                    ORDER BY p.snapshot_at DESC
                    LIMIT 1),
                final_residual_normalized =
                  (SELECT r.residual_normalized
                     FROM kernel_outcome_residuals r
                     JOIN kernel_predictions p ON p.id = r.prediction_id
                    WHERE p.trade_id = t.id
                    ORDER BY p.snapshot_at DESC
                    LIMIT 1)
          WHERE t.status = 'closed'
            AND t.final_residual_usdt IS NULL
            AND EXISTS (
              SELECT 1 FROM kernel_predictions p2
                WHERE p2.trade_id = t.id
            )
          RETURNING id`,
      );
      result.finalResidualsBackfilled = backfill.rowCount ?? 0;
    } catch (err) {
      logger.warn('[predictionResidualJob] final-residual backfill failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    if (result.residualsWritten > 0 || result.finalResidualsBackfilled > 0) {
      logger.info('[predictionResidualJob] scan complete', result);
    }
  } catch (err) {
    logger.warn('[predictionResidualJob] scan errored — next pass will retry', {
      err: err instanceof Error ? err.message : String(err),
    });
    result.errors += 1;
  }

  return result;
}

/**
 * Start the periodic scanner. Returns the timer handle so callers can
 * cancel during shutdown.
 *
 * Cadence is structural (60s); not exposed as a knob.
 */
export function startPredictionResidualJob(): NodeJS.Timeout {
  // Run once on start to catch up any residuals that elapsed during
  // downtime, then schedule periodic re-scans.
  void scanPredictionResiduals();
  return setInterval(() => {
    void scanPredictionResiduals();
  }, SCAN_INTERVAL_MS);
}
