/**
 * backfillStackedGhostPnl.ts — one-off repair for the reconciler
 * PnL over-attribution bug live between PR #658 (2026-05-13 01:32Z)
 * and PR #660 (2026-05-13 05:40Z).
 *
 * The buggy reconciler applied the FULL aggregate position PnL to
 * EACH stacked ghost row instead of distributing pro-rata by qty.
 * Result: realized P&L ledger amplified by N× for every multi-row
 * close cycle.
 *
 * Detection signature: closed rows in the corruption window that
 *   • share a (symbol, side) and exit_time-truncated-to-second
 *   • have ≥ 2 rows in the group
 *   • all non-null pnls in the group are identical (the duplicated
 *     aggregate)
 *
 * Repair: rewrite each row's pnl as (rowQty / sumGroupQty) * aggregate.
 *
 * Idempotent: re-running on already-corrected data is a no-op because
 * after repair the distinct-pnl-count detection no longer fires
 * (pro-rata shares are different values).
 */
import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';

export interface BackfillResult {
  apply: boolean;
  window: { startTs: string; endTs: string };
  groupsFound: number;
  rowsAffected: number;
  rowsUpdated: number;
  netLedgerCorrectionUsdt: number;
  summary: Array<{
    symbol: string;
    side: string;
    ts: string;
    nRows: number;
    aggregatePnl: number;
    totalQty: number;
    updates: Array<{
      id: string;
      agent: string | null;
      qty: number;
      oldPnl: number | null;
      newPnl: number;
      share: number;
    }>;
  }>;
}

interface GroupRow {
  symbol: string;
  side: string;
  ts_sec: string;
  n_rows: string;
  n_distinct_pnl: string;
  aggregate_pnl: string;
  row_ids: string[];
  quantities: string[];
  pnls: (string | null)[];
  agents: (string | null)[];
  exit_reasons: (string | null)[];
}

const DEFAULT_START = '2026-05-13T01:32:00Z';
const DEFAULT_END = '2026-05-13T05:50:00Z';

export async function runStackedGhostPnlBackfill(opts: {
  apply: boolean;
  startTs?: string;
  endTs?: string;
}): Promise<BackfillResult> {
  const apply = opts.apply === true;
  const startTs = opts.startTs ?? DEFAULT_START;
  const endTs = opts.endTs ?? DEFAULT_END;

  const groups = await pool.query(
    `SELECT symbol,
            side,
            date_trunc('second', exit_time) AS ts_sec,
            COUNT(*) AS n_rows,
            COUNT(DISTINCT pnl) FILTER (WHERE pnl IS NOT NULL) AS n_distinct_pnl,
            MAX(pnl) FILTER (WHERE pnl IS NOT NULL) AS aggregate_pnl,
            array_agg(id ORDER BY entry_time) AS row_ids,
            array_agg(quantity ORDER BY entry_time) AS quantities,
            array_agg(pnl ORDER BY entry_time) AS pnls,
            array_agg(agent ORDER BY entry_time) AS agents,
            array_agg(exit_reason ORDER BY entry_time) AS exit_reasons
       FROM autonomous_trades
      WHERE status = 'closed'
        AND exit_time BETWEEN $1::timestamptz AND $2::timestamptz
        AND exit_reason IN ('manual_close_user', 'reconciled_post_close_race', 'reconciled_not_on_exchange')
      GROUP BY symbol, side, date_trunc('second', exit_time)
      HAVING COUNT(*) > 1
         AND COUNT(DISTINCT pnl) FILTER (WHERE pnl IS NOT NULL) = 1
      ORDER BY date_trunc('second', exit_time) ASC`,
    [startTs, endTs],
  );

  const summary: BackfillResult['summary'] = [];
  const totalRowsUpdated = 0;
  let totalCorrectionUsdt = 0;

  for (const g of groups.rows as GroupRow[]) {
    const aggregatePnl = parseFloat(g.aggregate_pnl) || 0;
    const qtys = g.quantities.map((q) => Math.abs(parseFloat(q)) || 0);
    const totalQty = qtys.reduce((s, q) => s + q, 0);
    if (totalQty <= 0) continue;

    const updates = g.row_ids.map((id, i) => {
      const rowQty = qtys[i] ?? 0;
      const share = rowQty / totalQty;
      const oldPnl = g.pnls[i] !== null ? parseFloat(g.pnls[i] as string) : null;
      const newPnl = aggregatePnl * share;
      return { id, agent: g.agents[i] ?? null, qty: rowQty, oldPnl, newPnl, share };
    });

    summary.push({
      symbol: g.symbol,
      side: g.side,
      ts: g.ts_sec,
      nRows: updates.length,
      aggregatePnl,
      totalQty,
      updates,
    });

    for (const u of updates) {
      if (u.oldPnl !== null) totalCorrectionUsdt += u.oldPnl - u.newPnl;
    }

    if (apply) {
      logger.error('[LIVED ONLY] refusing aggregate backfill apply — this path is a known phantom vector (Finding 1). Use per-row safe repair only.');
      // Do not apply aggregate-derived pnl. This protects the canonical table.
      // totalRowsUpdated stays 0 for this group.
    }
  }

  return {
    apply,
    window: { startTs, endTs },
    groupsFound: summary.length,
    rowsAffected: summary.reduce((s, g) => s + g.nRows, 0),
    rowsUpdated: apply ? totalRowsUpdated : 0,
    netLedgerCorrectionUsdt: parseFloat(totalCorrectionUsdt.toFixed(4)),
    summary,
  };
}

/**
 * Startup helper: runs the backfill if POLYTRADE_RUN_PNL_BACKFILL=1.
 * Always applies (no dry-run on startup). Logs result; never throws.
 * Idempotent — safe to leave the env flag set, but recommend unsetting
 * after one successful run for hygiene.
 */
export async function maybeRunStartupBackfill(): Promise<void> {
  if (process.env.POLYTRADE_RUN_PNL_BACKFILL !== '1') return;
  try {
    const result = await runStackedGhostPnlBackfill({ apply: true });
    logger.info('[BACKFILL] startup stacked-ghost PnL repair complete', {
      groupsFound: result.groupsFound,
      rowsAffected: result.rowsAffected,
      rowsUpdated: result.rowsUpdated,
      netLedgerCorrectionUsdt: result.netLedgerCorrectionUsdt,
      window: result.window,
    });
    // Per-group detail at info level so the audit trail is in logs.
    for (const g of result.summary) {
      logger.info('[BACKFILL] group repaired', {
        symbol: g.symbol,
        side: g.side,
        ts: g.ts,
        nRows: g.nRows,
        aggregatePnl: g.aggregatePnl,
        updates: g.updates.map((u) => ({
          id: u.id.slice(0, 8),
          agent: u.agent,
          qty: u.qty,
          oldPnl: u.oldPnl,
          newPnl: parseFloat(u.newPnl.toFixed(4)),
          share: parseFloat(u.share.toFixed(4)),
        })),
      });
    }
  } catch (err) {
    logger.error('[BACKFILL] startup repair failed (continuing)', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
