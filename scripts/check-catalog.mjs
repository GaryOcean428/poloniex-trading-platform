#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allow bypass in local dev if needed
const allowEmpty = process.env.ALLOW_EMPTY_CATALOG === 'true';

// Candidate paths depending on where the script is run from
const candidates = [
  // When invoked from backend with --cwd backend
  path.resolve(__dirname, '../docs/markets/poloniex-futures-v3.json'),
  // When invoked from repo root
  path.resolve(__dirname, './docs/markets/poloniex-futures-v3.json'),
  // Fallback in case script path changes
  path.resolve(process.cwd(), 'docs/markets/poloniex-futures-v3.json')
];

function readJson(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

const existing = candidates.find((p) => fs.existsSync(p));
if (!existing) {
  console.error('[CI GUARD] Catalog file not found at any candidate path:', candidates);
  process.exit(1);
}

const data = readJson(existing);
if (!data || typeof data !== 'object') {
  console.error('[CI GUARD] Catalog JSON is invalid or unreadable:', existing);
  process.exit(1);
}

const markets = Array.isArray(data.markets) ? data.markets : [];
const count = markets.length;

if (count === 0) {
  const msg = `[CI GUARD] Empty catalog detected (markets.length = 0) at ${existing}.`;
  if (allowEmpty) {
    console.warn(msg + ' Bypassed due to ALLOW_EMPTY_CATALOG=true');
    process.exit(0);
  }
  console.error(msg + ' Failing build. Set ALLOW_EMPTY_CATALOG=true to bypass locally.');
  process.exit(1);
}

console.log(`[CI GUARD] Catalog OK: markets.length = ${count} at ${existing}`);
process.exit(0);
