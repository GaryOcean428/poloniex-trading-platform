#!/usr/bin/env node
/**
 * Pre-purge backup — always run this before purge-legacy-backtests.mjs --execute.
 *
 * Takes a schema+data dump of the target tables (not the whole DB) so the
 * 90-day retention cost stays small. Writes a checksum alongside so any
 * future restore can verify integrity.
 *
 * Target tables mirror the purge script. Output path includes engine
 * version + UTC timestamp so backups never collide.
 *
 * Usage:
 *   DATABASE_URL=... node apps/api/scripts/backup-pre-purge.mjs [--out path/to/dir]
 *
 * Requires `pg_dump` on PATH. Does not upload to S3 — wrap this script
 * in your deploy tooling if you want off-box retention.
 */

import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const TARGET_TABLES = [
  'backtest_results',
  'strategy_performance',
  'autonomous_trades',
  'paper_trading_sessions',
];

function getFlagValue(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx === argv.length - 1) return null;
  return argv[idx + 1];
}

function engineVersion() {
  return (
    process.env.ENGINE_VERSION ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_SHA ??
    'unknown'
  ).slice(0, 12);
}

async function runPgDump(databaseUrl, outputPath) {
  return new Promise((resolvePromise, reject) => {
    // execFile-style spawn with a fixed arg list — no shell, no injection.
    const args = ['--data-only', '--no-owner', '--no-privileges', '-f', outputPath];
    for (const table of TARGET_TABLES) {
      args.push('-t', table);
    }
    args.push(databaseUrl);

    const child = spawn('pg_dump', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`pg_dump exited with code ${code}`));
    });
  });
}

function sha256OfFile(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[backup] DATABASE_URL is required.');
    process.exit(1);
  }

  const outDir = resolve(getFlagValue(process.argv, '--out') ?? './backups');
  mkdirSync(outDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpPath = resolve(outDir, `pre-purge-${engineVersion()}-${ts}.sql`);

  console.log(`[backup] Writing ${TARGET_TABLES.length} tables to ${dumpPath}`);
  await runPgDump(databaseUrl, dumpPath);

  const checksum = sha256OfFile(dumpPath);
  const checksumPath = `${dumpPath}.sha256`;
  writeFileSync(checksumPath, `${checksum}  ${dumpPath}\n`);

  console.log(`[backup] Done.`);
  console.log(`[backup] sha256=${checksum}`);
  console.log(`[backup] checksum file: ${checksumPath}`);
}

main().catch((err) => {
  console.error('[backup] fatal:', err);
  process.exit(1);
});
