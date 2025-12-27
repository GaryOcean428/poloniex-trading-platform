/**
 * Comprehensive migration runner for Railway environment
 * Run with: node run-migration.js [migration_number]
 * Example: node run-migration.js 008
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
    // Get migration number from command line args (default to 'all')
    const migrationArg = process.argv[2];
    
    console.log('🔄 Starting database migrations...\n');
    
    // Migration 1: Add encryption_tag column to api_credentials
    console.log('📝 Migration 1: Add encryption_tag column...');
    const checkEncryption = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'api_credentials' 
      AND column_name = 'encryption_tag'
    `);
    
    if (checkEncryption.rows.length === 0) {
      await client.query(`
        ALTER TABLE api_credentials 
        ADD COLUMN encryption_tag TEXT
      `);
      console.log('✅ Added encryption_tag column\n');
    } else {
      console.log('✅ encryption_tag column already exists\n');
    }
    
    // Migration 2: Create trades table
    console.log('📝 Migration 2: Create trades table...');
    const checkTrades = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'trades'
    `);
    
    if (checkTrades.rows.length === 0) {
      const migrationPath = path.join(__dirname, 'database', 'migrations', '008_create_trades_table.sql');
      
      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        await client.query(migrationSQL);
        console.log('✅ Created trades table\n');
        
        // Verify table creation
        const columns = await client.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns
          WHERE table_name = 'trades'
          ORDER BY ordinal_position
        `);
        
        console.log('📋 trades table columns:');
        columns.rows.forEach(row => {
          console.log(`   - ${row.column_name} (${row.data_type})`);
        });
        console.log('');
      } else {
        console.log('⚠️  Migration file not found, skipping\n');
      }
    } else if (migrationArg === '008') {
      console.log('⚠️  trades table already exists, skipping re-creation to avoid conflicts\n');
    } else {
      console.log('✅ trades table already exists\n');
    }
    
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
