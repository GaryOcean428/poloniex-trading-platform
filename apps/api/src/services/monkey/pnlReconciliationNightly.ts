/**
 * pnlReconciliationNightly.ts — nightly DB↔calculated pnl reconciliation (#932).
 *
 * Runs once per day, audits the last 24h of monkey close rows in
 * autonomous_trades, identifies any rows whose recorded pnl diverges
 * from `qty × (exit - entry) × sideSign`, and produces a structured
 * summary for the operator.
 *
 * Complementary to:
 *   - SAFE_PNL_FROM_ROW (#931) — primary fix at the DB write boundary
 *   - reconcilePnl() (this module's row-level companion) — per-write alert
 *
 * The row-level alert catches phantoms within one tick of writing. This
 * nightly job is the systemic backstop: it catches anything the row-level
 * path missed AND surfaces the slow-drift $1.09/row issue that lives
 * below the row-level alert threshold.
 *
 * Two thresholds:
 *   - $0.50/row — small drift, expected if fees/funding aren't subtracted
 *   - $5.00/row — phantom-class, should be zero post-#931
 *
 * Wire into the operator's scheduling layer (cron / Railway scheduled
 * task / agent scheduler). Standalone CLI:
 *   `node dist/services/monkey/pnlReconciliationNightlyCli.js`
 */

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

const DRIFT_THRESHOLD_USD = 0.5;
const PHANTOM_THRESHOLD_USD = 5.0;

export interface NightlyReconciliationSummary {
  windowStart: string;
  windowEnd: string;
  totalRows: number;
  divergedRows: number;
  phantomRows: number;
  maxDivergenceUsd: number;
  sumDivergenceUsd: number;
  /** Worst-divergence rows for operator review. */
  topDivergences: Array<{
    rowId: string;
    symbol: string;
    side: string;
    exitReason: string | null;
    dbPnl: number;
    calcPnl: number;
    divergence: number;
  }>;
}

/**
 * Audit the last `windowHours` hours of monkey close rows. Pure read —
 * no DB writes. Returns a structured summary the caller can log,
 * publish to a metrics endpoint, or alert on.
 */
export async function runNightlyReconciliation(
  windowHours = 24,
): Promise<NightlyReconciliationSummary> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowHours * 60 * 60 * 1000);

  // 7-day audit query reduced to the requested window. Computes
  // divergence inline so the scan is a single pass — no application-side
  // arithmetic on potentially-large result sets.
  const result = await pool.query<{
    id: string;
    symbol: string;
    side: string;
    exit_reason: string | null;
    db_pnl: string;
    calc_pnl: string;
    divergence: string;
  }>(
    `WITH base AS (
       SELECT id, symbol, side, exit_reason,
              pnl AS db_pnl,
              CASE side
                WHEN 'buy'   THEN quantity * (exit_price - entry_price)
                WHEN 'long'  THEN quantity * (exit_price - entry_price)
                WHEN 'sell'  THEN quantity * (entry_price - exit_price)
                WHEN 'short' THEN quantity * (entry_price - exit_price)
              END AS calc_pnl
         FROM autonomous_trades
        WHERE engine_type LIKE 'monkey%'
          AND pnl IS NOT NULL
          AND exit_price IS NOT NULL
          AND entry_price IS NOT NULL
          AND exit_time BETWEEN $1::timestamptz AND $2::timestamptz
     )
     SELECT id, symbol, side, exit_reason, db_pnl, calc_pnl,
            ABS(db_pnl - calc_pnl) AS divergence
       FROM base
      ORDER BY divergence DESC`,
    [windowStart.toISOString(), windowEnd.toISOString()],
  );

  const rows = result.rows.map((r) => ({
    rowId: r.id,
    symbol: r.symbol,
    side: r.side,
    exitReason: r.exit_reason,
    dbPnl: Number(r.db_pnl),
    calcPnl: Number(r.calc_pnl),
    divergence: Number(r.divergence),
  }));

  const totalRows = rows.length;
  const divergedRows = rows.filter((r) => r.divergence > DRIFT_THRESHOLD_USD).length;
  const phantomRows = rows.filter((r) => r.divergence > PHANTOM_THRESHOLD_USD).length;
  const maxDivergenceUsd = rows.length > 0 ? rows[0]!.divergence : 0;
  const sumDivergenceUsd = rows
    .filter((r) => r.divergence > DRIFT_THRESHOLD_USD)
    .reduce((s, r) => s + r.divergence, 0);

  const topDivergences = rows.slice(0, 10);

  const summary: NightlyReconciliationSummary = {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    totalRows,
    divergedRows,
    phantomRows,
    maxDivergenceUsd,
    sumDivergenceUsd,
    topDivergences,
  };

  if (phantomRows > 0) {
    logger.error('[pnl_reconciliation_nightly] PHANTOM rows in 24h window', summary);
  } else if (divergedRows > 0) {
    logger.warn('[pnl_reconciliation_nightly] drift detected (no phantoms)', {
      ...summary,
      // Drop the per-row list at warn-level — keep the headline numbers.
      topDivergences: undefined,
    });
  } else {
    logger.info('[pnl_reconciliation_nightly] clean 24h window', {
      totalRows,
      windowStart: summary.windowStart,
      windowEnd: summary.windowEnd,
    });
  }

  return summary;
}
