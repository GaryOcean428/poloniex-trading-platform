#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  projectName: 'Poloniex Trading Platform',
  vercelToken: process.env.VITE_VERCEL_TOKEN || 'su9ClN67y653HsAPwlN4HXcX',
  vercelOrgId: process.env.VITE_VERCEL_ORG_ID || 'org_kg0CKm6rJ7LI185Cdv2YiITeXBQL',
  vercelProjectId: process.env.VITE_VERCEL_PROJECT_ID || 'prj_kg0CKm6rJ7LI185Cdv2YiITeXBQL'
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

/**
 * Main function to run the deployment
 */
async function main() {
  printHeader();
  
  try {
    // Check if Vercel CLI is installed
    checkVercelCLI();
    
    // Set up environment variables
    setupEnvironment();
    
    // Build the project
    buildProject();
    
    // Deploy to Vercel
    deployToVercel();
    
    // Print success message
    printSuccessMessage();
  } catch (error) {
    console.error(`${colors.red}${colors.bright}Error: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

/**
 * Print header with project information
 */
function printHeader() {
  console.log(`\n${colors.cyan}${colors.bright}======================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}  Deploying to Production${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}  ${config.projectName}${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}======================================${colors.reset}\n`);
}

/**
 * Check if Vercel CLI is installed
 */
function checkVercelCLI() {
  console.log(`${colors.blue}${colors.bright}Checking for Vercel CLI...${colors.reset}`);
  
  try {
    execSync('npx vercel --version', { stdio: 'ignore' });
    console.log(`${colors.green}✓ Vercel CLI is available${colors.reset}\n`);
  } catch (error) {
    console.log(`${colors.yellow}Vercel CLI not found, installing...${colors.reset}`);
    execSync('npm install -g vercel', { stdio: 'inherit' });
    console.log(`${colors.green}✓ Vercel CLI installed${colors.reset}\n`);
  }
}

/**
 * Set up environment variables
 */
function setupEnvironment() {
  console.log(`${colors.blue}${colors.bright}Setting up environment...${colors.reset}`);
  
  // Create .vercel directory if it doesn't exist
  const vercelDir = path.join(process.cwd(), '.vercel');
  if (!fs.existsSync(vercelDir)) {
    fs.mkdirSync(vercelDir, { recursive: true });
  }
  
  // Create project.json
  const projectConfig = {
    projectId: config.vercelProjectId,
    orgId: config.vercelOrgId
  };
  
  fs.writeFileSync(
    path.join(vercelDir, 'project.json'),
    JSON.stringify(projectConfig, null, 2)
  );
  
  console.log(`${colors.green}✓ Environment set up${colors.reset}\n`);
}

/**
 * Build the project
 */
function buildProject() {
  console.log(`${colors.blue}${colors.bright}Building project...${colors.reset}`);
  
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log(`${colors.green}✓ Build successful${colors.reset}\n`);
  } catch (error) {
    throw new Error('Build failed');
  }
}

/**
 * Deploy to Vercel
 */
function deployToVercel() {
  console.log(`${colors.blue}${colors.bright}Deploying to Vercel...${colors.reset}`);
  
  try {
    // Deploy using Vercel CLI
    const deployCommand = `npx vercel deploy --prod --token=${config.vercelToken} --yes`;
    const deployOutput = execSync(deployCommand, { encoding: 'utf8' });
    
    // Extract deployment URL
    const deployUrl = deployOutput.trim().split('\n').pop();
    
    console.log(`${colors.green}✓ Deployment successful${colors.reset}`);
    console.log(`${colors.bright}Deployment URL: ${deployUrl}${colors.reset}\n`);
    
    // Save deployment URL to file for reference
    fs.writeFileSync('deployment-url.txt', deployUrl);
  } catch (error) {
    throw new Error('Deployment failed');
  }
}

/**
 * Print success message
 */
function printSuccessMessage() {
  console.log(`${colors.green}${colors.bright}======================================${colors.reset}`);
  console.log(`${colors.green}${colors.bright}  Deployment Complete${colors.reset}`);
  console.log(`${colors.green}${colors.bright}======================================${colors.reset}\n`);
  
  console.log(`${colors.green}${colors.bright}The ${config.projectName} has been successfully deployed to production!${colors.reset}`);
  console.log(`${colors.dim}The deployment URL has been saved to deployment-url.txt${colors.reset}\n`);
}

// Run the main function
main().catch(error => {
  console.error(`${colors.red}${colors.bright}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
