/**
 * kelly_rolling_stats.ts — DB query helper for the Kelly rolling stats
 * reader (proposal #3, lane-conditioned split issue #622).
 *
 * Kept in its own file to allow unit-testing without pulling in the
 * full loop.ts import tree (which triggers environment validation via
 * apiCredentialsService → encryptionService → config/env).
 */

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';
import type { LaneType } from './executive.js';

/** Window size — last N closed trades to consider. */
const KELLY_WINDOW = 50;
/** Minimum closed trades required before the Kelly cap activates. */
const KELLY_MIN_TRADES = 5;

/**
 * Fetches the last ``KELLY_WINDOW`` closed Monkey trades for ``agent``
 * from ``autonomous_trades`` and returns Kelly rolling stats.
 *
 * When ``lane`` is provided the query is restricted to
 * ``AND lane = $lane`` so each execution lane (scalp, swing, trend)
 * learns only from its own closed trades. When ``lane`` is omitted
 * the pooled query runs unchanged — backward compatible for callers
 * that are not yet lane-aware.
 *
 * Returns ``null`` when fewer than 5 closed trades have accumulated
 * for the given scope. Each lane warms independently: scalp will warm
 * fastest because it closes most often.
 */
export async function getKellyRollingStats(
  agent: string,
  lane?: LaneType,
): Promise<{ winRate: number; avgWin: number; avgLoss: number } | null> {
  try {
    const params: string[] = [agent];
    let laneClause = '';
    if (lane !== undefined) {
      params.push(lane);
      laneClause = ` AND lane = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT pnl FROM autonomous_trades
        WHERE status = 'closed'
          AND agent = $1
          AND reason LIKE 'monkey|%'${laneClause}
        ORDER BY exit_time DESC
        LIMIT ${KELLY_WINDOW}`,
      params,
    );
    const pnls = (result.rows as Array<{ pnl: string | number }>)
      .map((r) => Number(r.pnl) || 0)
      .filter((p) => Number.isFinite(p));
    if (pnls.length < KELLY_MIN_TRADES) return null;
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p < 0);
    const winRate = wins.length / pnls.length;
    const avgWin = wins.length > 0
      ? wins.reduce((s, v) => s + v, 0) / wins.length
      : 0;
    const avgLoss = losses.length > 0
      ? losses.reduce((s, v) => s + v, 0) / losses.length
      : 0;
    return { winRate, avgWin, avgLoss };
  } catch (err) {
    logger.debug('[Monkey] getKellyRollingStats failed; defer to geometric formula', {
      agent,
      lane,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
