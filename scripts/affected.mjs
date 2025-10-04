#!/usr/bin/env node

/**
 * Affected Workspaces Detection Script
 * Determines which workspaces have changed based on git diff
 * Usage: node scripts/affected.mjs [base-ref]
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

const baseRef = process.argv[2] || 'HEAD~1';
const currentRef = 'HEAD';

// Define workspace mappings
const WORKSPACES = {
  frontend: {
    path: 'frontend',
    dependencies: ['shared']
  },
  backend: {
    path: 'backend',
    dependencies: ['shared']
  },
  'python-ml': {
    path: 'python-services/poloniex',
    dependencies: []
  }
};

function getChangedFiles() {
  try {
    const output = execSync(
      `git diff --name-only ${baseRef} ${currentRef}`,
      { encoding: 'utf8' }
    );
    return output.split('\n').filter(Boolean);
  } catch (error) {
    // If git diff fails, assume all workspaces affected
    console.error('Warning: Could not determine changed files, assuming all affected');
    return null;
  }
}

function getAffectedWorkspaces(changedFiles) {
  if (!changedFiles) {
    // Return all workspaces if we can't determine changes
    return Object.keys(WORKSPACES);
  }

  const affected = new Set();

  changedFiles.forEach(file => {
    // Check if file belongs to any workspace
    Object.entries(WORKSPACES).forEach(([name, config]) => {
      if (file.startsWith(config.path + '/')) {
        affected.add(name);
      }
    });

    // Check for shared dependencies
    if (file.startsWith('shared/')) {
      // Shared code affects all workspaces that depend on it
      Object.entries(WORKSPACES).forEach(([name, config]) => {
        if (config.dependencies.includes('shared')) {
          affected.add(name);
        }
      });
    }

    // Root-level changes affect all
    if (
      file === 'package.json' ||
      file === 'yarn.lock' ||
      file === 'tsconfig.json' ||
      file.startsWith('.github/')
    ) {
      Object.keys(WORKSPACES).forEach(name => affected.add(name));
    }
  });

  return Array.from(affected);
}

function main() {
  console.log('🔍 Detecting affected workspaces...\n');

  const changedFiles = getChangedFiles();
  
  if (changedFiles) {
    console.log(`Changed files (${changedFiles.length}):`);
    changedFiles.slice(0, 10).forEach(file => console.log(`  - ${file}`));
    if (changedFiles.length > 10) {
      console.log(`  ... and ${changedFiles.length - 10} more`);
    }
    console.log();
  }

  const affected = getAffectedWorkspaces(changedFiles);

  console.log('📦 Affected workspaces:');
  if (affected.length === 0) {
    console.log('  (none - no relevant changes detected)');
  } else {
    affected.forEach(ws => {
      console.log(`  ✓ ${ws}`);
    });
  }

  // Output for CI consumption
  if (process.env.GITHUB_OUTPUT) {
    import('fs').then(fs => {
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `affected=${affected.join(',')}\n`
      );
    });
  }

  // Exit code: 0 if any affected, 1 if none
  process.exit(affected.length > 0 ? 0 : 1);
}

main();
