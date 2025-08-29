#!/usr//bin/env node

import { cpSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const sharedSource = join(rootDir, 'shared');

// Bundle shared into each service
const services = ['frontend', 'backend'];

for (const service of services) {
  const destPath = join(rootDir, service, 'src', 'shared');
  
  if (!existsSync(sharedSource)) {
    console.error(`Shared source not found at ${sharedSource}`);
    continue;
  }
  
  try {
    console.log(`Bundling shared modules into ${service}...`);
    mkdirSync(destPath, { recursive: true });
    cpSync(sharedSource, destPath, { recursive: true });
    console.log(`✓ Bundled shared modules for ${service}`);
  } catch (error) {
    console.error(`Failed to bundle for ${service}:`, error);
  }
}
