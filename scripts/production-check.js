#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configuration
const config = {
  projectName: 'Poloniex Trading Platform',
  testCommand: 'npm test',
  buildCommand: 'npm run build',
  lintCommand: 'npm run lint',
  deployCommand: 'npm run deploy',
  requiredDependencies: [
    '@types/chrome',
    'react',
    'react-dom',
    'react-router-dom',
    'recharts',
    'tailwindcss',
    '@tensorflow/tfjs',
    'vitest',
    '@testing-library/react'
  ]
};

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Main function to run the production readiness check
 */
async function main() {
  printHeader();
  
  try {
    // Check environment
    await checkEnvironment();
    
    // Check dependencies
    await checkDependencies();
    
    // Run linting
    await runLinting();
    
    // Run tests
    await runTests();
    
    // Build project
    await buildProject();
    
    // Check for production optimizations
    await checkOptimizations();
    
    // Final report
    printFinalReport();
    
    // Ask if user wants to deploy
    await askForDeployment();
  } catch (error) {
    console.error(`${colors.red}${colors.bright}Error: ${error.message}${colors.reset}`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

/**
 * Print header with project information
 */
function printHeader() {
  console.log(`\n${colors.cyan}${colors.bright}======================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}  Production Readiness Check${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}  ${config.projectName}${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}======================================${colors.reset}\n`);
}

/**
 * Check environment for required tools
 */
async function checkEnvironment() {
  console.log(`${colors.blue}${colors.bright}Checking environment...${colors.reset}`);
  
  // Check Node.js version
  const nodeVersion = process.version;
  console.log(`Node.js version: ${nodeVersion}`);
  
  // Check npm version
  try {
    const npmVersion = execSync('npm --version').toString().trim();
    console.log(`npm version: ${npmVersion}`);
  } catch (error) {
    throw new Error('npm is not installed or not in PATH');
  }
  
  // Check Git
  try {
    const gitVersion = execSync('git --version').toString().trim();
    console.log(`Git version: ${gitVersion}`);
  } catch (error) {
    console.warn(`${colors.yellow}Warning: Git is not installed or not in PATH${colors.reset}`);
  }
  
  console.log(`${colors.green}✓ Environment check passed${colors.reset}\n`);
}

/**
 * Check project dependencies
 */
async function checkDependencies() {
  console.log(`${colors.blue}${colors.bright}Checking dependencies...${colors.reset}`);
  
  // Read package.json
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('package.json not found');
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const allDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  };
  
  // Check required dependencies
  const missingDependencies = [];
  for (const dep of config.requiredDependencies) {
    if (!allDependencies[dep]) {
      missingDependencies.push(dep);
    }
  }
  
  if (missingDependencies.length > 0) {
    console.warn(`${colors.yellow}Warning: Missing dependencies: ${missingDependencies.join(', ')}${colors.reset}`);
    
    const answer = await askQuestion('Install missing dependencies? (y/n): ');
    if (answer.toLowerCase() === 'y') {
      console.log('Installing missing dependencies...');
      execSync(`npm install --save-dev ${missingDependencies.join(' ')}`, { stdio: 'inherit' });
    }
  } else {
    console.log(`${colors.green}✓ All required dependencies are installed${colors.reset}`);
  }
  
  // Check for outdated dependencies
  console.log('Checking for outdated dependencies...');
  try {
    const outdatedOutput = execSync('npm outdated --json').toString();
    const outdatedDeps = JSON.parse(outdatedOutput);
    
    if (Object.keys(outdatedDeps).length > 0) {
      console.warn(`${colors.yellow}Warning: Outdated dependencies found${colors.reset}`);
      
      for (const [dep, info] of Object.entries(outdatedDeps)) {
        console.log(`  ${dep}: ${info.current} → ${info.latest}`);
      }
      
      const answer = await askQuestion('Update outdated dependencies? (y/n): ');
      if (answer.toLowerCase() === 'y') {
        console.log('Updating dependencies...');
        execSync('npm update', { stdio: 'inherit' });
      }
    } else {
      console.log(`${colors.green}✓ All dependencies are up to date${colors.reset}`);
    }
  } catch (error) {
    console.warn(`${colors.yellow}Warning: Could not check for outdated dependencies${colors.reset}`);
  }
  
  console.log(`${colors.green}✓ Dependencies check completed${colors.reset}\n`);
}

/**
 * Run linting
 */
async function runLinting() {
  console.log(`${colors.blue}${colors.bright}Running linting...${colors.reset}`);
  
  try {
    execSync(config.lintCommand, { stdio: 'inherit' });
    console.log(`${colors.green}✓ Linting passed${colors.reset}\n`);
  } catch (error) {
    console.error(`${colors.red}✗ Linting failed${colors.reset}`);
    
    const answer = await askQuestion('Continue despite linting errors? (y/n): ');
    if (answer.toLowerCase() !== 'y') {
      throw new Error('Linting failed');
    }
    
    console.log(`${colors.yellow}⚠ Continuing despite linting errors${colors.reset}\n`);
  }
}

/**
 * Run tests
 */
async function runTests() {
  console.log(`${colors.blue}${colors.bright}Running tests...${colors.reset}`);
  
  try {
    execSync(config.testCommand, { stdio: 'inherit' });
    console.log(`${colors.green}✓ Tests passed${colors.reset}\n`);
  } catch (error) {
    console.error(`${colors.red}✗ Tests failed${colors.reset}`);
    
    const answer = await askQuestion('Continue despite test failures? (y/n): ');
    if (answer.toLowerCase() !== 'y') {
      throw new Error('Tests failed');
    }
    
    console.log(`${colors.yellow}⚠ Continuing despite test failures${colors.reset}\n`);
  }
}

/**
 * Build project
 */
async function buildProject() {
  console.log(`${colors.blue}${colors.bright}Building project...${colors.reset}`);
  
  try {
    execSync(config.buildCommand, { stdio: 'inherit' });
    console.log(`${colors.green}✓ Build successful${colors.reset}\n`);
    
    // Check build size
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      const totalSize = calculateDirectorySize(distPath);
      console.log(`Build size: ${formatBytes(totalSize)}`);
      
      if (totalSize > 5 * 1024 * 1024) { // 5MB
        console.warn(`${colors.yellow}Warning: Build size is large (${formatBytes(totalSize)})${colors.reset}`);
      }
    }
  } catch (error) {
    console.error(`${colors.red}✗ Build failed${colors.reset}`);
    throw new Error('Build failed');
  }
}

/**
 * Check for production optimizations
 */
async function checkOptimizations() {
  console.log(`${colors.blue}${colors.bright}Checking for production optimizations...${colors.reset}`);
  
  // Check for source maps in production build
  const distPath = path.join(process.cwd(), 'dist');
  if (fs.existsSync(distPath)) {
    const hasSourceMaps = checkForSourceMaps(distPath);
    if (hasSourceMaps) {
      console.warn(`${colors.yellow}Warning: Source maps found in production build${colors.reset}`);
    } else {
      console.log(`${colors.green}✓ No source maps in production build${colors.reset}`);
    }
  }
  
  // Check for minification
  if (fs.existsSync(distPath)) {
    const isMinified = checkForMinification(distPath);
    if (!isMinified) {
      console.warn(`${colors.yellow}Warning: JavaScript files may not be minified${colors.reset}`);
    } else {
      console.log(`${colors.green}✓ JavaScript files are minified${colors.reset}`);
    }
  }
  
  // Check for environment variables
  const envFile = path.join(process.cwd(), '.env');
  if (fs.existsSync(envFile)) {
    console.warn(`${colors.yellow}Warning: .env file found, make sure it doesn't contain sensitive information${colors.reset}`);
  } else {
    console.log(`${colors.green}✓ No .env file found${colors.reset}`);
  }
  
  console.log(`${colors.green}✓ Optimization check completed${colors.reset}\n`);
}

/**
 * Print final report
 */
function printFinalReport() {
  console.log(`${colors.green}${colors.bright}======================================${colors.reset}`);
  console.log(`${colors.green}${colors.bright}  Production Readiness Check Complete${colors.reset}`);
  console.log(`${colors.green}${colors.bright}======================================${colors.reset}\n`);
  
  console.log(`${colors.green}${colors.bright}The ${config.projectName} is ready for production!${colors.reset}`);
  console.log(`${colors.dim}Run '${config.deployCommand}' to deploy to production.${colors.reset}\n`);
}

/**
 * Ask if user wants to deploy
 */
async function askForDeployment() {
  const answer = await askQuestion('Deploy to production now? (y/n): ');
  if (answer.toLowerCase() === 'y') {
    console.log(`${colors.blue}${colors.bright}Deploying to production...${colors.reset}`);
    
    try {
      execSync(config.deployCommand, { stdio: 'inherit' });
      console.log(`${colors.green}✓ Deployment successful${colors.reset}\n`);
    } catch (error) {
      console.error(`${colors.red}✗ Deployment failed${colors.reset}`);
      throw new Error('Deployment failed');
    }
  }
}

/**
 * Helper function to ask a question and get user input
 */
function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Helper function to calculate directory size
 */
function calculateDirectorySize(dirPath) {
  let totalSize = 0;
  
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      totalSize += calculateDirectorySize(filePath);
    } else {
      totalSize += stats.size;
    }
  }
  
  return totalSize;
}

/**
 * Helper function to format bytes to human-readable format
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Helper function to check for source maps in production build
 */
function checkForSourceMaps(dirPath) {
  let hasSourceMaps = false;
  
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      if (checkForSourceMaps(filePath)) {
        hasSourceMaps = true;
      }
    } else if (file.endsWith('.map')) {
      hasSourceMaps = true;
    }
  }
  
  return hasSourceMaps;
}

/**
 * Helper function to check for minification in JavaScript files
 */
function checkForMinification(dirPath) {
  let isMinified = true;
  
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      if (!checkForMinification(filePath)) {
        isMinified = false;
      }
    } else if (file.endsWith('.js')) {
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Simple heuristic: non-minified files typically have more newlines
      const newlineCount = (content.match(/\n/g) || []).length;
      const fileSize = stats.size;
      
      // If file has many newlines relative to its size, it might not be minified
      if (newlineCount > fileSize / 1000) {
        isMinified = false;
      }
    }
  }
  
  return isMinified;
}

// Run the main function
main().catch(error => {
  console.error(`${colors.red}${colors.bright}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
