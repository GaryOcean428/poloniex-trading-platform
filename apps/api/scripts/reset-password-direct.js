/**
 * Direct database password reset script
 * Bypasses API authentication to reset user passwords
 */

import bcrypt from 'bcryptjs';
import { pool } from '../src/db/connection.js';

async function resetPassword(username, newPassword) {
  try {
    console.log(`Resetting password for user: ${username}`);
    
    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update the password in the database
    const result = await pool.query(
      'UPDATE users SET password = $1 WHERE username = $2 RETURNING id, username, email',
      [hashedPassword, username]
    );
    
    if (result.rows.length === 0) {
      console.error(`User ${username} not found`);
      process.exit(1);
    }
    
    const user = result.rows[0];
    console.log(`✅ Password reset successful for user: ${user.username} (${user.email})`);
    console.log(`New password: ${newPassword}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Password reset failed:', error);
    process.exit(1);
  }
}

// Get username and password from command line args
const username = process.argv[2] || 'GaryOcean';
const password = process.argv[3] || 'I.Am.Dev.1';

resetPassword(username, password);
