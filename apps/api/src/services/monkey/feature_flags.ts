/**
 * feature_flags.ts — lightweight DB-backed feature flag reader.
 * (#1033 PR2, migration 068 schema)
 *
 * Reads from monkey_feature_flags (flag_key TEXT, value TEXT).
 * Cache with 60s TTL to avoid per-tick DB reads.
 * All reads are best-effort: on DB error, falls back to defaultValue
 * and never blocks trading.
 */
import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

const cache = new Map<string, { value: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export async function isFeatureEnabled(key: string, defaultValue = false): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now < cached.expiresAt) return cached.value;
  try {
    const result = await pool.query<{ value: string }>(
      `SELECT value FROM monkey_feature_flags WHERE flag_key = $1`,
      [key],
    );
    const raw = result.rows[0]?.value;
    const value = raw != null ? raw.toLowerCase() === 'true' : defaultValue;
    cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  } catch (err) {
    logger.warn('[feature_flags] read failed (using default)', {
      key, defaultValue, err: err instanceof Error ? err.message : String(err),
    });
    return defaultValue;
  }
}
