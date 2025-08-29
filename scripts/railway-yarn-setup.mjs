#!/usr/bin/env node

/**
 * Railway Yarn Setup Script
 * Ensures Yarn 4.9.2 is properly configured in Railway's build environment
 * This script handles Corepack activation and Yarn version management
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const REQUIRED_YARN_VERSION = '4.9.2';

function exec(cmd, options = {}) {
  console.log(`> ${cmd}`);
  try {
    const result = execSync(cmd, { stdio: 'inherit', ...options });
    return result;
  } catch (error) {
    console.error(`Failed to execute: ${cmd}`);
    throw error;
  }
}

function setupYarn() {
  console.log('=== Railway Yarn Setup ===');
  console.log(`Target Yarn version: ${REQUIRED_YARN_VERSION}`);
  
  // Enable Corepack (Node.js package manager manager)
  console.log('\n1. Enabling Corepack...');
  exec('corepack enable');
  
  // Prepare specific Yarn version
  console.log(`\n2. Preparing Yarn ${REQUIRED_YARN_VERSION}...`);
  exec(`corepack prepare yarn@${REQUIRED_YARN_VERSION} --activate`);
  
  // Verify Yarn installation
  console.log('\n3. Verifying Yarn installation...');
  const yarnVersion = execSync('yarn --version', { encoding: 'utf8' }).trim();
  console.log(`Installed Yarn version: ${yarnVersion}`);
  
  if (!yarnVersion.startsWith(REQUIRED_YARN_VERSION.split('.')[0])) {
    throw new Error(`Yarn version mismatch. Expected ${REQUIRED_YARN_VERSION}, got ${yarnVersion}`);
  }
  
  // Check for yarn.lock
  console.log('\n4. Checking for yarn.lock...');
  if (!existsSync('yarn.lock')) {
    console.warn('Warning: yarn.lock not found. This may cause inconsistent dependencies.');
  } else {
    console.log('✓ yarn.lock found');
  }
  
  // Check for .yarnrc.yml
  console.log('\n5. Checking for .yarnrc.yml...');
  if (!existsSync('.yarnrc.yml')) {
    console.warn('Warning: .yarnrc.yml not found. Using default Yarn configuration.');
  } else {
    console.log('✓ .yarnrc.yml found');
  }
  
  console.log('\n=== Yarn Setup Complete ===');
  return true;
}

// Execute setup
try {
  setupYarn();
  process.exit(0);
} catch (error) {
  console.error('Yarn setup failed:', error.message);
  process.exit(1);
}
