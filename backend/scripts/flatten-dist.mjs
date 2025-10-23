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

try {
  rmSync(distSrcDir, { recursive: true, force: true });
} catch (error) {
  console.warn(`Warning: Failed to remove ${distSrcDir}:`, error.message);
  console.warn('This may occur if files are locked or in use. The directory will remain.');
}
console.log('Flattened dist/src into dist/.');
