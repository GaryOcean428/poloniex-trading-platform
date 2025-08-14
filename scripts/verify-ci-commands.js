#!/usr/bin/env node

/**
 * CI Commands Verification Script
 * Tests the same commands that run in GitHub Actions to ensure they work locally
 */

import { execSync } from 'child_process';
import path from 'path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function log(message, color = RESET) {
  console.log(`${color}${message}${RESET}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, GREEN);
}

function logError(message) {
  log(`❌ ${message}`, RED);
}

function logWarning(message) {
  log(`⚠️  ${message}`, YELLOW);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, BLUE);
}

function runCommand(command, description, continueOnError = false) {
  logInfo(`Running: ${description}`);
  console.log(`Command: ${command}\n`);
  
  try {
    execSync(command, { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    logSuccess(`${description} - PASSED`);
    return true;
  } catch (error) {
    if (continueOnError) {
      logWarning(`${description} - FAILED (continuing as configured)`);
      return false;
    } else {
      logError(`${description} - FAILED`);
      return false;
    }
  }
}

async function main() {
  log('\n🔍 Verifying CI Commands Locally', BLUE);
  log('This script tests the same commands that run in GitHub Actions\n');
  
  const results = {
    backendTypeCheck: false,
    frontendTypeCheck: false,
    backendLint: false,
    frontendLint: false,
    securityAudit: false
  };
  
  // Install dependencies first
  logInfo('Installing dependencies...');
  try {
    execSync('yarn install --immutable', { stdio: 'inherit' });
    logSuccess('Dependencies installed');
  } catch (error) {
    logError('Failed to install dependencies');
    process.exit(1);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('TESTING CI COMMANDS');
  console.log('='.repeat(50) + '\n');
  
  // 1. Backend TypeScript Check (must pass)
  results.backendTypeCheck = runCommand(
    'yarn workspace backend tsc --noEmit',
    'Backend TypeScript Check',
    false
  );
  
  console.log('\n' + '-'.repeat(50) + '\n');
  
  // 2. Frontend TypeScript Check (informational)
  results.frontendTypeCheck = runCommand(
    'yarn workspace frontend tsc --noEmit',
    'Frontend TypeScript Check',
    true
  );
  
  console.log('\n' + '-'.repeat(50) + '\n');
  
  // 3. Backend Lint Check (informational)
  results.backendLint = runCommand(
    'yarn workspace backend lint',
    'Backend Lint Check',
    true
  );
  
  console.log('\n' + '-'.repeat(50) + '\n');
  
  // 4. Frontend Lint Check (informational)
  results.frontendLint = runCommand(
    'yarn workspace frontend lint',
    'Frontend Lint Check',
    true
  );
  
  console.log('\n' + '-'.repeat(50) + '\n');
  
  // 5. Security Audit (informational)
  results.securityAudit = runCommand(
    'yarn security:audit',
    'Security Audit',
    true
  );
  
  console.log('\n' + '='.repeat(50));
  console.log('VERIFICATION SUMMARY');
  console.log('='.repeat(50) + '\n');
  
  // Show results
  const checks = [
    { name: 'Backend TypeScript', result: results.backendTypeCheck, critical: true },
    { name: 'Frontend TypeScript', result: results.frontendTypeCheck, critical: false },
    { name: 'Backend Lint', result: results.backendLint, critical: false },
    { name: 'Frontend Lint', result: results.frontendLint, critical: false },
    { name: 'Security Audit', result: results.securityAudit, critical: false }
  ];
  
  let criticalFailures = 0;
  let totalFailures = 0;
  
  checks.forEach(check => {
    const status = check.result ? '✅ PASS' : '❌ FAIL';
    const criticality = check.critical ? ' (CRITICAL)' : ' (informational)';
    log(`${check.name}: ${status}${criticality}`);
    
    if (!check.result) {
      totalFailures++;
      if (check.critical) {
        criticalFailures++;
      }
    }
  });
  
  console.log('\n' + '-'.repeat(50) + '\n');
  
  if (criticalFailures > 0) {
    logError(`${criticalFailures} critical failure(s) - CI would BLOCK merge`);
    process.exit(1);
  } else if (totalFailures > 0) {
    logWarning(`${totalFailures} non-critical failure(s) - CI would CONTINUE`);
    logSuccess('No critical failures - CI would allow merge');
  } else {
    logSuccess('All checks passed - CI would allow merge');
  }
  
  console.log('\n📋 CI Configuration Status:');
  log('• Backend TypeScript errors will block PRs', BLUE);
  log('• Frontend TypeScript errors are informational only', BLUE);
  log('• Lint errors are informational only', BLUE);
  log('• Security audit results are informational only', BLUE);
  log('• CI runs only when relevant files change', BLUE);
  
  console.log('\n🚀 Ready for GitHub Actions CI/CD!');
}

main().catch(error => {
  logError(`Verification failed: ${error.message}`);
  process.exit(1);
});
