#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const issues = [];

// Check Yarn version
try {
  const yarnVersion = execSync('yarn --version', { encoding: 'utf8' }).trim();
  console.log(`✓ Yarn version: ${yarnVersion}`);
  
  if (!yarnVersion.startsWith('4.')) {
    issues.push('Yarn Berry (v4) not active. Run: corepack enable && yarn set version 4.9.2');
  }
} catch (error) {
  issues.push('Yarn not found or not properly configured');
}

// Check for workspace configuration
const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
if (!rootPackage.workspaces) {
  issues.push('No workspaces defined in root package.json');
}

// Check for duplicate lockfiles
const workspaces = rootPackage.workspaces || [];
workspaces.forEach(workspace => {
  const lockPath = join(workspace, 'yarn.lock');
  if (existsSync(lockPath)) {
    issues.push(`Found duplicate yarn.lock in ${workspace} - must be removed`);
  }
});

// Verify workspace names match
workspaces.forEach(workspace => {
  const pkgPath = join(workspace, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    console.log(`✓ Workspace ${workspace}: ${pkg.name}`);
  }
});

// Check lockfile integrity
try {
  execSync('yarn install --immutable --check-cache', { stdio: 'pipe' });
  console.log('✓ Lockfile integrity verified');
} catch (error) {
  issues.push('Lockfile integrity check failed - run: yarn install');
}

// Check Yarn Berry files
if (!existsSync('.yarnrc.yml')) {
  issues.push('Missing .yarnrc.yml - run: yarn set version 4.9.2');
}

if (!existsSync('.yarn')) {
  issues.push('Missing .yarn directory - run: yarn install');
}

// Report results
console.log('\n=== Workspace Health Report ===');
if (issues.length === 0) {
  console.log('✅ All checks passed!');
  process.exit(0);
} else {
  console.log(`❌ Found ${issues.length} issues:\n`);
  issues.forEach((issue, i) => {
    console.log(`${i + 1}. ${issue}`);
  });
  process.exit(1);
}