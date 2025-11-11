/**
 * Fix API Credentials Script
 * Deletes old encrypted credentials that can't be decrypted
 * Run this before adding fresh credentials through the UI
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixCredentials() {
  const userId = '7e989bb1-9bbf-442d-a778-2086cd27d6ab'; // GaryOcean
  
  try {
    console.log('🔍 Checking for existing credentials...');
    
    const checkResult = await pool.query(
      'SELECT id, exchange, is_active, created_at FROM api_credentials WHERE user_id = $1',
      [userId]
    );
    
    if (checkResult.rows.length === 0) {
      console.log('✅ No credentials found - ready to add fresh ones!');
      await pool.end();
      return;
    }
    
    console.log(`📋 Found ${checkResult.rows.length} credential(s):`);
    checkResult.rows.forEach(row => {
      console.log(`   - ${row.exchange} (${row.is_active ? 'Active' : 'Inactive'}) - Created: ${row.created_at}`);
    });
    
    console.log('\n🗑️  Deleting old credentials...');
    
    const deleteResult = await pool.query(
      'DELETE FROM api_credentials WHERE user_id = $1',
      [userId]
    );
    
    console.log(`✅ Deleted ${deleteResult.rowCount} credential(s)`);
    console.log('\n✨ Database cleaned! You can now add fresh credentials through the UI.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixCredentials();
