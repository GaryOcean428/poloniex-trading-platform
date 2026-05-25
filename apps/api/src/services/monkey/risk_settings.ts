/**
 * risk_settings.ts — bridges the operator's RiskSettings UI panel to the
 * Monkey kernel.
 *
 * The UI (apps/web/src/components/risk/RiskSettings.tsx) PUTs to
 * /api/risk/settings, which upserts the `risk_settings` table (created
 * in migration 055). Until now the Monkey kernel read none of it — the
 * panel was a dead control. This module turns three of those settings
 * into honest hard ceilings on the kernel:
 *
 *   - max_leverage             → clamps maxLevBoundary in loop.ts. The
 *                                audited 15× ceiling (MONKEY_MAX_LEVERAGE_CAP,
 *                                loop.ts:2349-2362) still binds — the UI
 *                                value can only clamp leverage DOWN.
 *   - max_concurrent_positions → vetoes new Monkey entries once that many
 *                                Monkey-owned positions are already open.
 *   - daily_loss_limit         → halts new entries once today's realised
 *                                Monkey PnL is at/below -limit% of equity.
 *
 * Ceilings only — they restrict, never amplify. A UI "aggressive" preset
 * cannot push the kernel past its own observer-derived sizing or past
 * the leverage audit; that would be the P1 operator-knob anti-pattern.
 *
 * Strictly opt-in: when no operator profile has been saved (empty table,
 * or a DB error) getOperatorRiskSettings returns null and the kernel
 * applies NO ceilings — behaviour is identical to before this module.
 * The ceilings only ever engage once the operator saves a profile.
 *
 * Reads are cached 60 s and fail soft (null / 0) — a DB hiccup must
 * never block trading or fabricate a loss halt.
 *
 * QIG purity: SQL + arithmetic only. No geometric ops.
 */

import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

export interface OperatorRiskSettings {
  maxDrawdown: number;
  maxPositionSize: number;
  maxConcurrentPositions: number;
  stopLoss: number;
  takeProfit: number;
  /** Percent of equity. */
  dailyLossLimit: number;
  maxLeverage: number;
  riskLevel: string;
}

/** Mirrors the GET /api/risk/settings route defaults. */
export const DEFAULT_RISK_SETTINGS: OperatorRiskSettings = {
  maxDrawdown: 15,
  maxPositionSize: 5,
  maxConcurrentPositions: 3,
  stopLoss: 2,
  takeProfit: 4,
  dailyLossLimit: 5,
  maxLeverage: 10,
  riskLevel: 'moderate',
};

