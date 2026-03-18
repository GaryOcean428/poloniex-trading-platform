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
    const migrationArg = process.argv[2] ?? 'all';
    
    console.log('🔄 Starting database migrations...\n');

    const migrationsDir = path.join(__dirname, 'database', 'migrations');
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter(file => /^\d+_.*\.sql$/.test(file))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const selectedMigrations =
      migrationArg === 'all'
        ? migrationFiles
        : migrationFiles.filter(file => file.startsWith(`${migrationArg}_`));

    if (selectedMigrations.length === 0) {
      throw new Error(`No migration file found for "${migrationArg}"`);
    }

    for (const migrationFile of selectedMigrations) {
      const migrationPath = path.join(migrationsDir, migrationFile);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      console.log(`📝 Running ${migrationFile}...`);
      await client.query(migrationSQL);
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
