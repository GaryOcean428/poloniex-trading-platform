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

/** What the /api/agent/status on/off badge surfaces. */
export type KernelTradingStatus = 'active' | 'idle' | 'paused';

export interface KernelTradingStatusInput {
  /** The global execution-mode override, or null when unknown. */
  executionMode: string | null | undefined;
  /** Count of open LIVE positions in autonomous_trades (status='open'). */
  openLivePositions: number;
  /** Count of LIVE trades created within the recent activity window. */
  recentLiveTrades: number;
}

/**
 * Derive the kernel on/off badge from REAL trading activity.
 *
 * Background (PR6): /api/agent/status used to derive the badge from
 * `strategyLearningEngine.isRunning` — the SLE strategy-GENERATION loop —
 * NOT whether the Monkey kernel (the sole live trader since PR #878) is
 * actually placing orders. The badge read "stopped" while the kernel
 * actively traded live capital.
 *
 * The kernel is the autonomous trader: it runs continuously and observes
 * its own parameters. "On/off" is therefore not a process flag but a
 * question about trading activity, answered from the autonomous_trades
 * ledger:
 *
 *   - 'paused'  — the operator's execution-mode kill/pause override is
 *                 set; this wins over everything (it is the one genuine
 *                 operator MANDATE that halts the kernel).
 *   - 'active'  — the kernel holds open live positions OR placed a live
 *                 trade within the recent window.
 *   - 'idle'    — the kernel is alive but currently flat and quiet.
 *
 * Counts are clamped to non-negative integers so a malformed query row
 * (NaN / negative) fails soft to 'idle' rather than throwing.
 */
export function deriveKernelTradingStatus(
  input: KernelTradingStatusInput,
): KernelTradingStatus {
  if (input.executionMode === 'pause') return 'paused';
  const open = Number.isFinite(input.openLivePositions)
    ? Math.max(0, Math.floor(input.openLivePositions))
    : 0;
  const recent = Number.isFinite(input.recentLiveTrades)
    ? Math.max(0, Math.floor(input.recentLiveTrades))
    : 0;
  return open > 0 || recent > 0 ? 'active' : 'idle';
}
