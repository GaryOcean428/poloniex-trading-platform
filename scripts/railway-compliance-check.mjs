#!/usr/bin/env node
/**
 * Railway Compliance Checker
 * Validates that the repository follows Railway + Yarn 4.9.2 best practices
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const checks = {
  passed: [],
  failed: [],
  warnings: []
};

function checkPassed(message) {
  checks.passed.push(message);
  console.log(`✅ ${message}`);
}

function checkFailed(message) {
  checks.failed.push(message);
  console.error(`❌ ${message}`);
}

function checkWarning(message) {
  checks.warnings.push(message);
  console.warn(`⚠️  ${message}`);
}

// Check 1: No conflicting build configs
console.log('\n📋 Checking for conflicting build configs...');
const conflictingFiles = ['Dockerfile', 'railway.toml', 'nixpacks.toml'];
let hasConflicts = false;
for (const file of conflictingFiles) {
  if (existsSync(join(rootDir, file))) {
    checkFailed(`Conflicting build config found: ${file}`);
    hasConflicts = true;
  }
}
if (!hasConflicts) {
  checkPassed('No conflicting build configs (Dockerfile, railway.toml, nixpacks.toml)');
}

// Check 2: Railpack.json files exist and are valid
console.log('\n📋 Checking railpack.json files...');
const railpackFiles = [
  'railpack.json',
  'frontend/railpack.json',
  'backend/railpack.json'
];

for (const file of railpackFiles) {
  const path = join(rootDir, file);
  if (!existsSync(path)) {
    checkFailed(`Missing railpack.json: ${file}`);
    continue;
  }

  try {
    const content = JSON.parse(readFileSync(path, 'utf-8'));
    
    // Check for proper schema URL
    if (content.$schema === 'https://schema.railpack.com') {
      checkPassed(`${file} uses correct Railpack schema`);
    } else if (content.$schema) {
      checkWarning(`${file} has $schema but may be incorrect: ${content.$schema}`);
    } else {
      checkWarning(`${file} missing $schema property`);
    }

    // Check service-specific files for proper structure
    if (file.includes('frontend') || file.includes('backend')) {
      if (content.provider === 'node') {
        checkPassed(`${file} specifies Node provider`);
      }
      
      if (content.packages) {
        if (content.packages.node) {
          checkPassed(`${file} specifies Node version in packages`);
        }
        if (content.packages.yarn) {
          checkPassed(`${file} specifies Yarn version in packages`);
        }
      }
      
      if (content.steps) {
        if (content.steps.install) {
          checkPassed(`${file} has install step`);
        }
        if (content.steps.build) {
          checkPassed(`${file} has build step`);
          if (content.steps.build.inputs) {
            checkPassed(`${file} build step has inputs dependency`);
          }
        }
      }
      
      if (content.deploy) {
        if (content.deploy.startCommand) {
          checkPassed(`${file} has startCommand`);
        }
        if (content.deploy.healthCheckPath) {
          checkPassed(`${file} has healthCheckPath`);
        } else {
          checkWarning(`${file} missing healthCheckPath`);
        }
      }
    }
    
    // Check root railpack.json for services
    if (file === 'railpack.json') {
      if (content.services) {
        checkPassed(`${file} defines services for monorepo`);
      }
    }
  } catch (error) {
    checkFailed(`Invalid JSON in ${file}: ${error.message}`);
  }
}

// Check 3: Package.json files use Yarn 4.9.2
console.log('\n📋 Checking package.json configuration...');
const packageFiles = [
  'package.json',
  'frontend/package.json',
  'backend/package.json'
];

for (const file of packageFiles) {
  const path = join(rootDir, file);
  if (!existsSync(path)) continue;

  try {
    const pkg = JSON.parse(readFileSync(path, 'utf-8'));
    
    // Check packageManager field
    if (pkg.packageManager) {
      if (pkg.packageManager.includes('yarn@4.9')) {
        checkPassed(`${file} specifies Yarn 4.9.x`);
      } else {
        checkWarning(`${file} specifies ${pkg.packageManager}, should use yarn@4.9.2`);
      }
    } else if (file === 'package.json') {
      checkWarning(`Root ${file} should specify packageManager: "yarn@4.9.2"`);
    }

    // Check for ES module type
    if (pkg.type === 'module') {
      checkPassed(`${file} uses ES modules`);
    }

    // Check Node version requirement
    if (pkg.engines && pkg.engines.node) {
      if (pkg.engines.node.includes('>=20')) {
        checkPassed(`${file} requires Node 20+`);
      } else {
        checkWarning(`${file} should require Node 20+`);
      }
    }
  } catch (error) {
    checkFailed(`Invalid JSON in ${file}: ${error.message}`);
  }
}

// Check 4: No CommonJS require() in ES modules
console.log('\n📋 Checking for CommonJS require() in backend source...');
import { execSync } from 'child_process';

try {
  const result = execSync(
    'grep -r "require(" backend/src --include="*.js" --include="*.ts" 2>/dev/null || true',
    { cwd: rootDir, encoding: 'utf-8' }
  );
  
  if (result.trim()) {
    const lines = result.trim().split('\n');
    // Filter out comments
    const actualRequires = lines.filter(line => !line.includes('// require') && !line.includes('* require'));
    
    if (actualRequires.length > 0) {
      checkFailed(`Found ${actualRequires.length} require() statements in backend/src`);
      actualRequires.forEach(line => console.log(`  ${line}`));
    } else {
      checkPassed('No CommonJS require() in backend ES modules');
    }
  } else {
    checkPassed('No CommonJS require() in backend ES modules');
  }
} catch (error) {
  checkWarning('Could not check for require() statements');
}

// Check 5: Yarn configuration
console.log('\n📋 Checking Yarn configuration...');
const yarnrcPath = join(rootDir, '.yarnrc.yml');
if (existsSync(yarnrcPath)) {
  const yarnrc = readFileSync(yarnrcPath, 'utf-8');
  checkPassed('.yarnrc.yml exists');
  
  if (yarnrc.includes('nodeLinker')) {
    checkPassed('Yarn nodeLinker is configured');
  }
  
  if (yarnrc.includes('enableImmutableInstalls')) {
    checkPassed('Yarn immutable installs configured');
  }
} else {
  checkWarning('.yarnrc.yml not found');
}

// Check 6: Health check endpoints
console.log('\n📋 Checking health check endpoints...');
try {
  const backendIndex = readFileSync(join(rootDir, 'backend/src/index.ts'), 'utf-8');
  if (backendIndex.includes('/api/health')) {
    checkPassed('Backend has /api/health endpoint');
  } else {
    checkFailed('Backend missing /api/health endpoint');
  }

  const frontendServe = readFileSync(join(rootDir, 'frontend/serve.js'), 'utf-8');
  if (frontendServe.includes('/healthz') || frontendServe.includes('/api/health')) {
    checkPassed('Frontend has health check endpoint');
  } else {
    checkFailed('Frontend missing health check endpoint');
  }
} catch (error) {
  checkWarning('Could not verify health check endpoints');
}

// Check 7: Port binding
console.log('\n📋 Checking port binding configuration...');
try {
  const backendIndex = readFileSync(join(rootDir, 'backend/src/index.ts'), 'utf-8');
  if (backendIndex.includes('0.0.0.0') && backendIndex.includes('process.env.PORT')) {
    checkPassed('Backend binds to 0.0.0.0 and uses PORT env var');
  } else if (backendIndex.includes('process.env.PORT') || backendIndex.includes('env.PORT')) {
    checkPassed('Backend uses PORT env var');
  } else {
    checkFailed('Backend should bind to 0.0.0.0 and use PORT env var');
  }

  const frontendServe = readFileSync(join(rootDir, 'frontend/serve.js'), 'utf-8');
  if (frontendServe.includes('0.0.0.0') && frontendServe.includes('process.env.PORT')) {
    checkPassed('Frontend binds to 0.0.0.0 and uses PORT env var');
  } else {
    checkWarning('Frontend should verify 0.0.0.0 binding and PORT env var');
  }
} catch (error) {
  checkWarning('Could not verify port binding configuration');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 RAILWAY COMPLIANCE SUMMARY');
console.log('='.repeat(60));
console.log(`✅ Passed: ${checks.passed.length}`);
console.log(`⚠️  Warnings: ${checks.warnings.length}`);
console.log(`❌ Failed: ${checks.failed.length}`);
console.log('='.repeat(60));

if (checks.failed.length > 0) {
  console.log('\n❌ COMPLIANCE CHECK FAILED');
  console.log('Please fix the issues above before deploying to Railway.');
  process.exit(1);
} else if (checks.warnings.length > 0) {
  console.log('\n⚠️  COMPLIANCE CHECK PASSED WITH WARNINGS');
  console.log('Consider addressing warnings for optimal Railway deployment.');
  process.exit(0);
} else {
  console.log('\n✅ ALL COMPLIANCE CHECKS PASSED');
  console.log('Repository is ready for Railway deployment!');
  process.exit(0);
}
