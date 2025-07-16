#!/usr/bin/env node

/**
 * Test database connection using Railway environment variables
 */

import pkg from 'pg';
const { Client } = pkg;

// Use Railway database URL from environment variables
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL or DATABASE_PUBLIC_URL environment variable is required');
  process.exit(1);
}

async function testConnection() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    console.log('🔗 Testing database connection...');
    console.log('Using DATABASE_URL:', DATABASE_URL.replace(/:[^:]*@/, ':***@')); // Mask password
    
    await client.connect();
    console.log('✅ Database connection successful');
    
    // Test basic query
    const result = await client.query('SELECT NOW() as current_time');
    console.log('✅ Database query successful:', result.rows[0].current_time);
    
    // Check if users table exists and has data
    const userCount = await client.query('SELECT COUNT(*) as count FROM users');
    console.log(`✅ Users table exists with ${userCount.rows[0].count} users`);
    
    // List users
    const users = await client.query('SELECT username, email, role FROM users LIMIT 5');
    console.log('👤 Users in database:');
    users.rows.forEach(user => {
      console.log(`  - ${user.username} (${user.email}) - Role: ${user.role}`);
    });
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

testConnection();