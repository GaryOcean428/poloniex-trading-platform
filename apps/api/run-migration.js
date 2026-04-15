/**
 * Comprehensive migration runner for Railway environment
 * Run with: node run-migration.js [migration_number|all]
 * Examples:
 *   node run-migration.js
 *   node run-migration.js all
 *   node run-migration.js 011
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    // Prevent multiple instances (or restarts) from running migrations concurrently.
    // This is important on Railway where there may be overlapping deploys.
    // Uses an advisory lock scoped to the DB connection.
    await client.query('SELECT pg_advisory_lock(hashtext($1)::bigint)', [
      'polytrade:db-migrations',
    ]);

    const migrationArg = process.argv[2] ?? 'all';
    
    console.log('🔄 Starting database migrations...\n');

    const migrationsDir = path.join(__dirname, 'database', 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Migrations directory not found: ${migrationsDir}`);
    }

    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter(file => /^\d+_.*\.sql$/.test(file))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const selectedMigrations =
      migrationArg === 'all'
        ? migrationFiles
        : migrationFiles.filter(file => file.startsWith(`${migrationArg}_`));

    if (selectedMigrations.length === 0) {
      throw new Error(
        `No migration file found for "${migrationArg}". Expected pattern: "${migrationArg}_*.sql"`
      );
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const appliedRows = await client.query('SELECT migration_name FROM schema_migrations');
    const appliedMigrations = new Set(appliedRows.rows.map(row => row.migration_name));

    for (const migrationFile of selectedMigrations) {
      if (appliedMigrations.has(migrationFile)) {
        console.log(`⏭️  Skipping already applied migration: ${migrationFile}`);
        continue;
      }

      const migrationPath = path.join(migrationsDir, migrationFile);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      console.log(`📝 Running ${migrationFile}...`);
      await client.query('BEGIN');
      try {
        await client.query(migrationSQL);
        await client.query(
          'INSERT INTO schema_migrations (migration_name) VALUES ($1) ON CONFLICT (migration_name) DO NOTHING',
          [migrationFile]
        );
        await client.query('COMMIT');
      } catch (migrationError) {
        await client.query('ROLLBACK');
        throw migrationError;
      }
      console.log(`✅ ${migrationFile} completed`);
    }

    console.log('');

    // Summary of tables
    console.log('📊 Database tables summary:');
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log(`Total tables: ${tables.rows.length}`);
    if (tables.rows.length < 20) {
      tables.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
    }
    
      } catch (error) {
    console.error('❌ Migration error:', error.message);
    console.error('Stack trace:', error.stack);
    throw error;
  } finally {
        // Best-effort unlock (connection might already be in a bad state).
        try {
          await client.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [
            'polytrade:db-migrations',
          ]);
        } catch {
          // ignore
        }
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => {
    console.log('\n✨ All migrations completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error.message);
    process.exit(1);
  });
