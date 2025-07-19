#!/usr/bin/env node

/**
 * Deployment Health Check Script
 * Validates that the application is ready for Railway deployment
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

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
  if (checkFile('frontend/railway.json', 'Frontend railway.json')) passed++;

  checks++;
  if (checkFile('backend/railway.json', 'Backend railway.json')) passed++;

  checks++;
  if (checkFile('frontend/nixpacks.toml', 'Frontend nixpacks.toml')) passed++;

  checks++;
  if (checkFile('backend/nixpacks.toml', 'Backend nixpacks.toml')) passed++;

  // Check package.json scripts
  checks++;
  if (checkFile('frontend/package.json', 'Frontend package.json')) passed++;

  checks++;
  if (checkFile('backend/package.json', 'Backend package.json')) passed++;

  // Check environment files
  checks++;
  if (checkFile('frontend/.env.production', 'Frontend production env')) passed++;

  checks++;
  if (checkFile('backend/.env.example', 'Backend env example')) passed++;

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
