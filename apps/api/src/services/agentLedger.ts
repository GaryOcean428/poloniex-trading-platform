/**
 * agentLedger.ts — shared autonomous_trades ledger helpers.
 *
 * Single source of the engine-mode SQL filter so /api/agent/status and
 * /api/agent/performance cannot drift apart.
 *
 * Before this existed, /status summed pnl across EVERY engine (paper +
 * backtest + deleted FAT/LiveSignal/Persistent rows, all-time, no filter)
 * — surfacing a meaningless cumulative "realized PnL" (operator report
 * 2026-05-22: −$4054). /performance already filtered by engine_type
 * correctly; this consolidates that single proven filter.
 */

export type EngineMode = 'live' | 'paper' | 'backtest' | 'all';

/**
 * SQL fragment constraining an autonomous_trades query to one engine.
 *
 * Returns a leading-space ` AND engine_type = '<mode>'` clause for
 * live / paper / backtest; an empty string for 'all', an absent mode, or
 * any unrecognised value (fails open to "every engine"). The caller's
 * value is never interpolated — only matched against a fixed switch — so
 * there is no SQL-injection surface.
 *
 * `engine_type` is populated by migration 050; NULL-engine_type rows are
 * pre-050 and are excluded from every filtered (non-'all') view.
 */
export function engineModeSqlClause(mode: string | undefined | null): string {
  switch (mode) {
    case 'live':
      return " AND engine_type = 'live'";
    case 'paper':
      return " AND engine_type = 'paper'";
    case 'backtest':
      return " AND engine_type = 'backtest'";
    default:
      return '';
  }
}
