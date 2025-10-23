#!/usr/bin/env node

import { readdirSync, renameSync, rmSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distDir = join(__dirname, '..', 'dist');
const distSrcDir = join(distDir, 'src');

if (!existsSync(distSrcDir)) {
  console.log('No dist/src directory found; skipping flatten step.');
  process.exit(0);
}

for (const entry of readdirSync(distSrcDir)) {
  const fromPath = join(distSrcDir, entry);
  const toPath = join(distDir, entry);

  if (existsSync(toPath)) {
    const stats = statSync(toPath);
    if (stats.isDirectory()) {
      rmSync(toPath, { recursive: true, force: true });
    } else {
      rmSync(toPath, { force: true });
    }
  }

  renameSync(fromPath, toPath);
}

// Remove the now-empty dist/src directory with retry logic for file locks
let removed = false;
let lastError = null;

for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    rmSync(distSrcDir, { recursive: true, force: true });
    removed = true;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < 3) {
      console.warn(`Attempt ${attempt}/3: Failed to remove ${distSrcDir} (${error.message}). Retrying...`);
      // Brief pause before retry (synchronous)
      const start = Date.now();
      while (Date.now() - start < 100 * attempt) {
        // Busy wait for 100ms * attempt
      }
    }
  }
}

if (!removed) {
  console.error(`Error: Failed to remove ${distSrcDir} after 3 attempts:`, lastError.message);
  console.error('The dist/src directory could not be removed. Build output may be incorrect.');
  console.error('This will cause the application to fail at startup.');
  process.exit(1);
}

console.log('Flattened dist/src into dist/.');
