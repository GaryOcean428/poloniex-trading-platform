#!/usr/bin/env node
/**
 * Railway Deployment Validation Script
 * Checks configuration before deployment
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(msg, color = 'reset') {
  console.log(`${COLORS[color]}${msg}${COLORS.reset}`);
}

async function checkFile(filePath, description) {
  try {
    await fs.access(path.join(rootDir, filePath));
    log(`✓ ${description}`, 'green');
    return true;
  } catch {
    log(`✗ ${description} - NOT FOUND`, 'red');
    return false;
  }
}

async function checkRailwayConfig() {
  log('\n🔍 Checking Railway Configuration...', 'blue');
  
  const checks = [
    ['railway.json', 'Railway configuration file'],
    ['apps/api/railpack.json', 'API railpack configuration file'],
    ['apps/web/railpack.json', 'Web railpack configuration file'],
    ['apps/api/package.json', 'API package.json'],
    ['apps/web/package.json', 'Web package.json'],
    ['apps/api/dist/index.js', 'API build output'],
    ['.nvmrc', 'Node version file']
  ];

  let allPassed = true;
  for (const [file, desc] of checks) {
    const passed = await checkFile(file, desc);
    if (!passed) allPassed = false;
  }

  return allPassed;
}

async function checkHealthEndpoint() {
  log('\n🏥 Checking Health Endpoint...', 'blue');
  
  try {
    const indexContent = await fs.readFile(path.join(rootDir, 'apps/api/src/index.ts'), 'utf-8');
    const hasHealthRoute = indexContent.includes('/api/health') || indexContent.includes('/healthz');
    
    if (hasHealthRoute) {
      log('✓ Health endpoint defined', 'green');
      return true;
    } else {
      log('✗ Health endpoint NOT found', 'red');
      log('  Add: app.get(\'/api/health\', ...)', 'yellow');
      return false;
    }
  } catch (error) {
    log(`✗ Could not check health endpoint: ${error.message}`, 'red');
    return false;
  }
}

async function checkNodeVersion() {
  log('\n📦 Checking Node Version...', 'blue');
  
  try {
    const nvmrc = await fs.readFile(path.join(rootDir, '.nvmrc'), 'utf-8');
    const version = nvmrc.trim();
    const major = parseInt(version.split('.')[0]);
    
    if (major >= 20) {
      log(`✓ Node version: ${version}`, 'green');
      return true;
    } else {
      log(`⚠ Node version ${version} is < 20.x`, 'yellow');
      return false;
    }
  } catch (error) {
    log(`✗ Could not check Node version: ${error.message}`, 'red');
    return false;
  }
}

async function checkRailpackConfig() {
  log('\n⚙️  Checking Railpack Configuration...', 'blue');
  
  try {
    const railpackContent = await fs.readFile(path.join(rootDir, 'apps/api/railpack.json'), 'utf-8');
    const config = JSON.parse(railpackContent);
    
    if (config.deploy && config.deploy.startCommand) {
      log(`✓ Start command configured: ${config.deploy.startCommand}`, 'green');
    } else {
      log('✗ No start command in apps/api/railpack.json', 'red');
      return false;
    }

    if (config.steps?.build?.commands?.length) {
      log(`✓ Build command configured`, 'green');
    } else {
      log('✗ No build command in apps/api/railpack.json', 'red');
      return false;
    }
    
    return true;
  } catch (error) {
    log(`✗ Could not check apps/api/railpack.json: ${error.message}`, 'red');
    return false;
  }
}

async function checkRailwayJson() {
  log('\n📋 Checking railway.json...', 'blue');
  
  try {
    const railwayContent = await fs.readFile(path.join(rootDir, 'railway.json'), 'utf-8');
    const config = JSON.parse(railwayContent);
    
    if (config.deploy && config.deploy.healthcheckPath) {
      log(`✓ Healthcheck path configured: ${config.deploy.healthcheckPath}`, 'green');
    } else {
      log('⚠ No healthcheck path in railway.json', 'yellow');
    }
    
    if (config.deploy && config.deploy.startCommand) {
      log(`✓ Start command configured: ${config.deploy.startCommand}`, 'green');
    } else {
      log('⚠ No start command in railway.json', 'yellow');
    }
    
    if (config.build && config.build.builder === 'RAILPACK') {
      log('✓ railway.json uses Railpack builder', 'green');
    } else if (config.build && config.build.buildCommand) {
      log(`✓ Build command configured`, 'green');
    } else {
      log('⚠ No build command in railway.json', 'yellow');
    }
    
    return true;
  } catch (error) {
    log(`✗ Could not check railway.json: ${error.message}`, 'red');
    return false;
  }
}

async function main() {
  log('\n╔══════════════════════════════════════╗', 'blue');
  log('║  Railway Deployment Validation      ║', 'blue');
  log('╚══════════════════════════════════════╝\n', 'blue');

  const results = await Promise.all([
    checkRailwayConfig(),
    checkHealthEndpoint(),
    checkNodeVersion(),
    checkRailpackConfig(),
    checkRailwayJson()
  ]);

  const allPassed = results.every(r => r);

  log('\n' + '='.repeat(40), 'blue');
  if (allPassed) {
    log('✅ All checks passed - Ready to deploy!', 'green');
    process.exit(0);
  } else {
    log('❌ Some checks failed - Fix issues before deploying', 'red');
    log('\n💡 Note: Build output checks fail until the monorepo apps are built.', 'yellow');
    log('   Run "yarn build:api && yarn build:web" to build the services first.', 'yellow');
    process.exit(1);
  }
}

main();
