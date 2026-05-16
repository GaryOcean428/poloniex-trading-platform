/**
 * wr_retrospective.ts — Retrospective WR scoring for shadow kernels.
 *
 * Layer 2.5 of the dual-kernel consensus architecture per
 * [[polytrade-consensus-architecture]]. Per CC red-team refinement #1:
 * the consensus arbiter (PR CONSENSUS-7) needs WR_other to weight peer
 * proposals via SLERP. But shadow kernels (Py today) have proposals
 * without real trades — kernel_parity_log rows have no PnL outcome.
 *
 * This module scores shadow-kernel proposals retrospectively by joining
 * kernel_parity_log against autonomous_trades on (symbol, time window):
 *
 *   - For each closed autonomous_trades row, find the kernel_parity_log
 *     row near that trade's entry time on the same symbol
 *   - If shadow agreed (same side): shadow shares the trade's outcome
 *   - If shadow disagreed (opposite side): shadow gets the INVERTED outcome
 *   - If shadow held while TS entered: no contribution (no counterfactual)
 *   - Aggregate by py_regime into the same RegimeMatrix shape as
 *     wr_matrix.ts produces
 *
 * This is the cold-start path. Once shadow kernels start placing real
 * trades (PR CONSENSUS-9 executor cutover with both kernels live), the
 * regular wr_matrix query supplies real WR and this module becomes a
 * pre-flight validator only.
 *
 * Caveats noted in [[polytrade-consensus-architecture]]:
 *   - ignores slippage + fees (TS trade had them; shadow inversion
 *     assumes they'd be symmetric, which is approximately true on
 *     liquid pairs)
 *   - assumes shadow wouldn't have moved the market (true at current
 *     position sizes; revisit if shadow ever sizes up materially)
 *
 * QIG purity: SQL + sign comparison. No geometric ops.
 */

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

import {
  cellHasMinSamples,
  parseRegimeFromReason,
  type CellStats,
  type RegimeLabel,
  type RegimeMatrix,
} from './wr_matrix.js';

export interface RetrospectiveOptions {
  /** Match window in seconds between kernel_parity_log row and autonomous_trades row. Default 60. */
  matchWindowSec?: number;
  /** Lookback window in hours. Default 168 (7 days). */
  lookbackHours?: number;
  /** Shadow engine label to attribute (defaults 'py-retrospective'). */
  shadowEngineLabel?: string;
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

function regimeFromPy(pyRegime: string | null): RegimeLabel {
  const lc = (pyRegime || '').toLowerCase();
  if (lc === 'creator' || lc === 'preserver' || lc === 'dissolver') return lc;
  return 'unknown';
}

/**
 * Build a retrospective WR matrix for the shadow (Py) kernel by joining
 * kernel_parity_log against autonomous_trades. Returns a single-engine
 * matrix: `{ [shadowEngineLabel]: { creator: ..., preserver: ..., ... } }`.
 *
 * Cold-start safe: empty matrix when no joined rows exist. Caller (consensus
 * arbiter) should fall back to a configured default WR until at least
 * minSamples per cell.
 */
export async function getRetrospectiveShadowMatrix(
  opts: RetrospectiveOptions = {},
): Promise<RegimeMatrix> {
  const matchWindowSec = opts.matchWindowSec ?? 60;
  const lookbackHours = opts.lookbackHours ?? 168;
  const shadowLabel = opts.shadowEngineLabel ?? 'py-retrospective';

  // Join kernel_parity_log → autonomous_trades on (symbol, ±matchWindowSec)
  // around the trade's entry time. Only count closed trades with non-null pnl.
  const sql = `
    SELECT
      kpl.py_action,
      kpl.py_side,
      kpl.py_regime,
      at.side AS ts_actual_side,
      at.pnl,
      at.reason
    FROM autonomous_trades at
    JOIN kernel_parity_log kpl
      ON kpl.symbol = at.symbol
     AND kpl.symbol_timestamp BETWEEN
           at.created_at - ($1::int * INTERVAL '1 second')
       AND at.created_at + ($1::int * INTERVAL '1 second')
    WHERE at.status = 'closed'
      AND at.pnl IS NOT NULL
      AND at.exit_time > NOW() - ($2::int * INTERVAL '1 hour')
      AND kpl.py_action IS NOT NULL
      AND kpl.py_action IN ('enter_long', 'enter_short')
  `;

  let rows: Array<{
    py_action: string;
    py_side: string | null;
    py_regime: string | null;
    ts_actual_side: string;
    pnl: string | number;
    reason: string | null;
  }>;
  try {
    const result = await pool.query(sql, [matchWindowSec, lookbackHours]);
    rows = result.rows as typeof rows;
  } catch (err) {
    logger.debug('[WRRetrospective] query failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return {};
  }

  if (rows.length === 0) return {};

  const matrix: RegimeMatrix = { [shadowLabel]: emptyRow() };

  for (const row of rows) {
    const pnl = typeof row.pnl === 'string' ? parseFloat(row.pnl) : row.pnl;
    if (!Number.isFinite(pnl)) continue;

    // Prefer py_regime when populated; fall back to parsing the trade's
    // reason (TS-emitted) since kpl rows pre-PR-#722 may have NULL py_regime.
    const regime = row.py_regime
      ? regimeFromPy(row.py_regime)
      : parseRegimeFromReason(row.reason);

    const pySide = (row.py_side || '').toLowerCase();
    const tsSide = (row.ts_actual_side || '').toLowerCase();

    // Agreement: did Py propose the same side TS actually executed?
    const agreed = pySide === tsSide;

    // Score: agreed → share TS outcome; disagreed → invert.
    // (Held / no-side rows are filtered by py_action IN (enter_long, enter_short).)
    const shadowWon = agreed ? pnl > 0 : pnl < 0;

    const cell = matrix[shadowLabel][regime];
    cell.total += 1;
    if (shadowWon) {
      cell.wins += 1;
    } else {
      cell.losses += 1;
    }
  }

  // Compute WR per cell
  for (const regime of ['creator', 'preserver', 'dissolver', 'unknown'] as RegimeLabel[]) {
    const cell = matrix[shadowLabel][regime];
    cell.wr = cell.total > 0 ? cell.wins / cell.total : 0;
  }

  return matrix;
}

/**
 * Convenience: merge a retrospective matrix into a real-trades matrix so
 * the consensus arbiter sees one combined view. Retrospective entries
 * are added under a separate engine_type label (e.g. 'py-retrospective')
 * — they don't overwrite real-trade entries.
 */
export function mergeRetrospective(
  realMatrix: RegimeMatrix,
  retroMatrix: RegimeMatrix,
): RegimeMatrix {
  const merged: RegimeMatrix = { ...realMatrix };
  for (const engine of Object.keys(retroMatrix)) {
    merged[engine] = retroMatrix[engine];
  }
  return merged;
}

/** Re-export to keep callers from importing both modules for one helper. */
export { cellHasMinSamples };
