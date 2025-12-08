#!/usr/bin/env node

/**
 * Database setup script for Railway PostgreSQL
 * This script sets up the database schema without PostGIS dependencies
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pkg from 'pg';

const { Client } = pkg;

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database configuration
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

async function runMigration() {
  const client = new Client(dbConfig);
  
  try {
    console.log('🔗 Connecting to Railway PostgreSQL database...');
    await client.connect();
    
    console.log('✅ Connected to database');
    
    // Read the schema file
    const schemaPath = join(__dirname, '../src/db/schema-no-postgis.sql');
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
    console.log('ℹ️  You can now start the backend server');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Check if DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set');
  console.error('Please set the DATABASE_URL environment variable and try again');
  process.exit(1);
}

// Run the migration
runMigration();