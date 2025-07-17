#!/usr/bin/env node

import bcrypt from 'bcrypt';
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pkg;

// Use environment variable for database URL
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

async function updatePassword() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    console.log('🔗 Connecting to database...');
    await client.connect();
    
    // Generate password hash
    const password = process.env.DEFAULT_PASSWORD || "I.Am.Dev.1";
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