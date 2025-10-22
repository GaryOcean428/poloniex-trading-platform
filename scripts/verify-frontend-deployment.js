#!/usr/bin/env node

/**
 * Deployment Readiness Verification Script
 * 
 * Verifies that the repository is correctly configured for Railway deployment
 * and that the frontend build output is ready.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function header(message) {
  console.log('\n' + '='.repeat(60));
  log(message, 'bright');
  console.log('='.repeat(60) + '\n');
}

function check(description, result, details = '') {
  const symbol = result ? '✅' : '❌';
  const color = result ? 'green' : 'red';
  log(`${symbol} ${description}`, color);
  if (details) {
    log(`   ${details}`, 'cyan');
  }
}

function warn(message) {
  log(`⚠️  ${message}`, 'yellow');
}

let hasErrors = false;
let hasWarnings = false;

// Check 1: Root railpack.json configuration
header('Checking Root Railpack Configuration');

const rootRailpackPath = path.join(rootDir, 'railpack.json');
try {
  const rootRailpack = JSON.parse(fs.readFileSync(rootRailpackPath, 'utf8'));
  
  check('Root railpack.json exists', true, rootRailpackPath);
  
  if (rootRailpack.services) {
    check('Root railpack.json has service definitions', true);
    
    const expectedServices = ['frontend', 'backend', 'ml-worker'];
    for (const service of expectedServices) {
      if (rootRailpack.services[service]) {
        check(`Service "${service}" is defined`, true, 
          `root: ${rootRailpack.services[service].root}`);
      } else {
        check(`Service "${service}" is defined`, false);
        hasWarnings = true;
      }
    }
  } else {
    check('Root railpack.json has service definitions', false);
    warn('Without service definitions, Railway may not use correct roots');
    hasWarnings = true;
  }
} catch (error) {
  check('Root railpack.json is valid', false, error.message);
  hasErrors = true;
}

// Check 2: Frontend railpack.json configuration
header('Checking Frontend Railpack Configuration');

const frontendRailpackPath = path.join(rootDir, 'frontend', 'railpack.json');
try {
  const frontendRailpack = JSON.parse(fs.readFileSync(frontendRailpackPath, 'utf8'));
  
  check('Frontend railpack.json exists', true, frontendRailpackPath);
  
  if (frontendRailpack.steps?.build?.commands) {
    const buildCommands = frontendRailpack.steps.build.commands;
    check('Build step is defined', true);
    
    const hasViteBuild = buildCommands.some(cmd => cmd.includes('vite build'));
    check('Build includes "vite build"', hasViteBuild);
    if (!hasViteBuild) {
      hasErrors = true;
    }
    
    const hasPrebuild = buildCommands.some(cmd => cmd.includes('prebuild'));
    check('Build includes prebuild step', hasPrebuild);
    if (!hasPrebuild) {
      hasWarnings = true;
    }
  } else {
    check('Build step is defined', false);
    hasErrors = true;
  }
  
  if (frontendRailpack.deploy?.startCommand) {
    const startCmd = frontendRailpack.deploy.startCommand;
    check('Start command is defined', true, startCmd);
    
    const isCorrect = startCmd === 'node serve.js';
    check('Start command is "node serve.js"', isCorrect);
    if (!isCorrect) {
      warn(`Expected "node serve.js", got "${startCmd}"`);
      warn('This will work if running from /app, but may fail if running from service root');
      hasWarnings = true;
    }
  } else {
    check('Start command is defined', false);
    hasErrors = true;
  }
} catch (error) {
  check('Frontend railpack.json is valid', false, error.message);
  hasErrors = true;
}

// Check 3: Frontend build output
header('Checking Frontend Build Output');

const distPath = path.join(rootDir, 'frontend', 'dist');
const indexPath = path.join(distPath, 'index.html');
const assetsPath = path.join(distPath, 'assets');

if (fs.existsSync(distPath)) {
  check('dist folder exists', true, distPath);
  
  if (fs.existsSync(indexPath)) {
    check('dist/index.html exists', true);
    
    // Check if index.html has proper references
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const hasModuleScript = indexContent.includes('type="module"');
    const hasAssetsRef = indexContent.includes('/assets/');
    const hasSourceRef = indexContent.includes('./src/main.tsx');
    
    check('index.html has module scripts', hasModuleScript);
    check('index.html references /assets/', hasAssetsRef);
    check('index.html does NOT reference source files', !hasSourceRef);
    
    if (hasSourceRef) {
      warn('Found reference to ./src/main.tsx - this suggests wrong index.html is being served');
      hasErrors = true;
    }
    
    if (!hasAssetsRef) {
      warn('No references to /assets/ - build may have failed');
      hasErrors = true;
    }
  } else {
    check('dist/index.html exists', false);
    warn('Run "yarn workspace frontend build" to generate dist folder');
    hasWarnings = true;
  }
  
  if (fs.existsSync(assetsPath)) {
    const assetFiles = fs.readdirSync(assetsPath);
    check('dist/assets folder exists', true, `${assetFiles.length} files`);
    
    const hasJS = assetFiles.some(f => f.endsWith('.js'));
    const hasCSS = assetFiles.some(f => f.endsWith('.css'));
    
    check('Assets include JavaScript files', hasJS);
    check('Assets include CSS files', hasCSS);
  } else {
    check('dist/assets folder exists', false);
    hasWarnings = true;
  }
} else {
  check('dist folder exists', false);
  warn('Build has not been run yet - this is OK for development');
  warn('Run "yarn workspace frontend build" before deploying');
  hasWarnings = true;
}

// Check 4: serve.js configuration
header('Checking Frontend Server Configuration');

const servePath = path.join(rootDir, 'frontend', 'serve.js');
if (fs.existsSync(servePath)) {
  check('serve.js exists', true, servePath);
  
  const serveContent = fs.readFileSync(servePath, 'utf8');
  
  // Check for key configurations
  const hasDISTROOT = serveContent.includes('DIST_ROOT');
  const hasValidation = serveContent.includes('validateSetup');
  const hasHealthCheck = serveContent.includes('/healthz');
  const lisensOnCorrectHost = serveContent.includes('0.0.0.0');
  
  check('serve.js defines DIST_ROOT', hasDISTROOT);
  check('serve.js has startup validation', hasValidation);
  check('serve.js has health check endpoint', hasHealthCheck);
  check('serve.js listens on 0.0.0.0', lisensOnCorrectHost);
  
  if (!hasValidation) {
    warn('No startup validation - server may fail silently');
    hasWarnings = true;
  }
} else {
  check('serve.js exists', false);
  hasErrors = true;
}

// Check 5: Package.json workspace configuration
header('Checking Workspace Configuration');

const packagePath = path.join(rootDir, 'package.json');
try {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  
  check('Root package.json exists', true);
  
  if (packageJson.workspaces) {
    check('Workspaces are defined', true, packageJson.workspaces.join(', '));
    
    const hasFrontend = packageJson.workspaces.includes('frontend');
    const hasBackend = packageJson.workspaces.includes('backend');
    
    check('Frontend workspace is defined', hasFrontend);
    check('Backend workspace is defined', hasBackend);
  } else {
    check('Workspaces are defined', false);
    hasErrors = true;
  }
  
  if (packageJson.packageManager) {
    check('Package manager is specified', true, packageJson.packageManager);
  } else {
    check('Package manager is specified', false);
    warn('Should specify packageManager field for Railway');
    hasWarnings = true;
  }
} catch (error) {
  check('Root package.json is valid', false, error.message);
  hasErrors = true;
}

// Check 6: Environment configuration
header('Checking Environment Configuration');

const envExamplePath = path.join(rootDir, 'frontend', '.env.example');
if (fs.existsSync(envExamplePath)) {
  check('.env.example exists', true);
  
  const envContent = fs.readFileSync(envExamplePath, 'utf8');
  const hasViteVars = envContent.includes('VITE_');
  const hasBackendURL = envContent.includes('VITE_BACKEND_URL');
  const hasAPIURL = envContent.includes('VITE_API_URL');
  
  check('Uses VITE_ prefixed variables', hasViteVars);
  check('Defines VITE_BACKEND_URL', hasBackendURL);
  check('Defines VITE_API_URL', hasAPIURL);
  
  if (!hasViteVars) {
    warn('Environment variables should be prefixed with VITE_ for frontend');
    hasWarnings = true;
  }
} else {
  check('.env.example exists', false);
  warn('No .env.example to document required environment variables');
  hasWarnings = true;
}

// Final summary
header('Deployment Readiness Summary');

if (hasErrors) {
  log('❌ FAILED: Found critical issues that must be fixed', 'red');
  log('\nThe deployment will likely fail with the current configuration.', 'red');
  log('Please fix the errors above before deploying to Railway.', 'red');
  process.exit(1);
} else if (hasWarnings) {
  log('⚠️  PASSED WITH WARNINGS: Some issues detected', 'yellow');
  log('\nThe deployment may work, but there are potential problems.', 'yellow');
  log('Review the warnings above and fix them if possible.', 'yellow');
  process.exit(0);
} else {
  log('✅ PASSED: All checks passed!', 'green');
  log('\nThe repository appears to be correctly configured for Railway deployment.', 'green');
  log('\nNext steps:', 'cyan');
  log('1. Ensure Railway UI has Root Directory set to empty/blank', 'cyan');
  log('2. Ensure all build/start commands in Railway are empty (let railpack.json handle them)', 'cyan');
  log('3. Set required environment variables in Railway dashboard', 'cyan');
  log('4. Deploy to Railway and monitor the build logs', 'cyan');
  process.exit(0);
}
