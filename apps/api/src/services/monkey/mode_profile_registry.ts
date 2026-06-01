/**
 * mode_profile_registry.ts — mode profile parameter loader from monkey_parameters.
 * (#763 MODES-1: operational thresholds out of hardcoded MODE_PROFILES)
 *
 * Loads operational mode profile values from the monkey_parameters registry
 * at startup (not per-tick). Falls back to the original hardcoded defaults
 * if the registry is unavailable or a key is missing.
 *
 * Safety values (sovereignCapFloor, canEnter) remain hardcoded in modes.ts
 * as they are safety bounds (P25 allows this).
 *
 * P5:  Observer sets all params.
 * P14: All parameter governance via monkey_parameters table.
 * P25: Only safety bounds may be hardcoded.
 */
import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

// Hardcoded safety bounds — these NEVER come from the registry (P25).
export const SAFETY_BOUNDS = {
  EXPLORATION:   { sovereignCapFloor: 50,  canEnter: true  },
  INVESTIGATION: { sovereignCapFloor: 15,  canEnter: true  },
  INTEGRATION:   { sovereignCapFloor: 5,   canEnter: true  },
  DRIFT:         { sovereignCapFloor: 1,   canEnter: false },
} as const;

export type OpKeys = 'tpBaseFrac' | 'slRatio' | 'entryThresholdScale' | 'sizeFloor' | 'tickMs';

// Default operational values — fallback if registry is unavailable.
// Must stay in sync with the seed values in 070_mode_profile_params.sql.
export const OP_DEFAULTS: Record<string, Record<OpKeys, number>> = {
  EXPLORATION:   { tpBaseFrac: 0.004, slRatio: 0.6, entryThresholdScale: 0.9, sizeFloor: 0.20, tickMs: 15_000 },
  INVESTIGATION: { tpBaseFrac: 0.008, slRatio: 0.5, entryThresholdScale: 1.0, sizeFloor: 0.25, tickMs: 30_000 },
  INTEGRATION:   { tpBaseFrac: 0.020, slRatio: 0.3, entryThresholdScale: 1.1, sizeFloor: 0.30, tickMs: 60_000 },
  DRIFT:         { tpBaseFrac: 0.005, slRatio: 0.6, entryThresholdScale: 99,  sizeFloor: 0,    tickMs: 60_000 },
};

let cachedProfiles: Record<string, Record<OpKeys, number>> | null = null;

/**
 * Load operational mode profile params from monkey_parameters and return
 * a per-mode map. Merges registry values over defaults so a missing row
 * silently keeps the default rather than blowing up.
 *
 * Result is cached; subsequent calls return the same object unless
 * `invalidateModeProfileCache()` is called first.
 */
export async function loadModeProfilesFromRegistry(): Promise<Record<string, Record<OpKeys, number>>> {
  if (cachedProfiles !== null) return cachedProfiles;

  // Deep-clone defaults so mutations don't affect the baseline.
  const profiles: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(OP_DEFAULTS));

  try {
    const result = await pool.query<{ name: string; value: number }>(
      `SELECT name, value FROM monkey_parameters WHERE name LIKE 'mode.%'`,
    );

    for (const row of result.rows) {
      // name format: 'mode.EXPLORATION.tpBaseFrac'
      const parts = row.name.split('.');
      if (parts.length !== 3 || parts[0] !== 'mode') continue;
      const [, modeName, paramName] = parts;
      if (!(modeName in profiles)) continue;
      if (!Number.isFinite(row.value)) continue;
      profiles[modeName][paramName] = row.value;
    }

    logger.info('[mode_profile_registry] loaded mode profiles from registry', {
      count: result.rows.length,
    });
  } catch (err) {
    logger.warn('[mode_profile_registry] registry load failed, using hardcoded defaults', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  cachedProfiles = profiles as Record<string, Record<OpKeys, number>>;
  return cachedProfiles;
}

/** Clear the in-process cache so the next call re-reads from the DB. */
export function invalidateModeProfileCache(): void {
  cachedProfiles = null;
}

export function getCachedModeProfiles(): Record<string, Record<OpKeys, number>> | null {
  return cachedProfiles;
}
