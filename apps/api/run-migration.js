/**
 * Simple migration runner for Railway environment
 * Run with: node run-migration.js
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Running migration: add encryption_tag column...');
    
    // Check if column exists
    const checkResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'api_credentials' 
      AND column_name = 'encryption_tag'
    `);
    
    if (checkResult.rows.length > 0) {
      console.log('✅ encryption_tag column already exists');
      return;
    }
    
    // Add the column
    await client.query(`
      ALTER TABLE api_credentials 
      ADD COLUMN encryption_tag TEXT
    `);
    
    console.log('✅ Added encryption_tag column successfully');
    
    // Show current schema
    const schemaResult = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns
      WHERE table_name = 'api_credentials'
      ORDER BY ordinal_position
    `);
    
    console.log('\n📋 api_credentials table columns:');
    schemaResult.rows.forEach(row => {
      console.log(`   - ${row.column_name} (${row.data_type})`);
    });
    
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => {
    console.log('\n✨ Migration completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error.message);
    process.exit(1);
  });
