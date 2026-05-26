/**
 * pnlReconciliationPeriodic.ts — every-N-seconds row-level alert (#932).
 *
 * Periodic scanner that runs in-process inside the monkey kernel.
 * Scans the most recent closed autonomous_trades rows for divergence
 * between recorded pnl and `qty × (exit - entry) × sideSign`. Emits
 * structured alerts on any phantom-class (>$5) divergence so paging
 * wires fire within minutes of a regression.
 *
 * Complementary to:
 *   - SAFE_PNL_FROM_ROW (#931) — primary fix at the DB write boundary
 *   - reconcilePnl() — per-write defense in depth at the chemistry
 *     boundary
 *   - pnlReconciliationNightly — once-per-day batch backstop
 *
 * Wire from MonkeyKernel.tick() or a setInterval; runs cheaply with a
 * short LIMIT and an exit_time window.
 */

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

const SCAN_WINDOW_MINUTES_DEFAULT = 15;
const DRIFT_THRESHOLD_USD = 0.5;
const PHANTOM_THRESHOLD_USD = 5.0;
const SCAN_LIMIT = 200;

export interface PeriodicScanResult {
  windowMinutes: number;
  scannedRows: number;
  divergedRows: number;
  phantomRows: number;
  newPhantomIds: string[];
}

/**
 * In-process state — tracks which row ids have already been alerted so
 * a single phantom only fires once even if the scan window covers it
 * for multiple iterations. Bounded LRU (max 500 ids) to keep memory
 * flat over long-running kernel processes.
 */
const alertedPhantomIds = new Set<string>();
const ALERTED_CACHE_MAX = 500;

function rememberAlerted(id: string): void {
  if (alertedPhantomIds.size >= ALERTED_CACHE_MAX) {
    const oldest = alertedPhantomIds.values().next().value;
    if (oldest !== undefined) alertedPhantomIds.delete(oldest);
  }
  alertedPhantomIds.add(id);
}

/**
 * Scan the last `windowMinutes` of closed monkey rows; alert on phantoms.
 * Returns a structured summary even when nothing diverged — caller can
 * publish counters to a metrics endpoint.
 */
export async function runPeriodicPnlScan(
  windowMinutes = SCAN_WINDOW_MINUTES_DEFAULT,
): Promise<PeriodicScanResult> {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  const result = await pool.query<{
    id: string;
    symbol: string;
    side: string;
    exit_reason: string | null;
    db_pnl: string;
    calc_pnl: string;
    divergence: string;
  }>(
    `SELECT id, symbol, side, exit_reason,
            pnl AS db_pnl,
            CASE side
              WHEN 'buy'   THEN quantity * (exit_price - entry_price)
              WHEN 'long'  THEN quantity * (exit_price - entry_price)
              WHEN 'sell'  THEN quantity * (entry_price - exit_price)
              WHEN 'short' THEN quantity * (entry_price - exit_price)
            END AS calc_pnl,
            ABS(pnl - CASE side
              WHEN 'buy'   THEN quantity * (exit_price - entry_price)
              WHEN 'long'  THEN quantity * (exit_price - entry_price)
              WHEN 'sell'  THEN quantity * (entry_price - exit_price)
              WHEN 'short' THEN quantity * (entry_price - exit_price)
            END) AS divergence
       FROM autonomous_trades
      WHERE engine_type LIKE 'monkey%'
        AND pnl IS NOT NULL
        AND exit_price IS NOT NULL
        AND entry_price IS NOT NULL
        AND exit_time >= $1::timestamptz
      ORDER BY exit_time DESC
      LIMIT $2`,
    [since.toISOString(), SCAN_LIMIT],
  );

  let divergedRows = 0;
  let phantomRows = 0;
  const newPhantomIds: string[] = [];

  for (const row of result.rows) {
    const divergence = Number(row.divergence);
    if (divergence > PHANTOM_THRESHOLD_USD) {
      phantomRows++;
      if (!alertedPhantomIds.has(row.id)) {
        newPhantomIds.push(row.id);
        rememberAlerted(row.id);
        logger.error('[pnl_periodic_scan] NEW phantom detected', {
          rowId: row.id,
          symbol: row.symbol,
          side: row.side,
          exitReason: row.exit_reason,
          dbPnl: Number(row.db_pnl),
          calcPnl: Number(row.calc_pnl),
          divergence,
        });
      }
    } else if (divergence > DRIFT_THRESHOLD_USD) {
      divergedRows++;
    }
  }

  // Summary log emits regardless of findings so absence-of-alert is also
  // a positive signal (operator can see the scan is healthy).
  if (phantomRows === 0 && divergedRows === 0) {
    // Quiet success — log at debug to avoid flooding.
    logger.debug('[pnl_periodic_scan] clean window', {
      windowMinutes,
      scannedRows: result.rows.length,
    });
  } else {
    logger.info('[pnl_periodic_scan] summary', {
      windowMinutes,
      scannedRows: result.rows.length,
      divergedRows,
      phantomRows,
      newPhantomCount: newPhantomIds.length,
    });
  }

  return {
    windowMinutes,
    scannedRows: result.rows.length,
    divergedRows,
    phantomRows,
    newPhantomIds,
  };
}

/**
 * Test-only: clear the in-memory alerted-ids cache.
 */
export function _resetAlertedCacheForTests(): void {
  alertedPhantomIds.clear();
}
