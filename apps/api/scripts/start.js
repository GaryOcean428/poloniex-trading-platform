/**
 * API startup wrapper.
 *
 * Purpose:
 * - Run database migrations on startup (configurable) so production never boots
 *   with an outdated schema.
 * - Then start the compiled server.
 *
 * This runs as part of `yarn workspace @poloniex-platform/api start`.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// scripts/ -> apps/api
const apiRoot = path.resolve(__dirname, '..');
const migrationScript = path.join(apiRoot, 'run-migration.js');
const serverEntry = path.join(apiRoot, 'dist', 'index.js');

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) return resolve({ code: 1, signal });
      resolve({ code: code ?? 0, signal: null });
    });
  });
}

async function main() {
  const shouldMigrate =
    process.env.RUN_MIGRATIONS_ON_STARTUP !== 'false' &&
    typeof process.env.DATABASE_URL === 'string' &&
    process.env.DATABASE_URL.length > 0;

  if (shouldMigrate) {
    console.log('🗄️  Running database migrations before starting API...');
    const { code } = await runProcess(process.execPath, [migrationScript, 'all'], {
      cwd: apiRoot,
    });
    if (code !== 0) {
      console.error('💥 Migrations failed; refusing to start API');
      process.exit(code);
    }
  } else {
    console.log('⏭️  Skipping migrations (RUN_MIGRATIONS_ON_STARTUP=false or DATABASE_URL missing)');
  }

  console.log('🚀 Starting API server...');
  const server = spawn(process.execPath, [serverEntry], {
    cwd: apiRoot,
    stdio: 'inherit',
    env: process.env,
  });

  const forwardSignal = (signal) => {
    if (!server.killed) server.kill(signal);
  };

  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  process.on('SIGINT', () => forwardSignal('SIGINT'));

  server.on('exit', (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('💥 Startup wrapper crashed:', err);
  process.exit(1);
});
