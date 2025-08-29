#!/usr/bin/env node

/**
 * Pre-build script to ensure shared types are available during TypeScript compilation
 * This script copies the shared folder to a temporary location within the backend directory
 * to ensure proper module resolution during Railway builds
 */

import { mkdirSync, cpSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendDir = __dirname;
const sharedSource = join(backendDir, '..', 'shared');
const sharedDest = join(backendDir, '.shared-build');

// Clean up any existing build artifacts
try {
  rmSync(sharedDest, { recursive: true, force: true });
} catch (error) {
  // Directory might not exist, that's ok
}

// Copy shared folder to backend directory for build
try {
  console.log('Copying shared types for build...');
  console.log('Source path:', sharedSource);
  console.log('Destination path:', sharedDest);
  mkdirSync(sharedDest, { recursive: true });
  cpSync(sharedSource, sharedDest, { recursive: true });
  console.log('Shared types copied successfully');
} catch (error) {
  console.error('Failed to copy shared types:', error);
  process.exit(1);
}
