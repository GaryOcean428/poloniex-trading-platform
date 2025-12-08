#!/usr/bin/env node
/**
 * Upsert a user (create or update) with a given username/email/password.
 *
 * Usage examples:
 *   railway run -s polytrade-be node backend/scripts/upsertUser.js --username GaryOcean --email garyocean@polytrade.com --password "I.Am.Dev.1" --role trader
 *   railway run -s polytrade-be node backend/scripts/upsertUser.js --email braden.lang77@gmail.com --username GaryOcean --password "I.Am.Dev.1"
 *
 * Notes:
 * - Requires process.env.DATABASE_URL (Railway provides it in the backend service).
 * - If a user exists by username or email (case-insensitive), it will be updated.
 * - Otherwise a new user will be inserted.
 */
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import pg from 'pg';

dotenv.config();

const { Client } = pg;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const usernameRaw = (args.username || '').trim();
const emailRaw = (args.email || '').trim();
const passwordRaw = (args.password || process.env.DEFAULT_PASSWORD || '').trim();
const role = (args.role || 'trader').trim();
const country = (args.country || 'US').trim();
const tz = (args.timezone || 'UTC').trim();

if (!usernameRaw || !emailRaw || !passwordRaw) {
  console.error('❌ Missing required args. Provide --username, --email, and --password.');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

const username = usernameRaw;
const email = emailRaw.toLowerCase();

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    const passwordHash = await bcrypt.hash(passwordRaw, 10);

    // Look for an existing user by username or email (case-insensitive)
    const { rows } = await client.query(
      `SELECT id, username, email FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2) LIMIT 1`,
      [username, email]
    );

    if (rows.length > 0) {
      const existing = rows[0];
      console.log('ℹ️ Existing user found, updating:', { id: existing.id, username: existing.username, email: existing.email });

      const updateRes = await client.query(
        `UPDATE users
         SET username = $1,
             email = $2,
             password_hash = $3,
             role = $4,
             country_code = $5,
             timezone = $6,
             updated_at = NOW()
         WHERE id = $7
         RETURNING id, username, email, role, updated_at`,
        [username, email, passwordHash, role, country, tz, existing.id]
      );

      console.log('✅ User updated:', updateRes.rows[0]);
    } else {
      console.log('ℹ️ No existing user found, inserting new user...');
      const insertRes = await client.query(
        `INSERT INTO users (username, email, password_hash, role, country_code, timezone, is_active, is_verified, kyc_status, trading_enabled)
         VALUES ($1, $2, $3, $4, $5, $6, true, false, 'pending', true)
         RETURNING id, username, email, role, created_at`,
        [username, email, passwordHash, role, country, tz]
      );

      console.log('✅ User inserted:', insertRes.rows[0]);
    }

    // Final check: try bcrypt compare for sanity
    const { rows: pwRows } = await client.query(
      `SELECT password_hash FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2) LIMIT 1`,
      [username, email]
    );
    if (pwRows.length > 0) {
      const ok = await bcrypt.compare(passwordRaw, pwRows[0].password_hash);
      console.log(ok ? '🔐 Password matches (bcrypt compare passed).' : '🔐 Password DOES NOT match.');
    }
  } catch (err) {
    console.error('❌ Upsert error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
