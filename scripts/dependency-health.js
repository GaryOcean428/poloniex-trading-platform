#!/usr/bin/env node

/**
 * Dependency Health Check Script
 * Analyzes dependencies for security, performance, and maintenance issues
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

async function checkDependencyHealth() {
  log('\n📦 Starting Dependency Health Check...', BLUE);
  
  try {
    // Check for unused dependencies
    logInfo('Checking for unused dependencies...');
    try {
      const result = execSync('yarn dlx depcheck', { encoding: 'utf8' });
      if (result.includes('No depcheck issue')) {
        logSuccess('No unused dependencies found');
      } else {
        logWarning('Unused dependencies detected:\n' + result);
      }
    } catch (error) {
      const output = error.stdout || '';
      if (output.includes('Unused dependencies') || output.includes('Unused devDependencies')) {
        logWarning('Some unused dependencies found - check output above');
      } else {
        logError('Error running dependency check');
      }
    }
    
    // Check dependency sizes
    logInfo('Analyzing bundle impact...');
    const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    const largeDependencies = [];
    const heavyDependencies = [
      '@tensorflow/tfjs',
      'chart.js',
      'recharts',
      'socket.io-client'
    ];
    
    heavyDependencies.forEach(dep => {
      if (dependencies[dep]) {
        largeDependencies.push(dep);
      }
    });
    
    if (largeDependencies.length > 0) {
      logWarning(`Large dependencies found: ${largeDependencies.join(', ')}`);
      logInfo('Consider code splitting or lazy loading for these dependencies');
    } else {
      logSuccess('No unusually large dependencies detected');
    }
    
    // Check for duplicate dependencies
    logInfo('Checking for duplicate dependencies...');
    try {
      const yarnList = execSync('yarn list --depth=0 --pattern="*" 2>/dev/null || true', { encoding: 'utf8' });
      const duplicates = [];
      const lines = yarnList.split('\n');
      const seen = new Set();
      
      lines.forEach(line => {
        const match = line.match(/├─ (.+?)@/);
        if (match) {
          const packageName = match[1];
          if (seen.has(packageName)) {
            duplicates.push(packageName);
          }
          seen.add(packageName);
        }
      });
      
      if (duplicates.length > 0) {
        logWarning(`Potential duplicate dependencies: ${duplicates.join(', ')}`);
      } else {
        logSuccess('No obvious duplicate dependencies found');
      }
    } catch (error) {
      logWarning('Could not check for duplicate dependencies');
    }
    
    // Check for outdated dependencies (simplified)
    logInfo('Checking for critical dependency updates...');
    try {
      // Check specifically for security-critical packages
      const criticalPackages = ['react', 'react-dom', 'typescript', 'vite', 'eslint'];
      let outdatedCritical = false;
      
      criticalPackages.forEach(pkg => {
        if (dependencies[pkg]) {
          try {
            const latest = execSync(`npm view ${pkg} version`, { encoding: 'utf8' }).trim();
            const current = dependencies[pkg].replace(/[\^~]/, '');
            if (latest !== current) {
              logInfo(`${pkg}: ${current} → ${latest} (update available)`);
              outdatedCritical = true;
            }
          } catch (error) {
            // Ignore npm view errors
          }
        }
      });
      
      if (!outdatedCritical) {
        logSuccess('Critical dependencies appear up to date');
      }
    } catch (error) {
      logWarning('Could not check for outdated dependencies');
    }
    
    // Check for peer dependency issues
    logInfo('Checking peer dependencies...');
    try {
      const installOutput = execSync('yarn install --dry-run 2>&1 || true', { encoding: 'utf8' });
      if (installOutput.includes('peer dependencies') && installOutput.includes('incorrectly met')) {
        logWarning('Peer dependency issues detected - run "yarn explain peer-requirements" for details');
      } else {
        logSuccess('No peer dependency issues detected');
      }
    } catch (error) {
      // Ignore errors
    }
    
    // Summary report
    log('\n📊 Dependency Health Summary:', BLUE);
    const stats = {
      totalDependencies: Object.keys(dependencies).length,
      prodDependencies: Object.keys(packageJson.dependencies || {}).length,
      devDependencies: Object.keys(packageJson.devDependencies || {}).length
    };
    
    logInfo(`Total dependencies: ${stats.totalDependencies}`);
    logInfo(`Production: ${stats.prodDependencies}, Development: ${stats.devDependencies}`);
    
    // Check if package-lock.json exists alongside yarn.lock
    if (fs.existsSync('./package-lock.json') && fs.existsSync('./yarn.lock')) {
      logWarning('Both package-lock.json and yarn.lock exist - this can cause conflicts');
      logInfo('Consider removing package-lock.json since you are using Yarn');
    }
    
    log('\n📦 Dependency Health Check Complete', GREEN);
    
  } catch (error) {
    logError(`Dependency health check failed: ${error.message}`);
    process.exit(1);
  }
}

checkDependencyHealth();