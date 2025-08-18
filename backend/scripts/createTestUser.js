import bcrypt from 'bcryptjs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

async function createTestUser() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    // Hash the password
    const passwordHash = await bcrypt.hash('I.Am.Dev.1', 12);

    // Create the user
    const query = `
      INSERT INTO users (username, email, password_hash, role, country_code, timezone)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          username = EXCLUDED.username
      RETURNING id, username, email, role`;

    const values = [
      'testuser',
      'braden.lang77@gmail.com',
      passwordHash,
      'trader',
      'US',
      'UTC'
    ];

    const result = await pool.query(query, values);
    console.log('✅ Test user created/updated successfully:', result.rows[0]);
  } catch (error) {
    console.error('❌ Error creating test user:', error);
  } finally {
    await pool.end();
  }
}

createTestUser();
