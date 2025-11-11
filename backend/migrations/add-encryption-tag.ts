/**
 * Migration: Add encryption_tag column to api_credentials table
 * 
 * This migration adds the missing encryption_tag column required for
 * AES-256-GCM encryption authentication.
 */

import { pool } from '../src/db/connection.js';

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting migration: add encryption_tag column...');
    
    // Check if column exists
    const checkResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'api_credentials' 
      AND column_name = 'encryption_tag'
    `);
    
    if (checkResult.rows.length > 0) {
      console.log('✅ encryption_tag column already exists - skipping migration');
      return;
    }
    
    // Add the column
    await client.query(`
      ALTER TABLE api_credentials 
      ADD COLUMN encryption_tag TEXT
    `);
    
    console.log('✅ Successfully added encryption_tag column to api_credentials table');
    
    // Verify the column was added
    const verifyResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'api_credentials'
      ORDER BY ordinal_position
    `);
    
    console.log('\n📋 Current api_credentials table schema:');
    verifyResult.rows.forEach(row => {
      console.log(`   - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('\n✨ Migration completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error.message);
    process.exit(1);
  });
