/**
 * Execution Mode — global safety override for the autonomous pipeline.
 *
 * Three mutually-exclusive states, persisted to agent_execution_mode:
 *   - 'auto'       → pipeline runs end-to-end (default)
 *   - 'paper_only' → all live orders are blocked; paper continues
 *   - 'pause'      → all new orders are blocked at every stage
 *
 * The risk kernel reads the cached value on every order submission
 * via isExecutionModeAllowingOrder / isLiveExecutionAllowed. Cache
 * TTL is 30s so operator flips from the UI take effect within a
 * short window without making every order submission a DB roundtrip.
 */

import { query } from '../db/connection.js';
import { logger } from '../utils/logger.js';
// Re-export from riskKernel so the kernel + service + routes share one
// definition and can't drift. Tests and routes can import from either
// module without risk.
export type { ExecutionMode } from './riskKernel.js';
import type { ExecutionMode } from './riskKernel.js';

const CACHE_TTL_MS = 30 * 1000;
// Shorter TTL on fail-closed entries so a recovered DB is picked up
// within a minute, but long enough that a sustained outage doesn't
// send one query per order.
const FAIL_CLOSED_CACHE_TTL_MS = 30 * 1000;

interface ModeRecord {
  mode: ExecutionMode;
  updatedAt: Date;
  updatedBy: string | null;
  reason: string | null;
}

let cached: ModeRecord | null = null;
let cachedAt = 0;
let cachedIsFailClosed = false;

/**
 * Read the current mode. Cached for CACHE_TTL_MS. On DB error we
 * fail CLOSED — return 'pause' to prevent orders — because an
 * unknown mode at order-submit time is strictly worse than blocking.
 */
export async function getCurrentExecutionMode(): Promise<ExecutionMode> {
  const now = Date.now();
  const effectiveTtl = cachedIsFailClosed ? FAIL_CLOSED_CACHE_TTL_MS : CACHE_TTL_MS;
  if (cached && now - cachedAt < effectiveTtl) return cached.mode;
  try {
    const result = await query(
      `SELECT mode, updated_at, updated_by, reason
         FROM agent_execution_mode
        WHERE id = 1`,
    );
    const row = (result.rows as any[])[0];
    if (!row) {
      logger.warn('[executionMode] agent_execution_mode singleton missing — defaulting to pause');
      // Cache the fail-closed state so subsequent calls don't re-query
      // the DB while the singleton is missing.
      cacheFailClosed(now, 'singleton_missing');
      return 'pause';
    }
    cached = {
      mode: row.mode as ExecutionMode,
      updatedAt: new Date(row.updated_at as string),
      updatedBy: row.updated_by ?? null,
      reason: row.reason ?? null,
    };
    cachedAt = now;
    cachedIsFailClosed = false;
    return cached.mode;
  } catch (err) {
    logger.error('[executionMode] DB read failed — failing closed to pause', {
      err: err instanceof Error ? err.message : String(err),
    });
    // Cache the fail-closed decision. Sourcery flagged that without
    // this, every order submission during a DB outage re-queries and
    // re-logs, amplifying DB pressure on an already-struggling system.
    cacheFailClosed(now, 'db_read_failed');
    return 'pause';
  }
}

function cacheFailClosed(now: number, reason: string): void {
  cached = {
    mode: 'pause',
    updatedAt: new Date(now),
    updatedBy: 'fail_closed',
    reason,
  };
  cachedAt = now;
  cachedIsFailClosed = true;
}

/** Full record for UI/audit endpoints. */
export async function getExecutionModeRecord(): Promise<ModeRecord | null> {
  // Force-refresh the cache on every audit read so UI shows fresh metadata.
  cachedAt = 0;
  await getCurrentExecutionMode();
  return cached;
}

/**
 * Update the mode. Writes to DB, invalidates the cache so the next
 * read sees the new value. Returns the new record.
 */
export async function setExecutionMode(
  mode: ExecutionMode,
  operator: string,
  reason: string | null = null,
): Promise<ModeRecord> {
  if (mode !== 'auto' && mode !== 'paper_only' && mode !== 'pause') {
    throw new Error(`Invalid execution mode: ${mode}`);
  }
  await query(
    `UPDATE agent_execution_mode
        SET mode = $1,
            updated_by = $2,
            updated_at = NOW(),
            reason = $3
      WHERE id = 1`,
    [mode, operator, reason],
  );
  cachedAt = 0; // invalidate
  const record = await getExecutionModeRecord();
  if (!record) throw new Error('Failed to read back execution mode after update');
  logger.info('[executionMode] updated', {
    mode: record.mode,
    updatedBy: record.updatedBy,
    reason: record.reason,
  });
  return record;
}

/** Convenience: can any order fire right now? False only when paused. */
export async function isOrderExecutionAllowed(): Promise<boolean> {
  return (await getCurrentExecutionMode()) !== 'pause';
}

/** Convenience: can a LIVE order fire right now? False in pause or paper-only. */
export async function isLiveExecutionAllowed(): Promise<boolean> {
  return (await getCurrentExecutionMode()) === 'auto';
}

/** Exposed for tests to clear the cache between cases. */
export function __resetExecutionModeCache(): void {
  cached = null;
  cachedAt = 0;
  cachedIsFailClosed = false;
}
