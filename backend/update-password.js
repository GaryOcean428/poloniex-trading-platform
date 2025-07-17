#!/usr/bin/env node

import bcrypt from 'bcrypt';
import pkg from 'pg';

const { Client } = pkg;

// Use Railway database URL
const DATABASE_URL = "postgresql://postgres:HcsyUTnGVUNmdsKrWDHloHcTcwUzeteT@interchange.proxy.rlwy.net:45066/railway";

async function updatePassword() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    console.log('🔗 Connecting to database...');
    await client.connect();
    
    // Generate password hash
    const password = "I.Am.Dev.1";
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    console.log('🔐 Generated password hash for:', password);
    
    // Update the password
    await client.query(
      'UPDATE users SET password_hash = $1 WHERE username = $2',
      [hashedPassword, 'GaryOcean']
    );
    
    console.log('✅ Password updated successfully for GaryOcean');
    
  } catch (error) {
    console.error('❌ Error updating password:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

updatePassword();