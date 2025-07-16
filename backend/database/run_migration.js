import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database connection configuration
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

const dbConfig = {
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  query_timeout: 15000,
};

const pool = new Pool(dbConfig);

async function runMigration() {
  let client = null;
  
  try {
    console.log('🔗 Connecting to database...');
    client = await pool.connect();
    
    console.log('📄 Reading migration file...');
    const migrationPath = path.join(__dirname, 'migrations', '001_futures_schema.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('🚀 Running futures schema migration...');
    await client.query(migrationSQL);
    
    console.log('✅ Futures schema migration completed successfully!');
    
    // Verify some tables were created
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE 'futures_%'
      ORDER BY table_name
    `);
    
    console.log('📊 Created futures tables:');
    tableCheck.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

runMigration();