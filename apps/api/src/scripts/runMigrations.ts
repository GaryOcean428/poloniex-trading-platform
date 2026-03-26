import { pool } from '../db/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run all pending database migrations from apps/api/database/migrations/.
 * Uses the schema_migrations table to track which migrations have already been applied.
 * Safe to call on every startup — already-applied migrations are skipped.
 */
export async function runAllMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, '../../database/migrations');

  if (!fs.existsSync(migrationsDir)) {
    logger.warn(`Migrations directory not found: ${migrationsDir}`);
    return;
  }

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter(file => /^\d+_.*\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (migrationFiles.length === 0) {
    logger.info('No migration files found');
    return;
  }

  const client = await pool.connect();
  try {
    // Ensure schema_migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const appliedRows = await client.query('SELECT migration_name FROM schema_migrations');
    const appliedMigrations = new Set(
      appliedRows.rows.map((row: { migration_name: string }) => row.migration_name)
    );

    let applied = 0;
    let skipped = 0;

    for (const migrationFile of migrationFiles) {
      if (appliedMigrations.has(migrationFile)) {
        logger.debug(`Skipping already applied migration: ${migrationFile}`);
        skipped++;
        continue;
      }

      const migrationPath = path.join(migrationsDir, migrationFile);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      logger.info(`Running migration: ${migrationFile}`);
      await client.query(migrationSQL);
      await client.query(
        'INSERT INTO schema_migrations (migration_name) VALUES ($1) ON CONFLICT (migration_name) DO NOTHING',
        [migrationFile]
      );
      logger.info(`✅ Migration ${migrationFile} completed`);
      applied++;
    }

    logger.info(`Migrations complete: ${applied} applied, ${skipped} skipped`);
  } finally {
    client.release();
  }
}
