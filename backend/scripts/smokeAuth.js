#!/usr/bin/env node
/**
 * Smoke test for auth: login -> verify
 * Usage:
 *   node backend/scripts/smokeAuth.js --base https://polytrade-be.up.railway.app --username GaryOcean --password "I.Am.Dev.1"
 */
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

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
const BASE = args.base || process.env.API_BASE_URL || 'https://polytrade-be.up.railway.app';
const username = args.username || process.env.SMOKE_USERNAME || 'demo';
const password = args.password || process.env.SMOKE_PASSWORD || 'password';

async function main() {
  console.log('🔎 Smoke auth test');
  console.log('  Base:', BASE);
  console.log('  Username:', username);

  try {
    // Login
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const loginBody = await loginRes.json().catch(() => ({}));

    console.log('🔐 Login status:', loginRes.status, loginRes.statusText);
    console.log('  Response keys:', Object.keys(loginBody || {}));

    if (!loginRes.ok) {
      console.log('❌ Login failed:', loginBody);
      process.exit(1);
    }

    // Support both { accessToken } and { token }
    const token = loginBody.accessToken || loginBody.token;
    if (!token) {
      console.log('⚠️ No token in login response, cannot verify. Body:', loginBody);
      process.exit(2);
    }

    // Verify
    const verifyRes = await fetch(`${BASE}/api/auth/verify`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    const verifyBody = await verifyRes.json().catch(() => ({}));
    console.log('🧪 Verify status:', verifyRes.status, verifyRes.statusText);
    console.log('  Verify body:', verifyBody);

    if (!verifyRes.ok || !verifyBody?.success) {
      console.log('❌ Verify failed');
      process.exit(3);
    }

    console.log('✅ Auth smoke test OK');
    process.exit(0);
  } catch (err) {
    console.error('❌ Smoke auth error:', err.message);
    process.exit(10);
  }
}

main();
