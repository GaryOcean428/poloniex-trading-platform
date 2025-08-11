#!/usr/bin/env node
/**
 * Read-only user checker for production DB
 * Usage:
 *   node backend/scripts/checkUser.js --username GaryOcean [--password "I.Am.Dev.1"]
 * or
 *   node backend/scripts/checkUser.js --email user@example.com [--password "secret"]
 *
 * Requires: process.env.DATABASE_URL to be set (Railway recommended: `railway run -s polytrade-be node backend/scripts/checkUser.js --username GaryOcean --password "I.Am.Dev.1"`)
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
const identifierRaw = (args.username || args.email || '').trim();
const password = args.password || process.env.PASSWORD || null;

if (!identifierRaw) {
  console.error('❌ Provide --username or --email. Example: --username GaryOcean');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

const looksLikeEmail = identifierRaw.includes('@');
const identifier = identifierRaw.toLowerCase();

const query = looksLikeEmail
  ? 'SELECT id, username, email, role, is_active, is_verified, trading_enabled, created_at, password_hash FROM users WHERE LOWER(email) = $1 LIMIT 1'
  : 'SELECT id, username, email, role, is_active, is_verified, trading_enabled, created_at, password_hash FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1 LIMIT 1';

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔎 Connecting to database...');
    await client.connect();

    console.log(`🔍 Looking up user by ${looksLikeEmail ? 'email' : 'username/email'}: "${identifierRaw}"`);
    const res = await client.query(query, [identifier]);

    if (res.rows.length === 0) {
      console.log('❌ No user found for that identifier.');
      process.exit(2);
    }

    const user = res.rows[0];
    // do not print hash
    delete user.password_hash;

    console.log('✅ User found:');
    console.log({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      is_active: user.is_active,
      is_verified: user.is_verified,
      trading_enabled: user.trading_enabled,
      created_at: user.created_at
    });

    if (password) {
      const { rows } = await client.query(
        (looksLikeEmail
          ? 'SELECT password_hash FROM users WHERE LOWER(email) = $1 LIMIT 1'
          : 'SELECT password_hash FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1 LIMIT 1'),
        [identifier]
      );
      if (rows.length > 0) {
        const ok = await bcrypt.compare(password, rows[0].password_hash);
        console.log(ok ? '🔐 Password matches (bcrypt compare passed).' : '🔐 Password DOES NOT match.');
        process.exit(ok ? 0 : 3);
      }
    } else {
      console.log('ℹ️ Skipping password check (no --password provided).');
    }
  } catch (err) {
    console.error('❌ Error during user check:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
