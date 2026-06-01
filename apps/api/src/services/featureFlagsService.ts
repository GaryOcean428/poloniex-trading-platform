/**
 * Feature Flags — DB-backed operator control plane for Monkey on/off toggles.
 *
 * Mirrors executionModeService (the proven pattern): a single source of truth
 * in `monkey_feature_flags`, read through a short-TTL cache so the kernel's
 * per-tick reads aren't a DB roundtrip each, and an operator UI writes via the
 * route. This replaces the scatter of `process.env.MONKEY_*_LIVE` reads so the
 * operator controls every feature from one pane of glass instead of Railway env.
 *
 * Scope: ONLY operator MANDATE / FEATURE on-off toggles. Numeric CALIBRATION
 * thresholds are observer-derived per the P1 doctrine and never live here.
 *
 * Fail-soft: on a DB error the cache simply isn't refreshed and each getter
 * returns the SAFE default the caller supplies (the same default the prior env
 * read used). Callers must pass a default that fails to the safe state.
 */

import { query } from '../db/connection.js';
import { logger } from '../utils/logger.js';

const CACHE_TTL_MS = 15 * 1000;

let cache: Map<string, string> | null = null;
let cachedAt = 0;

export interface FeatureFlagRecord {
  flagKey: string;
  value: string;
  updatedBy: string | null;
  updatedAt: Date;
}

/**
 * Load all flags into the cache (TTL-bounded). On DB error the previous cache
 * is kept (or stays null on a cold failure); getters then fall back to the
 * caller's safe default.
 */
async function ensureCache(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_TTL_MS) return cache;
  try {
    const result = await query(`SELECT flag_key, value FROM monkey_feature_flags`);
    const next = new Map<string, string>();
    for (const row of result.rows as unknown as Array<{ flag_key: string; value: string }>) {
      next.set(row.flag_key, row.value);
    }
    cache = next;
    cachedAt = now;
    return cache;
  } catch (err) {
    logger.warn('[featureFlags] DB read failed — callers fall back to safe defaults', {
      err: err instanceof Error ? err.message : String(err),
    });
    // Keep whatever we had; if cold, return an empty map so callers use their
    // own safe default rather than crashing.
    return cache ?? new Map<string, string>();
  }
}

/**
 * Boolean flag. `safeDefault` is returned when the flag is absent or the DB is
 * unreachable — it MUST be the value that fails to the safe state for this flag
 * (e.g. shorts → false; protective exits → true).
 */
export async function getBoolFlag(key: string, safeDefault: boolean): Promise<boolean> {
  const flags = await ensureCache();
  const raw = flags.get(key);
  if (raw === undefined) return safeDefault;
  return raw.trim().toLowerCase() === 'true';
}

/** Numeric flag (for future value controls). Returns safeDefault when absent/unparseable. */
export async function getNumberFlag(key: string, safeDefault: number): Promise<number> {
  const flags = await ensureCache();
  const raw = flags.get(key);
  if (raw === undefined) return safeDefault;
  const v = Number(raw);
  return Number.isFinite(v) ? v : safeDefault;
}

/** String flag (for future CSV/value controls). */
export async function getStringFlag(key: string, safeDefault: string): Promise<string> {
  const flags = await ensureCache();
  return flags.get(key) ?? safeDefault;
}

/** Full list for the UI/audit endpoint (forces a fresh read). */
export async function getAllFlags(): Promise<FeatureFlagRecord[]> {
  cachedAt = 0; // force refresh so the UI sees current metadata
  await ensureCache();
  const result = await query(
    `SELECT flag_key, value, updated_by, updated_at
       FROM monkey_feature_flags ORDER BY flag_key`,
  );
  return (result.rows as unknown as Array<{ flag_key: string; value: string; updated_by: string | null; updated_at: string }>)
    .map((r) => ({
      flagKey: r.flag_key,
      value: r.value,
      updatedBy: r.updated_by ?? null,
      updatedAt: new Date(r.updated_at),
    }));
}

/**
 * Set a flag. Upserts the row, invalidates the cache so the next read (≤ one
 * tick later) sees the new value. Returns the updated record.
 */
export async function setFlag(
  key: string,
  value: string,
  operator: string,
): Promise<FeatureFlagRecord> {
  await query(
    `INSERT INTO monkey_feature_flags (flag_key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
     ON CONFLICT (flag_key)
       DO UPDATE SET value = EXCLUDED.value,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = NOW()`,
    [key, value, operator],
  );
  cachedAt = 0; // invalidate
  const result = await query(
    `SELECT flag_key, value, updated_by, updated_at FROM monkey_feature_flags WHERE flag_key = $1`,
    [key],
  );
  const row = (result.rows as unknown as Array<{ flag_key: string; value: string; updated_by: string | null; updated_at: string }>)[0];
  if (!row) throw new Error(`Failed to read back feature flag after upsert: ${key}`);
  logger.info('[featureFlags] updated', { flagKey: key, value, updatedBy: operator });
  return {
    flagKey: row.flag_key,
    value: row.value,
    updatedBy: row.updated_by ?? null,
    updatedAt: new Date(row.updated_at),
  };
}

/** Exposed for tests to clear the cache between cases. */
export function __resetFeatureFlagsCache(): void {
  cache = null;
  cachedAt = 0;
}
