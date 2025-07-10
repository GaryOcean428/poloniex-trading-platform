#!/usr/bin/env node

/**
 * Security Audit Script
 * Performs security checks and dependency audits compatible with Yarn 4
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function log(message, color = RESET) {
  console.log(`${color}${message}${RESET}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, GREEN);
}

function logWarning(message) {
  log(`⚠️  ${message}`, YELLOW);
}

function logError(message) {
  log(`❌ ${message}`, RED);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, BLUE);
}

async function runSecurityAudit() {
  log('\n🔍 Starting Security Audit...', BLUE);
  
  try {
    // Check for security vulnerabilities using npm audit
    logInfo('Running npm audit for security vulnerabilities...');
    try {
      execSync('npm audit --audit-level=moderate', { stdio: 'inherit' });
      logSuccess('No security vulnerabilities found');
    } catch (error) {
      if (error.status === 1) {
        logWarning('Some security vulnerabilities found - check output above');
      } else {
        logError('Error running npm audit');
      }
    }
    
    // Check for better-npm-audit
    logInfo('Running enhanced security audit...');
    try {
      execSync('yarn dlx better-npm-audit audit', { stdio: 'inherit' });
      logSuccess('Enhanced security audit completed');
    } catch (error) {
      logWarning('Enhanced audit tool not available or found issues');
    }
    
    // Check for sensitive files
    logInfo('Checking for sensitive files...');
    const sensitivePatterns = [
      '.env',
      '*.key',
      '*.pem',
      '*.p12',
      '*.pfx',
      'id_rsa',
      'id_dsa'
    ];
    
    let foundSensitive = false;
    sensitivePatterns.forEach(pattern => {
      try {
        const result = execSync(`find . -name "${pattern}" -not -path "./node_modules/*" -not -path "./.git/*"`, { encoding: 'utf8' });
        if (result.trim()) {
          logWarning(`Found potentially sensitive files: ${result.trim()}`);
          foundSensitive = true;
        }
      } catch (error) {
        // Ignore find errors
      }
    });
    
    if (!foundSensitive) {
      logSuccess('No sensitive files found in public areas');
    }
    
    // Check for hardcoded secrets
    logInfo('Scanning for potential hardcoded secrets...');
    const secretPatterns = [
      'api[_-]?key',
      'secret[_-]?key', 
      'password',
      'token',
      'auth[_-]?token'
    ];
    
    let foundSecrets = false;
    secretPatterns.forEach(pattern => {
      try {
        const result = execSync(`grep -r -i "${pattern}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --exclude-dir=node_modules --exclude-dir=.git . | grep -v "console.log" | head -5`, { encoding: 'utf8' });
        if (result.trim()) {
          logWarning(`Potential secrets found (review manually):\n${result.trim()}`);
          foundSecrets = true;
        }
      } catch (error) {
        // Ignore grep errors (no matches)
      }
    });
    
    if (!foundSecrets) {
      logSuccess('No obvious hardcoded secrets detected');
    }
    
    // Check package.json for security-related configurations
    logInfo('Checking package.json security configurations...');
    
    const packageJsonPath = './package.json';
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      // Check for engines specification
      if (packageJson.engines && packageJson.engines.node) {
        logSuccess(`Node.js version constraint specified: ${packageJson.engines.node}`);
      } else {
        logWarning('No Node.js version constraint specified in package.json');
      }
      
      // Check for private flag
      if (packageJson.private) {
        logSuccess('Package marked as private');
      } else {
        logWarning('Package not marked as private - could be accidentally published');
      }
    }
    
    // Check for dependency license issues
    logInfo('Checking dependency licenses...');
    try {
      execSync('yarn dlx license-checker --summary', { stdio: 'inherit' });
      logSuccess('License check completed');
    } catch (error) {
      logWarning('License checker not available or found issues');
    }
    
    log('\n🔍 Security Audit Complete', GREEN);
    
  } catch (error) {
    logError(`Security audit failed: ${error.message}`);
    process.exit(1);
  }
}

runSecurityAudit();