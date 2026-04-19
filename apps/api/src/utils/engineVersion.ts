/**
 * Engine version provenance.
 *
 * Every row produced by the trading pipeline (backtests, paper trades,
 * strategy metrics, state events) is tagged with a git SHA so promotion
 * thresholds only aggregate rows written under the current code.
 *
 * Resolution order (first-hit wins, cached for process lifetime):
 *   1. env var  ENGINE_VERSION        (explicit override, use in tests/CI)
 *   2. env vars RAILWAY_GIT_COMMIT_SHA or GIT_SHA or VERCEL_GIT_COMMIT_SHA
 *      (set automatically by most deploy platforms)
 *   3. `git rev-parse HEAD` in the working tree (dev machines)
 *   4. literal string 'unknown' — never crashes, but promotion gates will
 *      reject 'unknown' rows from aggregates.
 */

import { execFileSync } from 'child_process';

let cached: string | null = null;

const PLATFORM_ENV_VARS = [
  'ENGINE_VERSION',
  'RAILWAY_GIT_COMMIT_SHA',
  'GIT_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'GITHUB_SHA',
];

function readFromEnv(): string | null {
  for (const key of PLATFORM_ENV_VARS) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value.trim().slice(0, 40);
    }
  }
  return null;
}

function readFromGit(): string | null {
  try {
    // execFileSync with a fixed arg list — no shell, no injection surface.
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 2_000,
    }).trim();
    return sha.length > 0 ? sha.slice(0, 40) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the current engine version. Cached after first call.
 *
 * Always returns a string (falls back to 'unknown' rather than throwing),
 * since the cost of blocking trading on a missing SHA is worse than
 * accepting an 'unknown'-tagged row that will later be filtered out of
 * promotion aggregates.
 */
export function getEngineVersion(): string {
  if (cached !== null) return cached;
  cached = readFromEnv() ?? readFromGit() ?? 'unknown';
  return cached;
}

/** Exposed for tests. Clears the module-level cache. */
export function __resetEngineVersionCache(): void {
  cached = null;
}
