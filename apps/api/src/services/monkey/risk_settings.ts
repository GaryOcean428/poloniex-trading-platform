/**
 * risk_settings.ts — operator's leverage-cap MANDATE.
 *
 * 2026-05-25 doctrine: the kernel trades autonomously. Operator gates that
 * suppress entries (daily-loss halt, max-concurrent-positions halt) are
 * REMOVED — they short-circuited the kernel's own learning. Losses feed
 * back to the neurochemistry layer (dopamine drop, frustration); the
 * kernel adjusts itself. Everything else is telemetry on the
 * /autonomous-agent panel, not a gate.
 *
 * What REMAINS here:
 *   - max_leverage             → clamps maxLevBoundary in loop.ts. The
 *                                audited 15× ceiling (MONKEY_MAX_LEVERAGE_CAP)
 *                                still binds — the UI value can only clamp
 *                                leverage DOWN. This is the one operator
 *                                MANDATE that survives: a safety ceiling,
 *                                not a behavioural knob.
 *
 * Strictly opt-in: when no operator profile has been saved
 * `getOperatorRiskSettings` returns null and the kernel applies NO ceiling.
 * Reads are cached 60 s and fail soft (null) — a DB hiccup must never
 * block trading.
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

/** Mirrors the GET /api/risk/settings route defaults. The non-leverage
 *  fields are retained for compatibility with the RiskSettings table and
 *  any telemetry consumers; the kernel only acts on `maxLeverage`.
 *
 *  2026-05-25 — `maxLeverage` default raised from 10 to 100 per operator
 *  autonomy doctrine. The clampNum upper bound is 100, so this is
 *  effectively no-op: the exchange's per-symbol maxLev becomes the only
 *  binding ceiling when no profile is saved AND when a saved profile
 *  has null/missing max_leverage. The operator can still set a real
 *  ceiling via the UI; that explicit-set value MANDATEs down.
 */
export const DEFAULT_RISK_SETTINGS: OperatorRiskSettings = {
  maxDrawdown: 15,
  maxPositionSize: 5,
  maxConcurrentPositions: 3,
  stopLoss: 2,
  takeProfit: 4,
  dailyLossLimit: 5,
  maxLeverage: 100,
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
 * clamped so a corrupt row can never produce a nonsensical leverage cap.
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

const TTL_MS = 60_000;

let settingsCache: { value: OperatorRiskSettings | null; atMs: number } | null = null;

/** Test seam — clears the module cache. */
export function resetRiskSettingsCache(): void {
  settingsCache = null;
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
 * DB error. `null` means the kernel applies NO ceiling — behaviour is
 * identical to before this module. The leverage cap is strictly opt-in:
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
    logger.warn('[risk-settings] read failed — no ceiling applied this cycle', {
      err: err instanceof Error ? err.message : String(err),
    });
    settingsCache = { value: null, atMs: Date.now() };
    return null;
  }
}
