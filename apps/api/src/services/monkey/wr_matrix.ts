/**
 * wr_matrix.ts — Regime-conditional win-rate matrix per kernel.
 *
 * Layer 2 of the dual-kernel consensus architecture per
 * [[polytrade-consensus-architecture]]. The consensus arbiter
 * (PR CONSENSUS-7) consumes this matrix to compute the
 * dominance weight between TS Monkey + Py Monkey proposals.
 *
 * Per CC red-team refinement #3: pooled WR is an anti-pattern. A
 * kernel that wins 65% in creator/breakout regimes and 35% in
 * dissolver/ranging regimes shows pooled 50% — averaging out the
 * regime-conditional expertise. The arbiter must weight per regime,
 * not globally.
 *
 * Schema source: autonomous_trades (engine_type column from PR #702;
 * regime parsed from `reason` text where present — e.g. "regime=creator
 * strategy=breakout dir=bullish"). Falls back to 'unknown' regime
 * when reason has no `regime=<name>` token.
 *
 * Returned shape:
 *   {
 *     [engineType]: {
 *       [regime]: { wins, losses, total, wr }
 *     }
 *   }
 *
 * QIG purity: SQL aggregation + regex parsing only. No geometric ops.
 */

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

export type RegimeLabel = 'creator' | 'preserver' | 'dissolver' | 'unknown';
export const REGIMES: readonly RegimeLabel[] = ['creator', 'preserver', 'dissolver', 'unknown'];

export interface CellStats {
  wins: number;
  losses: number;
  total: number;
  wr: number;  // ∈ [0, 1]; NaN-safe when total==0 (returns 0)
}

export type RegimeMatrix = Record<string, Record<RegimeLabel, CellStats>>;

const REGIME_REGEX = /regime=([a-z_]+)/i;

/**
 * Parse the regime label from a trade's `reason` text. K-kernel + LiveSignal
 * both embed `regime=<name>` in their reason strings. Returns 'unknown' when
 * the token is missing or doesn't match a canonical regime label.
 */
export function parseRegimeFromReason(reason: string | null | undefined): RegimeLabel {
  if (!reason) return 'unknown';
  const m = reason.match(REGIME_REGEX);
  if (!m) return 'unknown';
  const raw = m[1].toLowerCase();
  if (raw === 'creator' || raw === 'preserver' || raw === 'dissolver') {
    return raw;
  }
  return 'unknown';
}

function emptyCell(): CellStats {
  return { wins: 0, losses: 0, total: 0, wr: 0 };
}

function emptyRow(): Record<RegimeLabel, CellStats> {
  return {
    creator: emptyCell(),
    preserver: emptyCell(),
    dissolver: emptyCell(),
    unknown: emptyCell(),
  };
}

export interface WRMatrixOptions {
  /** Only count trades closed within the last N hours. Default 168 (7 days). */
  lookbackHours?: number;
  /** Only include trades where pnl is non-null (closed + accounted). Default true. */
  requirePnl?: boolean;
  /** Optional engine_type filter (e.g. ['monkey-k', 'monkey-py-shadow']). */
  engineTypes?: string[];
}

/**
 * Query autonomous_trades and aggregate WR per (engine_type, regime). Closed
 * trades with non-null pnl only (default). Time-bounded by `lookbackHours`.
 *
 * Returns an empty matrix on DB error (fail-soft). Caller is responsible for
 * cold-start handling (e.g. matrix where all cells have total==0 means no
 * trades yet; consensus arbiter should fall back to a configured default).
 */
export async function getWRMatrix(opts: WRMatrixOptions = {}): Promise<RegimeMatrix> {
  const lookbackHours = opts.lookbackHours ?? 168;
  const requirePnl = opts.requirePnl !== false;

  const filterClauses: string[] = ['status = $1'];
  const params: unknown[] = ['closed'];
  let p = 2;

  filterClauses.push(`exit_time > NOW() - ($${p}::int * INTERVAL '1 hour')`);
  params.push(lookbackHours);
  p += 1;

  if (requirePnl) {
    filterClauses.push('pnl IS NOT NULL');
  }
  if (opts.engineTypes && opts.engineTypes.length > 0) {
    filterClauses.push(`engine_type = ANY($${p}::text[])`);
    params.push(opts.engineTypes);
    p += 1;
  }

  const sql = `
    SELECT engine_type, reason, pnl
      FROM autonomous_trades
     WHERE ${filterClauses.join(' AND ')}
  `;

  let rows: Array<{ engine_type: string | null; reason: string | null; pnl: string | number | null }>;
  try {
    const result = await pool.query(sql, params);
    rows = result.rows as Array<{ engine_type: string | null; reason: string | null; pnl: string | number | null }>;
  } catch (err) {
    logger.debug('[WRMatrix] query failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return {};
  }

  const matrix: RegimeMatrix = {};
  for (const row of rows) {
    const engine = row.engine_type ?? 'unknown';
    const regime = parseRegimeFromReason(row.reason);
    const pnl = typeof row.pnl === 'string' ? parseFloat(row.pnl) : (row.pnl ?? 0);
    if (!Number.isFinite(pnl)) continue;

    if (!matrix[engine]) matrix[engine] = emptyRow();
    const cell = matrix[engine][regime];
    cell.total += 1;
    if (pnl > 0) {
      cell.wins += 1;
    } else {
      cell.losses += 1;
    }
  }

  // Compute WR per cell
  for (const engine of Object.keys(matrix)) {
    for (const regime of REGIMES) {
      const cell = matrix[engine][regime];
      cell.wr = cell.total > 0 ? cell.wins / cell.total : 0;
    }
  }

  return matrix;
}

/**
 * Convenience: lookup the WR for a specific (engine, regime) cell. Returns
 * 0 when the cell has no trades yet (cold-start) — caller should distinguish
 * "no data" from "actual 0% WR" by checking the total field on the matrix.
 */
export function getCellWR(
  matrix: RegimeMatrix,
  engineType: string,
  regime: RegimeLabel,
): number {
  return matrix[engineType]?.[regime]?.wr ?? 0;
}

/**
 * Convenience: minimum-samples gate. Returns true if the cell has enough
 * trades to be statistically meaningful for the consensus arbiter. Caller
 * configures the threshold; default 5 matches the existing Kelly cap
 * minimum.
 */
export function cellHasMinSamples(
  matrix: RegimeMatrix,
  engineType: string,
  regime: RegimeLabel,
  minSamples = 5,
): boolean {
  return (matrix[engineType]?.[regime]?.total ?? 0) >= minSamples;
}