function clampNum(raw: unknown, fallback: number, lo: number, hi: number): number {
  // null / undefined / '' must fall back, not coerce — Number(null) is 0
  // (finite), which would otherwise clamp a NULL column to the low bound.
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Pure: coerce + clamp a `risk_settings` DB row into OperatorRiskSettings.
 * A null/undefined row yields the defaults. Out-of-range values are
 * clamped so a corrupt row can never produce a nonsensical gate.
 */
export function parseRiskSettingsRow(
  row: Record<string, unknown> | null | undefined,
): OperatorRiskSettings {
  if (!row) return { ...DEFAULT_RISK_SETTINGS };
  return {
    maxDrawdown: clampNum(row.max_drawdown, DEFAULT_RISK_SETTINGS.maxDrawdown, 1, 100),
    maxPositionSize: clampNum(row.max_position_size, DEFAULT_RISK_SETTINGS.maxPositionSize, 1, 100),
    maxConcurrentPositions: Math.round(
      clampNum(row.max_concurrent_positions, DEFAULT_RISK_SETTINGS.maxConcurrentPositions, 1, 50),
    ),
    stopLoss: clampNum(row.stop_loss, DEFAULT_RISK_SETTINGS.stopLoss, 0.1, 50),
    takeProfit: clampNum(row.take_profit, DEFAULT_RISK_SETTINGS.takeProfit, 0.1, 100),
    dailyLossLimit: clampNum(row.daily_loss_limit, DEFAULT_RISK_SETTINGS.dailyLossLimit, 0.1, 100),
    maxLeverage: Math.round(clampNum(row.max_leverage, DEFAULT_RISK_SETTINGS.maxLeverage, 1, 100)),
    riskLevel: typeof row.risk_level === 'string' ? row.risk_level : DEFAULT_RISK_SETTINGS.riskLevel,
  };
}

/**
 * Pure: is the daily-loss halt tripped? The cap is `limitPct`% of equity;
 * the halt trips once today's realised PnL has fallen to -cap or worse.
 * Returns false when equity or limit is non-positive (no spurious halt).
 */
export function dailyLossHalted(
  todayRealizedPnl: number,
  dailyLossLimitPct: number,
  equityUsdt: number,
): boolean {
  if (!Number.isFinite(todayRealizedPnl)) return false;
  if (!(dailyLossLimitPct > 0) || !(equityUsdt > 0)) return false;
  const capUsd = (dailyLossLimitPct / 100) * equityUsdt;
  return todayRealizedPnl <= -capUsd;
}

export type EntryRiskSettingsHalt =
  | {
      kind: 'daily_loss_limit';
      todayRealizedPnl: number;
      limitPct: number;
      equityUsdt: number;
    }
  | {
      kind: 'max_concurrent_positions';
      openMonkeyPositions: number;
      cap: number;
    };

/**
 * Pure: resolve whether the operator risk profile blocks a NEW Monkey
 * entry right now. Exits remain unaffected.
 */
export function getEntryRiskSettingsHalt(args: {
  riskSettings: OperatorRiskSettings | null;
  todayRealizedPnl: number;
  equityUsdt: number;
  openMonkeyPositions: number;
}): EntryRiskSettingsHalt | null {
  const {
    riskSettings,
    todayRealizedPnl,
    equityUsdt,
    openMonkeyPositions,
  } = args;
  if (!riskSettings) return null;
  if (dailyLossHalted(todayRealizedPnl, riskSettings.dailyLossLimit, equityUsdt)) {
    return {
      kind: 'daily_loss_limit',
      todayRealizedPnl,
      limitPct: riskSettings.dailyLossLimit,
      equityUsdt,
    };
  }
  if (openMonkeyPositions >= riskSettings.maxConcurrentPositions) {
    return {
      kind: 'max_concurrent_positions',
      openMonkeyPositions,
      cap: riskSettings.maxConcurrentPositions,
    };
  }
  return null;
}

const TTL_MS = 60_000;

let settingsCache: { value: OperatorRiskSettings | null; atMs: number } | null = null;
let pnlCache: { value: number; atMs: number } | null = null;
let openCountCache: { value: number; atMs: number } | null = null;

export function adjustTodayMonkeyRealizedPnlCache(delta: number): void {
  if (!pnlCache || !Number.isFinite(delta) || delta === 0) return;
  pnlCache = { value: pnlCache.value + delta, atMs: pnlCache.atMs };
}

export function adjustOpenMonkeyPositionCountCache(delta: number): void {
  if (!openCountCache || !Number.isFinite(delta) || delta === 0) return;
  openCountCache = {
    value: Math.max(0, openCountCache.value + Math.trunc(delta)),
    atMs: openCountCache.atMs,
  };
}

/** Test seam — clears the module caches. */
export function resetRiskSettingsCache(): void {
  settingsCache = null;
  pnlCache = null;
  openCountCache = null;
}

/**
 * The operator's risk profile. Cached 60 s.
 *
 * Single-operator assumption (deliberate): reads the most-recently-saved
 * row via `ORDER BY updated_at DESC LIMIT 1`, NOT scoped by user_id.
 * polytrade runs one operator, and the kernel's credential user_id
 * (user_api_credentials) can differ from the UI's logged-in user_id —
 * taking the latest saved row sidesteps that mismatch. If polytrade ever
 * becomes multi-tenant this MUST be re-keyed by the operator's user_id.
 *
 * Returns `null` when no profile has been saved (empty table) OR on a
 * DB error. `null` means the kernel applies NO ceilings — behaviour is
 * identical to before this module. The risk panel is strictly opt-in:
 * an unset profile must never make the kernel more (or less) aggressive.
 */
export async function getOperatorRiskSettings(): Promise<OperatorRiskSettings | null> {
  if (settingsCache && Date.now() - settingsCache.atMs < TTL_MS) return settingsCache.value;
  try {
    const r = await pool.query(
      `SELECT max_drawdown, max_position_size, max_concurrent_positions,
              stop_loss, take_profit, daily_loss_limit, max_leverage, risk_level
         FROM risk_settings
        ORDER BY updated_at DESC
        LIMIT 1`,
    );
    const value = r.rows.length > 0
      ? parseRiskSettingsRow(r.rows[0] as Record<string, unknown>)
      : null;
    settingsCache = { value, atMs: Date.now() };
    return value;
  } catch (err) {
    logger.warn('[risk-settings] read failed — no ceilings applied this cycle', {
      err: err instanceof Error ? err.message : String(err),
    });
    settingsCache = { value: null, atMs: Date.now() };
    return null;
  }
}

/**
 * Today's realised PnL for Monkey-owned closed trades (UTC day boundary).
 * Cached 60 s; 0 on error — a DB hiccup must not fabricate a loss halt.
 * Engine filter mirrors kelly_rolling_stats.ts: `reason LIKE 'monkey|%'`.
 *
 * Diagnostic breakdown (2026-05-25): on every cache miss we ALSO run a
 * one-shot breakdown query and log row-counts / wins / losses / nulls /
 * by-agent / by-reason-prefix. CSV ground-truth showed the SUM was
 * inflated 27× vs Poloniex's actual close ledger — the breakdown lets
 * us see which slice (agent, reason-prefix, NULL-pnl rows, gross_loss
 * vs gross_win asymmetry, time range) is the inflation source without
 * needing DB-paste from the operator. Logged at WARN so it surfaces in
 * Railway log search; the cost is one extra small query per minute.
 */
export async function getTodayMonkeyRealizedPnl(): Promise<number> {
  if (pnlCache && Date.now() - pnlCache.atMs < TTL_MS) return pnlCache.value;
  try {
    const r = await pool.query(
      // Explicit UTC day boundary — date_trunc on a bare NOW() would use
      // the DB session timezone. Drop NOW() to UTC wall-clock, truncate
      // to the day, then re-attach UTC so the comparison against
      // exit_time (timestamptz) is unambiguous regardless of server tz.
      `SELECT COALESCE(SUM(pnl), 0) AS pnl
         FROM autonomous_trades
        WHERE status = 'closed'
          AND reason LIKE 'monkey|%'
          AND exit_time >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    );
    const pnl = Number((r.rows[0] as { pnl?: unknown } | undefined)?.pnl ?? 0);
    const value = Number.isFinite(pnl) ? pnl : 0;
    pnlCache = { value, atMs: Date.now() };
    // Fire-and-forget breakdown — never block the cache fill on it.
    logDailyPnlBreakdown(value).catch(() => { /* diagnostic only */ });
    return value;
  } catch (err) {
    logger.warn('[risk-settings] daily-PnL read failed — assuming 0', {
      err: err instanceof Error ? err.message : String(err),
    });
    pnlCache = { value: 0, atMs: Date.now() };
    return 0;
  }
}

/**
 * One-shot diagnostic breakdown for the today-PnL SUM. Runs alongside
 * the cached query on cache misses; logs a wide row that exposes the
 * shape of the rows the SUM is summing.
 *
 * Built to localise the 2026-05-25 inflation bug (DB SUM read −$61.65;
 * Poloniex ledger ground truth −$2.30). The breakdown distinguishes:
 *   - NULL-pnl rows  → reconciler closes that never wrote a real pnl
 *   - by-agent       → K/L/T/M split asymmetries
 *   - reason-prefix  → only `monkey|%` rows count; if wins live under
 *                      another prefix (e.g. `kernel_adopted|%`) the
 *                      SUM is loss-biased
 *   - gross_win / gross_loss → if gross_win ≈ 0 the wins are missing
 *   - PnL extremes   → a single inflated outlier (e.g. leverage-x'd
 *                      row) shows up as max/min far from the others
 *
 * Logs at WARN (always-on visibility) for the next several minutes;
 * delete this diagnostic once the bug class is found.
 */
async function logDailyPnlBreakdown(observedSum: number): Promise<void> {
  try {
    const r = await pool.query<{
      rows_n: string;
      wins: string;
      losses: string;
      zeros: string;
      null_pnls: string;
      gross_wins: string;
      gross_losses: string;
      max_pnl: string;
      min_pnl: string;
      distinct_agents: string;
      distinct_reason_prefixes: string;
      first_exit: string | null;
      last_exit: string | null;
    }>(
      `SELECT COUNT(*) AS rows_n,
              COUNT(*) FILTER (WHERE pnl > 0) AS wins,
              COUNT(*) FILTER (WHERE pnl < 0) AS losses,
              COUNT(*) FILTER (WHERE pnl = 0) AS zeros,
              COUNT(*) FILTER (WHERE pnl IS NULL) AS null_pnls,
              COALESCE(SUM(pnl) FILTER (WHERE pnl > 0), 0) AS gross_wins,
              COALESCE(SUM(pnl) FILTER (WHERE pnl < 0), 0) AS gross_losses,
              COALESCE(MAX(pnl), 0) AS max_pnl,
              COALESCE(MIN(pnl), 0) AS min_pnl,
              COUNT(DISTINCT agent) AS distinct_agents,
              COUNT(DISTINCT split_part(reason, '|', 1)) AS distinct_reason_prefixes,
              MIN(exit_time)::text AS first_exit,
              MAX(exit_time)::text AS last_exit
         FROM autonomous_trades
        WHERE status = 'closed'
          AND reason LIKE 'monkey|%'
          AND exit_time >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    );
    const row = r.rows[0];
    if (!row) return;
    logger.warn('[risk-settings] daily-PnL breakdown (diagnostic)', {
      observedSum: Number(observedSum.toFixed(4)),
      rows: Number(row.rows_n),
      wins: Number(row.wins),
      losses: Number(row.losses),
      zeros: Number(row.zeros),
      null_pnls: Number(row.null_pnls),
      gross_wins: Number(Number(row.gross_wins).toFixed(4)),
      gross_losses: Number(Number(row.gross_losses).toFixed(4)),
      max_pnl: Number(Number(row.max_pnl).toFixed(4)),
      min_pnl: Number(Number(row.min_pnl).toFixed(4)),
      distinct_agents: Number(row.distinct_agents),
      distinct_reason_prefixes: Number(row.distinct_reason_prefixes),
      first_exit: row.first_exit,
      last_exit: row.last_exit,
    });

    // Per-agent slice — distinguishes K/L/T/M splits going asymmetric.
    const agentRows = await pool.query<{
      agent: string | null;
      n: string;
      net: string;
      gross_win: string;
      gross_loss: string;
    }>(
      `SELECT agent, COUNT(*) AS n,
              COALESCE(SUM(pnl), 0) AS net,
              COALESCE(SUM(pnl) FILTER (WHERE pnl > 0), 0) AS gross_win,
              COALESCE(SUM(pnl) FILTER (WHERE pnl < 0), 0) AS gross_loss
         FROM autonomous_trades
        WHERE status = 'closed'
          AND reason LIKE 'monkey|%'
          AND exit_time >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        GROUP BY agent
        ORDER BY agent NULLS FIRST`,
    );
    for (const a of agentRows.rows) {
      logger.warn('[risk-settings] daily-PnL by agent', {
        agent: a.agent ?? '<null>',
        n: Number(a.n),
        net: Number(Number(a.net).toFixed(4)),
        gross_win: Number(Number(a.gross_win).toFixed(4)),
        gross_loss: Number(Number(a.gross_loss).toFixed(4)),
      });
    }
  } catch {
    /* diagnostic-only; never throw out of a cache-fill */
  }
}

/**
 * Count of currently-open Monkey-owned positions. Cached 60 s; 0 on
 * error. Counts Monkey's own rows only (`reason LIKE 'monkey|%'`) — NOT
 * the account-wide open count, which also includes operator-opened
 * positions and must never gate Monkey (loop.ts fetchAccountContext
 * 2026-04-21 note).
 */
export async function getOpenMonkeyPositionCount(): Promise<number> {
  if (openCountCache && Date.now() - openCountCache.atMs < TTL_MS) return openCountCache.value;
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM autonomous_trades
        WHERE status = 'open'
          AND reason LIKE 'monkey|%'`,
    );
    const n = Number((r.rows[0] as { n?: unknown } | undefined)?.n ?? 0);
    const value = Number.isFinite(n) && n >= 0 ? n : 0;
    openCountCache = { value, atMs: Date.now() };
    return value;
  } catch (err) {
    logger.warn('[risk-settings] open-position count read failed — assuming 0', {
      err: err instanceof Error ? err.message : String(err),
    });
    openCountCache = { value: 0, atMs: Date.now() };
    return 0;
  }
}
