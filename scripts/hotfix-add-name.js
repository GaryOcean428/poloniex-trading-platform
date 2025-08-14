#!/usr/bin/env node
/**
 * Hot-fix: ensure users.name exists and mirrors users.username
 * This addresses deployed code that may still reference "name" instead of "username".
 *
 * Operations:
 * 1) ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR;
 * 2) UPDATE users SET name = username WHERE name IS NULL;
 *
 * Requires: process.env.DATABASE_URL
 */
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

async function run() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('🛠️  Ensuring users.name column exists...');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR');

    console.log('🔁 Backfilling users.name from users.username where needed...');
    const res = await client.query('UPDATE users SET name = username WHERE name IS NULL');
    console.log(`✅ Backfill complete. Rows updated: ${res.rowCount}`);

    console.log('🎉 Hot-fix completed successfully.');
  } catch (err) {
    console.error('❌ Hot-fix failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
