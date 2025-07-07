#!/usr/bin/env node

/**
 * Railway Configuration Helper
 * Provides guidance on Railway dashboard configuration based on available config files
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find the project root
let projectRoot = process.cwd();
while (!fs.existsSync(path.join(projectRoot, 'package.json')) || 
       !fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8').includes('workspaces')) {
  const parent = path.dirname(projectRoot);
  if (parent === projectRoot) {
    projectRoot = path.dirname(__dirname);
    break;
  }
  projectRoot = parent;
}

console.log('🚂 Railway Configuration Helper');
console.log('=====================================\n');

// Check available configuration files
const rootConfig = path.join(projectRoot, 'railway.json');
const backendConfig = path.join(projectRoot, 'backend', 'railway.json');
const frontendConfig = path.join(projectRoot, 'frontend', 'railway.json');

const hasRoot = fs.existsSync(rootConfig);
const hasBackend = fs.existsSync(backendConfig);
const hasFrontend = fs.existsSync(frontendConfig);

console.log('📁 Configuration Files Found:');
console.log(`   Root config (/railway.json): ${hasRoot ? '✅' : '❌'}`);
console.log(`   Backend config (/backend/railway.json): ${hasBackend ? '✅' : '❌'}`);
console.log(`   Frontend config (/frontend/railway.json): ${hasFrontend ? '✅' : '❌'}\n`);

// Provide configuration recommendations
console.log('🎯 Railway Dashboard Configuration Recommendations:\n');

if (hasRoot && hasBackend) {
  console.log('📌 OPTION 1 (RECOMMENDED): Use Root Configuration');
  console.log('   Backend Service Settings:');
  console.log('   ├─ Root Directory: /backend');
  console.log('   ├─ Config Path: /railway.json');
  console.log('   ├─ Builder: NIXPACKS');
  console.log('   └─ Reason: Centralizes configuration management\n');

  console.log('📌 OPTION 2: Use Service-Specific Configuration');
  console.log('   Backend Service Settings:');
  console.log('   ├─ Root Directory: /backend');
  console.log('   ├─ Config Path: /backend/railway.json');
  console.log('   ├─ Builder: NIXPACKS');
  console.log('   └─ Reason: Isolates backend configuration\n');
} else if (hasBackend) {
  console.log('📌 OPTION 1 (RECOMMENDED): Use Service-Specific Configuration');
  console.log('   Backend Service Settings:');
  console.log('   ├─ Root Directory: /backend');
  console.log('   ├─ Config Path: /backend/railway.json');
  console.log('   ├─ Builder: NIXPACKS');
  console.log('   └─ Reason: Only backend config available\n');
} else if (hasRoot) {
  console.log('📌 OPTION 1 (RECOMMENDED): Use Root Configuration');
  console.log('   Backend Service Settings:');
  console.log('   ├─ Root Directory: /backend');
  console.log('   ├─ Config Path: /railway.json');
  console.log('   ├─ Builder: NIXPACKS');
  console.log('   └─ Reason: Uses available root configuration\n');
}

console.log('📌 OPTION 3: Manual UI Configuration (Always Available)');
console.log('   Backend Service Settings:');
console.log('   ├─ Root Directory: /backend');
console.log('   ├─ Config Path: (leave empty)');
console.log('   ├─ Builder: NIXPACKS');
console.log('   ├─ Build Command: yarn install --frozen-lockfile && yarn build');
console.log('   ├─ Start Command: yarn start:prod');
console.log('   ├─ Health Check Path: /api/health');
console.log('   └─ Reason: No config file dependency\n');

// Error troubleshooting
console.log('🚨 If you see "config file does not exist" error:\n');
console.log('   1. Check that Config Path is ABSOLUTE (starts with /)');
console.log('   2. Verify Config Path matches your chosen option above');
console.log('   3. Ensure Root Directory is set to /backend');
console.log('   4. Try Option 3 (manual UI configuration) as fallback\n');

// Environment variables reminder
console.log('📋 Don\'t forget to set Environment Variables in Railway:');
console.log('   ├─ NODE_ENV=production');
console.log('   ├─ FRONTEND_URL=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}');
console.log('   ├─ POLONIEX_API_KEY=your-key');
console.log('   ├─ POLONIEX_SECRET=your-secret');
console.log('   ├─ JWT_SECRET=your-jwt-secret');
console.log('   └─ SESSION_SECRET=your-session-secret\n');

console.log('🔗 For detailed troubleshooting, see: RAILWAY_TROUBLESHOOTING_GUIDE.md');