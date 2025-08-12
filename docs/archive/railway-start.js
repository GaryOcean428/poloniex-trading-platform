#!/usr/bin/env node

/**
 * Railway Startup Script for Backend
 * Provides debugging information and ensures proper Railway environment setup
 */

console.log('🚂 Railway Backend Startup');
console.log('==========================');

// Log environment information
console.log('📊 Environment Information:');
console.log(`  Node.js Version: ${process.version}`);
console.log(`  Platform: ${process.platform}`);
console.log(`  Architecture: ${process.arch}`);
console.log(`  Railway: ${process.env.RAILWAY_ENVIRONMENT ? 'Yes' : 'No'}`);
console.log(`  Port: ${process.env.PORT || '3000'}`);
console.log(`  Current Directory: ${process.cwd()}`);
console.log('');

// Verify required files
import fs from 'fs';
const requiredFiles = ['package.json', 'src/index.js'];
console.log('📁 File Verification:');
for (const file of requiredFiles) {
  const exists = fs.existsSync(file);
  console.log(`  ${file}: ${exists ? '✅' : '❌'}`);
  if (!exists) {
    console.error(`❌ Required file missing: ${file}`);
    process.exit(1);
  }
}
console.log('');

// Check Railway config exists
const railwayConfig = './railway.json';
if (fs.existsSync(railwayConfig)) {
  console.log('📄 Railway config found: ✅');
} else {
  console.log('📄 Railway config: ❌ (not required if using root config)');
}
console.log('');

// Start the application
console.log('🚀 Starting backend application...');
console.log('');

// Import and run the main application
import('./src/index.js').catch(error => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});