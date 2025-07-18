#!/usr/bin/env node

/**
 * Fix Railway Template Resolution
 *
 * This script ensures that Railway template variables are properly resolved
 * during the build process for the frontend deployment.
 */

import fs from 'fs';
import path from 'path';

console.log('🔧 Fixing Railway template resolution...');

// Check if we're in Railway environment
const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID;

if (isRailway) {
  console.log('✅ Railway environment detected');

  // Set the proper backend URL for Railway
  const railwayBackendUrl = 'https://polytrade-be.up.railway.app';

  // Update environment variables to ensure proper resolution
  process.env.VITE_BACKEND_URL = railwayBackendUrl;
  process.env.POLYTRADE_BE_RAILWAY_PUBLIC_DOMAIN = 'polytrade-be.up.railway.app';

  console.log(`✅ Set VITE_BACKEND_URL to: ${railwayBackendUrl}`);
  console.log(`✅ Set POLYTRADE_BE_RAILWAY_PUBLIC_DOMAIN to: polytrade-be.up.railway.app`);

  // Create a .env file for the build process
  const envContent = `VITE_BACKEND_URL=${railwayBackendUrl}
VITE_WS_URL=wss://polytrade-be.up.railway.app
POLYTRADE_BE_RAILWAY_PUBLIC_DOMAIN=polytrade-be.up.railway.app
`;

  fs.writeFileSync('.env', envContent);
  console.log('✅ Created .env file with proper Railway configuration');

} else {
  console.log('ℹ️  Not in Railway environment, using local configuration');
}

// Check for any files with unresolved templates
const checkForTemplates = (dir) => {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
      checkForTemplates(filePath);
    } else if (stat.isFile() && (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.tsx'))) {
      const content = fs.readFileSync(filePath, 'utf8');

      if (content.includes('${polytrade-be.railway_public_domain}')) {
        console.log(`⚠️  Found unresolved template in: ${filePath}`);

        // Replace the template with the actual URL
        const fixedContent = content.replace(
          /\$\{polytrade-be\.railway_public_domain\}/g,
          'polytrade-be.up.railway.app'
        );

        fs.writeFileSync(filePath, fixedContent);
        console.log(`✅ Fixed template in: ${filePath}`);
      }
    }
  });
};

// Check source files for unresolved templates
if (fs.existsSync('src')) {
  console.log('🔍 Checking for unresolved templates in source files...');
  checkForTemplates('src');
}

console.log('✅ Railway template resolution fix completed!');
