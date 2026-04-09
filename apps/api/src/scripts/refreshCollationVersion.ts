import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';

const SYSTEM_DATABASES = ['postgres', 'template1'] as const;
const NON_FATAL_SQLSTATE_CODES = new Set([
  '42501', // insufficient_privilege
  '55006', // object_in_use
  '3D000', // invalid_catalog_name (database does not exist)
  '0A000', // feature_not_supported
]);

type PgError = Error & {
  code?: string;
  detail?: string;
};

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function parseDatabaseNameFromConnectionString(
  connectionString: string | undefined
): string | null {
  if (!connectionString) {
    return null;
  }

  try {
    const parsed = new URL(connectionString);
    const rawName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    return rawName || null;
  } catch {
    return null;
  }
}

export function buildCollationRefreshTargets(currentDatabase: string): string[] {
  const ordered = [currentDatabase, ...SYSTEM_DATABASES];
  return [...new Set(ordered)];
}

async function refreshCollationVersionForDatabase(databaseName: string): Promise<void> {
  try {
    await pool.query(`ALTER DATABASE ${quoteIdentifier(databaseName)} REFRESH COLLATION VERSION;`);
    logger.info('✅ Refreshed database collation version metadata', { databaseName });
  } catch (error) {
    const pgError = error as PgError;
    const isNonFatal = pgError.code ? NON_FATAL_SQLSTATE_CODES.has(pgError.code) : false;
    const message = pgError.message || 'Unknown database error';

    if (isNonFatal) {
      logger.warn('Skipping non-fatal collation refresh failure', {
        databaseName,
        code: pgError.code,
        message,
        detail: pgError.detail
      });
      return;
    }

    logger.error('Unexpected collation refresh failure', {
      databaseName,
      code: pgError.code,
      message,
      detail: pgError.detail
    });
  }
}

export async function refreshKnownDatabaseCollationVersions(): Promise<void> {
  let currentDatabase: string | null = null;

  try {
    const result = await pool.query<{ db: string }>('SELECT current_database() AS db;');
    currentDatabase = result.rows[0]?.db ?? null;
  } catch (error) {
    const pgError = error as PgError;
    logger.warn('Failed to query current database name, using DATABASE_URL fallback', {
      code: pgError.code,
      message: pgError.message
    });
  }

  const resolvedCurrentDatabase =
    currentDatabase ?? parseDatabaseNameFromConnectionString(process.env.DATABASE_URL);

  if (!resolvedCurrentDatabase) {
    logger.warn('Skipping collation refresh: unable to determine target database name');
    return;
  }

  const targets = buildCollationRefreshTargets(resolvedCurrentDatabase);
  logger.info('Running PostgreSQL collation refresh for known databases', { targets });

  for (const databaseName of targets) {
    await refreshCollationVersionForDatabase(databaseName);
  }
}
