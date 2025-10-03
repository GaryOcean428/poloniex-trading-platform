#!/usr/bin/env node
/**
 * Deployment Readiness Validation Script
 * 
 * Validates that all requirements from the comprehensive assessment are met.
 * This script checks:
 * - Build artifacts exist
 * - Configuration files are present
 * - Environment variables are documented
 * - Security features are enabled
 * - SPA routing is configured
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m'
};

const { reset, green, red, yellow, blue, bold } = colors;

let hasErrors = false;
let hasWarnings = false;

function success(message) {
  console.log(`${green}✓${reset} ${message}`);
}

function error(message) {
  console.log(`${red}✗${reset} ${message}`);
  hasErrors = true;
}

function warning(message) {
  console.log(`${yellow}⚠${reset} ${message}`);
  hasWarnings = true;
}

function info(message) {
  console.log(`${blue}ℹ${reset} ${message}`);
}

function section(title) {
  console.log(`\n${bold}${blue}${title}${reset}`);
  console.log('─'.repeat(60));
}

// Validation Tests
section('1. Build Artifacts');

// Check backend build
const backendDist = join(rootDir, 'backend/dist/src/index.js');
if (existsSync(backendDist)) {
  const stats = statSync(backendDist);
  const sizeKB = (stats.size / 1024).toFixed(2);
  success(`Backend built successfully (${sizeKB} KB)`);
} else {
  error('Backend dist not found. Run: yarn workspace backend build:railway');
}

// Check frontend build
const frontendDist = join(rootDir, 'frontend/dist/index.html');
if (existsSync(frontendDist)) {
  success('Frontend built successfully');
  
  // Check for key frontend assets
  const assetsDir = join(rootDir, 'frontend/dist/assets');
  if (existsSync(assetsDir)) {
    success('Frontend assets directory exists');
  } else {
    warning('Frontend assets directory not found');
  }
} else {
  error('Frontend dist not found. Run: yarn workspace frontend build');
}

section('2. Configuration Files');

// Check railpack configurations
const configs = [
  { path: 'railpack.json', name: 'Root railpack.json' },
  { path: 'backend/railpack.json', name: 'Backend railpack.json' },
  { path: 'frontend/railpack.json', name: 'Frontend railpack.json' },
  { path: 'railway.json', name: 'Railway configuration' }
];

configs.forEach(({ path: configPath, name }) => {
  const fullPath = join(rootDir, configPath);
  if (existsSync(fullPath)) {
    try {
      const content = readFileSync(fullPath, 'utf-8');
      JSON.parse(content); // Validate JSON
      success(`${name} is valid`);
    } catch (e) {
      error(`${name} has invalid JSON: ${e.message}`);
    }
  } else {
    error(`${name} not found at ${configPath}`);
  }
});

section('3. Environment Documentation');

// Check environment documentation
const envDocs = [
  { path: '.env.example', name: 'Environment example file' },
  { path: 'docs/deployment/ENVIRONMENT_SETUP.md', name: 'Environment setup guide' },
  { path: 'docs/deployment/DEPLOYMENT_TROUBLESHOOTING.md', name: 'Troubleshooting guide' }
];

envDocs.forEach(({ path: docPath, name }) => {
  const fullPath = join(rootDir, docPath);
  if (existsSync(fullPath)) {
    const stats = statSync(fullPath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    success(`${name} exists (${sizeKB} KB)`);
  } else {
    error(`${name} not found at ${docPath}`);
  }
});

section('4. Critical Environment Variables');

// Check .env.example for required variables
const envExamplePath = join(rootDir, '.env.example');
if (existsSync(envExamplePath)) {
  const envContent = readFileSync(envExamplePath, 'utf-8');
  
  const requiredVars = [
    'JWT_SECRET',
    'DATABASE_URL',
    'API_ENCRYPTION_KEY',
    'FRONTEND_URL',
    'VITE_API_URL',
    'VITE_WS_URL',
    'FRONTEND_STANDALONE'
  ];
  
  requiredVars.forEach(varName => {
    if (envContent.includes(varName)) {
      success(`${varName} documented`);
    } else {
      error(`${varName} not documented in .env.example`);
    }
  });
}

section('5. Backend Features');

// Check backend source for key features
const backendIndex = join(rootDir, 'backend/src/index.ts');
if (existsSync(backendIndex)) {
  const backendContent = readFileSync(backendIndex, 'utf-8');
  
  // Check SPA fallback
  if (backendContent.includes('SPA fallback')) {
    success('SPA fallback routing implemented');
  } else {
    error('SPA fallback routing not found');
  }
  
  // Check health endpoints
  if (backendContent.includes('/api/health') && backendContent.includes('/healthz')) {
    success('Health check endpoints configured');
  } else {
    error('Health check endpoints not found');
  }
  
  // Check body size limits
  if (backendContent.includes('express.json') && backendContent.includes('limit')) {
    success('Body size limits configured');
  } else {
    warning('Body size limits may not be configured');
  }
  
  // Check FRONTEND_STANDALONE logic
  if (backendContent.includes('FRONTEND_STANDALONE')) {
    success('FRONTEND_STANDALONE deployment mode supported');
  } else {
    error('FRONTEND_STANDALONE logic not found');
  }
}

section('6. Security Configuration');

// Check security middleware
const securityConfig = join(rootDir, 'backend/src/config/security.ts');
if (existsSync(securityConfig)) {
  const securityContent = readFileSync(securityConfig, 'utf-8');
  
  if (securityContent.includes('rateLimit')) {
    success('Rate limiting configured');
  } else {
    error('Rate limiting not found');
  }
  
  if (securityContent.includes('helmet')) {
    success('Helmet security headers configured');
  } else {
    error('Helmet not found');
  }
  
  if (securityContent.includes('sanitizeRequest')) {
    success('Request sanitization implemented');
  } else {
    warning('Request sanitization may not be implemented');
  }
  
  if (securityContent.includes('CORS')) {
    success('CORS configuration present');
  } else {
    error('CORS configuration not found');
  }
} else {
  error('Security configuration file not found');
}

section('7. Frontend Serve Configuration');

// Check frontend serve script
const frontendServe = join(rootDir, 'frontend/serve.js');
if (existsSync(frontendServe)) {
  const serveContent = readFileSync(frontendServe, 'utf-8');
  
  if (serveContent.includes('healthz')) {
    success('Frontend health check endpoint configured');
  } else {
    warning('Frontend health check may not be configured');
  }
  
  if (serveContent.includes('SPA fallback')) {
    success('Frontend SPA fallback configured');
  } else {
    warning('Frontend SPA fallback may not be configured');
  }
} else {
  error('Frontend serve script not found');
}

// Summary
section('Validation Summary');

if (hasErrors) {
  console.log(`${red}${bold}✗ Validation failed with errors${reset}`);
  console.log(`${yellow}Please fix the errors above before deploying${reset}`);
  process.exit(1);
} else if (hasWarnings) {
  console.log(`${yellow}${bold}⚠ Validation passed with warnings${reset}`);
  console.log(`${blue}Consider addressing warnings for optimal deployment${reset}`);
  process.exit(0);
} else {
  console.log(`${green}${bold}✓ All validation checks passed!${reset}`);
  console.log(`${blue}Deployment ready for Railway${reset}`);
  process.exit(0);
}
