#!/usr/bin/env node

/**
 * Update user password script using Railway environment variables
 */

import bcrypt from 'bcryptjs';
import pkg from 'pg';
const { Client } = pkg;

// Use Railway database URL from environment variables
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL or DATABASE_PUBLIC_URL environment variable is required');
  process.exit(1);
}

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function updateUserPassword(username, newPassword) {
  try {
    await client.connect();
    
    console.log(`🔑 Updating password for user: ${username}...`);
    
    // Hash the new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Update the password in the database
    const result = await client.query(
      'UPDATE users SET password_hash = $1 WHERE username = $2',
      [hashedPassword, username]
    );
    
    if (result.rowCount > 0) {
      console.log(`✅ Password updated successfully for ${username}`);
      
      // Verify the update worked
      const user = await client.query('SELECT password_hash FROM users WHERE username = $1', [username]);
      if (user.rows.length > 0) {
        const isValid = await bcrypt.compare(newPassword, user.rows[0].password_hash);
        console.log('Password verification:', isValid ? '✅ VALID' : '❌ INVALID');
      }
    } else {
      console.log(`❌ No user found with username: ${username}`);
    }
    
  } catch (error) {
    console.error('Error updating password:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Get command line arguments
const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: node update-user-password.js <username> <new-password>');
  console.error('Example: node update-user-password.js GaryOcean "I.Am.Dev.1"');
  process.exit(1);
}

const [username, newPassword] = args;

// Run the update
updateUserPassword(username, newPassword);