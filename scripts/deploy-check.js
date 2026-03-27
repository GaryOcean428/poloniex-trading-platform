#!/usr/bin/env node

/**
 * Deployment Health Check Script
 * Validates that the application is ready for Railway deployment
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const apiDir = 'apps/api';
const webDir = 'apps/web';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkFile(filePath, description) {
  if (fs.existsSync(filePath)) {
    log(`✅ ${description}`, 'green');
    return true;
  } else {
    log(`❌ ${description} - Missing`, 'red');
    return false;
  }
}

function checkCommand(command, description) {
  try {
    execSync(command, { stdio: 'pipe' });
    log(`✅ ${description}`, 'green');
    return true;
  } catch (error) {
    log(`❌ ${description} - Failed`, 'red');
    return false;
  }
}

function checkEnvironment() {
  log('\n🔍 Checking Railway Deployment Configuration...\n', 'yellow');

  let checks = 0;
  let passed = 0;

  // Check configuration files
  checks++;
  if (checkFile('railway.json', 'Root railway.json')) passed++;

  checks++;
  if (checkFile(`${webDir}/railpack.json`, 'Web railpack.json')) passed++;

  checks++;
  if (checkFile(`${apiDir}/railpack.json`, 'API railpack.json')) passed++;

  checks++;
  if (checkFile(`${webDir}/serve.js`, 'Web serve.js')) passed++;

  checks++;
  if (checkFile(`${apiDir}/src/index.ts`, 'API entrypoint')) passed++;

  // Check package.json scripts
  checks++;
  if (checkFile(`${webDir}/package.json`, 'Web package.json')) passed++;

  checks++;
  if (checkFile(`${apiDir}/package.json`, 'API package.json')) passed++;

  // Check environment files
  checks++;
  if (checkFile('.env.example', 'Root environment example')) passed++;

  checks++;
  if (checkFile('.nvmrc', 'Node version file')) passed++;

  // Summary
  log('\n📊 Deployment Check Summary:\n', 'yellow');
  log(`Total checks: ${checks}`, 'yellow');
  log(`Passed: ${passed}`, 'green');
  log(`Failed: ${checks - passed}`, 'red');

  if (passed === checks) {
    log('\n🎉 All checks passed! Application is ready for Railway deployment.', 'green');
    return true;
  } else {
    log('\n⚠️  Some checks failed. Please address the issues above before deploying.', 'red');
    return false;
  }
}

// Run the check
checkEnvironment();
