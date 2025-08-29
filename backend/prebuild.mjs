#!/usr/bin/env node

import { mkdirSync, cpSync, rmSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Railway detection - when root directory is set, we're in /app
const isRailway = process.env.RAILWAY_ENVIRONMENT === 'production';
const backendDir = __dirname;

// Try multiple shared folder locations
const possibleSharedPaths = [
  join(backendDir, '..', 'shared'),           // Local dev
  join(backendDir, 'shared'),                 // If shared was copied
  join(process.cwd(), '..', 'shared'),         // Alternative Railway path
  join(process.cwd(), 'shared'),               // Root-level shared
  '/app/shared',                                // Direct Railway path
];

let sharedSource = null;
for (const path of possibleSharedPaths) {
  if (existsSync(path)) {
    sharedSource = path;
    console.log(`Found shared folder at: ${path}`);
    break;
  }
}

if (!sharedSource) {
  console.log('Shared folder not found, checking if already bundled...');
  // Check if types are already available
  if (existsSync(join(backendDir, 'src', 'shared'))) {
    console.log('Shared types already bundled in src/shared');
    process.exit(0);
  }
  console.error('Could not locate shared folder in any expected location');
  console.error('Attempted paths:', possibleSharedPaths);
  // Exit gracefully for Railway builds where shared might be pre-bundled
  if (isRailway) {
    console.log('Railway build detected, proceeding without shared copy');
    process.exit(0);
  }
  process.exit(1);
}

const sharedDest = join(backendDir, '.shared-build');

// Clean and copy
try {
  rmSync(sharedDest, { recursive: true, force: true });
} catch (error) {
  // Directory might not exist
}

try {
  console.log(`Copying from ${sharedSource} to ${sharedDest}`);
  mkdirSync(sharedDest, { recursive: true });
  cpSync(sharedSource, sharedDest, { recursive: true });
  console.log('Shared modules copied successfully');
} catch (error) {
  console.error('Failed to copy shared modules:', error);
  if (isRailway) {
    console.log('Continuing Railway build despite copy failure');
    process.exit(0);
  }
  process.exit(1);
}
