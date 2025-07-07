#!/usr/bin/env node

/**
 * Railway Configuration Validator
 * Validates that all railway.json files exist and are properly formatted
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find the project root (where package.json with workspaces is located)
let projectRoot = process.cwd();
while (!fs.existsSync(path.join(projectRoot, 'package.json')) || 
       !fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8').includes('workspaces')) {
  const parent = path.dirname(projectRoot);
  if (parent === projectRoot) {
    // We've reached the filesystem root, use the directory containing this script
    projectRoot = path.dirname(__dirname);
    break;
  }
  projectRoot = parent;
}

const configs = [
  { name: 'Root', path: path.join(projectRoot, 'railway.json') },
  { name: 'Backend', path: path.join(projectRoot, 'backend', 'railway.json') },
  { name: 'Frontend', path: path.join(projectRoot, 'frontend', 'railway.json') }
];

console.log('🚂 Railway Configuration Validator');
console.log(`📁 Project Root: ${projectRoot}`);
console.log('==========================\n');

let allValid = true;

for (const config of configs) {
  try {
    const relativePath = path.relative(projectRoot, config.path);
    console.log(`Checking ${config.name} config: ${relativePath}`);
    
    // Check if file exists
    if (!fs.existsSync(config.path)) {
      console.log(`❌ ${config.name}: File does not exist`);
      allValid = false;
      continue;
    }
    
    // Check if file is readable
    const content = fs.readFileSync(config.path, 'utf8');
    
    // Check if valid JSON
    const parsed = JSON.parse(content);
    
    // Basic validation
    if (!parsed.$schema) {
      console.log(`⚠️  ${config.name}: Missing $schema field`);
    }
    
    if (config.name !== 'Root') {
      if (!parsed.build) {
        console.log(`⚠️  ${config.name}: Missing build configuration`);
      }
      if (!parsed.deploy) {
        console.log(`⚠️  ${config.name}: Missing deploy configuration`);
      }
    }
    
    console.log(`✅ ${config.name}: Valid configuration`);
    
  } catch (error) {
    console.log(`❌ ${config.name}: ${error.message}`);
    allValid = false;
  }
}

console.log('\n' + '='.repeat(50));
if (allValid) {
  console.log('✅ All Railway configurations are valid!');
  console.log('\n💡 If Railway still reports "config file does not exist":');
  console.log('   1. Check Railway dashboard Config Path setting');
  console.log('   2. Use absolute path: /backend/railway.json');
  console.log('   3. Or use root config: /railway.json');
  console.log('   4. Ensure Root Directory is set to: /backend');
} else {
  console.log('❌ Some Railway configurations have issues');
  process.exit(1);
}