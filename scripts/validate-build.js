#!/usr/bin/env node

/**
 * Build Validation Script
 * Validates that the frontend build is properly configured and working
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bright: '\x1b[1m'
};

console.log(`${colors.blue}${colors.bright}🔍 Frontend Build Validation${colors.reset}\n`);

/**
 * Check that the build directory exists and contains expected files
 */
function validateBuildOutput() {
  console.log(`${colors.blue}Checking build output...${colors.reset}`);
  
  const distPath = path.join(process.cwd(), 'frontend', 'dist');
  
  if (!fs.existsSync(distPath)) {
    throw new Error('Build directory not found. Run yarn workspace poloniex-frontend build first.');
  }
  
  const requiredFiles = ['index.html'];
  const missingFiles = requiredFiles.filter(file => 
    !fs.existsSync(path.join(distPath, file))
  );
  
  if (missingFiles.length > 0) {
    throw new Error(`Missing required build files: ${missingFiles.join(', ')}`);
  }
  
  // Check for JS and CSS assets
  const assetsPath = path.join(distPath, 'assets');
  if (!fs.existsSync(assetsPath)) {
    throw new Error('Assets directory not found in build output');
  }
  
  const assets = fs.readdirSync(assetsPath);
  const jsFiles = assets.filter(file => file.endsWith('.js'));
  const cssFiles = assets.filter(file => file.endsWith('.css'));
  const mapFiles = assets.filter(file => file.endsWith('.js.map'));
  
  console.log(`${colors.green}✓ Build output validated${colors.reset}`);
  console.log(`  - JS files: ${jsFiles.length}`);
  console.log(`  - CSS files: ${cssFiles.length}`);
  console.log(`  - Source maps: ${mapFiles.length}`);
  
  if (mapFiles.length === 0) {
    console.warn(`${colors.yellow}Warning: No source maps found. Debugging may be difficult.${colors.reset}`);
  } else {
    console.log(`${colors.green}✓ Source maps enabled for debugging${colors.reset}`);
  }
  
  console.log('');
}

/**
 * Check that serve dependency is installed
 */
function validateServeDependency() {
  console.log(`${colors.blue}Checking serve dependency...${colors.reset}`);
  
  const packageJsonPath = path.join(process.cwd(), 'frontend', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  if (!packageJson.dependencies.serve) {
    throw new Error('serve dependency not found in package.json');
  }
  
  console.log(`${colors.green}✓ serve dependency found: ${packageJson.dependencies.serve}${colors.reset}\n`);
}

/**
 * Validate that the start script is correct
 */
function validateStartScript() {
  console.log(`${colors.blue}Checking start script...${colors.reset}`);
  
  const packageJsonPath = path.join(process.cwd(), 'frontend', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  const expectedStartScript = 'serve -s dist -l ${PORT:-3000}';
  if (packageJson.scripts.start !== expectedStartScript) {
    throw new Error(`Start script incorrect. Expected: ${expectedStartScript}, Found: ${packageJson.scripts.start}`);
  }
  
  console.log(`${colors.green}✓ Start script validated${colors.reset}\n`);
}

/**
 * Check App.tsx for proper initialization
 */
function validateAppInitialization() {
  console.log(`${colors.blue}Checking App.tsx initialization...${colors.reset}`);
  
  const appPath = path.join(process.cwd(), 'frontend', 'src', 'App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf8');
  
  // Check that BrowserCompatibility is not called at module level
  if (appContent.includes('BrowserCompatibility.setupExtensionCompatibility();') && 
      !appContent.includes('useEffect(() => {')) {
    throw new Error('BrowserCompatibility.setupExtensionCompatibility() should be called inside useEffect, not at module level');
  }
  
  // Check that useEffect is imported
  if (!appContent.includes('useEffect')) {
    throw new Error('useEffect should be imported from React');
  }
  
  console.log(`${colors.green}✓ App.tsx initialization validated${colors.reset}\n`);
}

/**
 * Validate Vite configuration
 */
function validateViteConfig() {
  console.log(`${colors.blue}Checking Vite configuration...${colors.reset}`);
  
  const viteConfigPath = path.join(process.cwd(), 'frontend', 'vite.config.ts');
  const viteContent = fs.readFileSync(viteConfigPath, 'utf8');
  
  // Check that manualChunks is a function
  if (viteContent.includes('manualChunks: {') && !viteContent.includes('manualChunks: (id) => {')) {
    throw new Error('manualChunks should be a function, not an object');
  }
  
  // Check that sourcemap is enabled
  if (viteContent.includes('sourcemap: false')) {
    throw new Error('Sourcemaps should be enabled for debugging');
  }
  
  console.log(`${colors.green}✓ Vite configuration validated${colors.reset}\n`);
}

/**
 * Main validation function
 */
async function validateBuild() {
  try {
    validateBuildOutput();
    validateServeDependency();
    validateStartScript();
    validateAppInitialization();
    validateViteConfig();
    
    console.log(`${colors.green}${colors.bright}🎉 All validations passed!${colors.reset}`);
    console.log(`${colors.green}The runtime initialization error should be resolved.${colors.reset}\n`);
    
    console.log(`${colors.blue}Next steps:${colors.reset}`);
    console.log('1. Deploy the changes to Railway');
    console.log('2. Monitor for the runtime error');
    console.log('3. Check browser console for any remaining issues');
    
  } catch (error) {
    console.error(`${colors.red}❌ Validation failed: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

validateBuild();