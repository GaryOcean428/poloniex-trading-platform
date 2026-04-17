#!/usr/bin/env node
/**
 * Legacy backtest purge — soft-delete phase.
 *
 * Identifies rows in backtest_results / strategy_performance / autonomous_trades
 * / paper_trading_sessions that were written before engine_version tagging
 * existed (engine_version IS NULL), stamps them with deleted_at, writes an
 * audit row to data_purges, and returns row counts.
 *
 * The red team flagged irreversible production deletes as unacceptable, so
 * this script:
 *   - requires PURGE_LEGACY_BACKTESTS=true (feature flag gate),
 *   - defaults to DRY-RUN mode unless --execute is passed,
 *   - performs soft-delete only (no DROP, no TRUNCATE, no DELETE). Hard
 *     delete is a separate script (Commit 7) that runs only after the
 *     7-day soft-delete window has elapsed without rollback.
 *
 * Usage:
 *   # Preview what would be purged
 *   PURGE_LEGACY_BACKTESTS=true node apps/api/scripts/purge-legacy-backtests.mjs
 *
 *   # Execute the soft-delete
 *   PURGE_LEGACY_BACKTESTS=true node apps/api/scripts/purge-legacy-backtests.mjs --execute
 *
 * Run the backup script (apps/api/scripts/backup-pre-purge.mjs) before
 * --execute, always.
 */

import pg from 'pg';

const { Pool } = pg;

const TARGET_TABLES = [
  'backtest_results',
  'strategy_performance',
  'autonomous_trades',
  'paper_trading_sessions',
];

function requireFlag() {
  if (process.env.PURGE_LEGACY_BACKTESTS !== 'true') {
    console.error(
      '[purge] Refusing to run without PURGE_LEGACY_BACKTESTS=true env flag.\n' +
      '        This guard prevents accidental invocation in CI/build pipelines.',
    );
    process.exit(1);
  }
}

function parseArgs(argv) {
  return {
    execute: argv.includes('--execute'),
    reason: getFlagValue(argv, '--reason') ?? 'legacy_unit_misattribution_purge',
    operator: getFlagValue(argv, '--operator') ?? process.env.USER ?? 'system',
  };
}

function getFlagValue(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx === argv.length - 1) return null;
  return argv[idx + 1];
}

/** Pure function — count legacy rows. Exported for tests. */
export async function countLegacyRows(pool, table) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE engine_version IS NULL AND deleted_at IS NULL`,
  );
  return rows[0]?.n ?? 0;
}

/** Pure function — soft-delete legacy rows and return count. Exported for tests. */
export async function softDeleteLegacyRows(pool, table) {
  const { rowCount } = await pool.query(
    `UPDATE ${table}
     SET deleted_at = NOW()
     WHERE engine_version IS NULL AND deleted_at IS NULL`,
  );
  return rowCount ?? 0;
}

async function recordPurgeAudit(pool, entry) {
  await pool.query(
    `INSERT INTO data_purges
      (purge_kind, target_table, rows_affected, phase, engine_version, reason, operator)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.purgeKind,
      entry.targetTable,
      entry.rowsAffected,
      entry.phase,
      entry.engineVersion,
      entry.reason,
      entry.operator,
    ],
  );
}

async function main() {
  requireFlag();
  const { execute, reason, operator } = parseArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[purge] DATABASE_URL is required.');
    process.exit(1);
  }

  // engine_version is written by the API. Read it from the process that
  // invokes this script so the audit row is attributed to the current SHA.
  const engineVersion =
    process.env.ENGINE_VERSION ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_SHA ??
    'unknown';

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const report = [];
    for (const table of TARGET_TABLES) {
      const count = await countLegacyRows(pool, table);
      report.push({ table, legacyRows: count });
    }

    console.log(`[purge] mode=${execute ? 'EXECUTE' : 'DRY-RUN'} reason=${reason}`);
    console.table(report);

    if (!execute) {
      console.log('[purge] DRY-RUN — no rows modified. Re-run with --execute to soft-delete.');
      return;
    }

    for (const { table } of report) {
      const affected = await softDeleteLegacyRows(pool, table);
      await recordPurgeAudit(pool, {
        purgeKind: 'legacy_backtests',
        targetTable: table,
        rowsAffected: affected,
        phase: 'soft_delete',
        engineVersion,
        reason,
        operator,
      });
      console.log(`[purge] soft-deleted ${affected} rows from ${table}`);
    }

    console.log('[purge] Soft-delete complete. Hard delete is a separate script run after 7 days.');
  } finally {
    await pool.end();
  }
}

// Only run main() when executed directly (so tests can import helpers).
// Use fileURLToPath for robust cross-platform matching (handles Windows
// drive letters that `startsWith('file://')` would miss).
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[purge] fatal:', err);
    process.exit(1);
  });
}
