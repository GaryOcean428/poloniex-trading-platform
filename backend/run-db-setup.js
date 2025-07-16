#!/usr/bin/env node

/**
 * Quick database setup script for Railway PostgreSQL
 * Run this to set up the database schema without PostGIS dependencies
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pkg from 'pg';

const { Client } = pkg;

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use Railway database URL
const DATABASE_URL = 'postgresql://postgres:HcsyUTnGVUNmdsKrWDHloHcTcwUzeteT@interchange.proxy.rlwy.net:45066/railway';

async function setupDatabase() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    console.log('🔗 Connecting to Railway PostgreSQL database...');
    await client.connect();
    
    console.log('✅ Connected to database');
    
    // Read the schema file
    const schemaPath = join(__dirname, 'src/db/schema-no-postgis.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    
    console.log('📋 Executing database schema...');
    
    // Execute the schema
    await client.query(schema);
    
    console.log('✅ Database schema created successfully');
    
    // Test the setup by querying the users table
    const testQuery = await client.query('SELECT COUNT(*) as count FROM users');
    console.log(`✅ Found ${testQuery.rows[0].count} users in the database`);
    
    // Show default users
    const users = await client.query('SELECT username, email, role FROM users');
    console.log('👤 Default users created:');
    users.rows.forEach(user => {
      console.log(`  - ${user.username} (${user.email}) - Role: ${user.role}`);
    });
    
    console.log('🎉 Database setup completed successfully!');
    console.log('');
    console.log('ℹ️  Default users all have password: "password"');
    console.log('ℹ️  You can now test login with:');
    console.log('   - username: admin, password: password');
    console.log('   - username: demo, password: password'); 
    console.log('   - username: trader, password: password');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    if (error.code === 'ECONNREFUSED') {
      console.error('Make sure the DATABASE_URL is correct and the database is running');
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the setup
setupDatabase();