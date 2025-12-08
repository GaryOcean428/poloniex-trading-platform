#!/usr/bin/env node

/**
 * Code Generation Script
 * 
 * This script generates TypeScript types from the Python FastAPI backend's
 * OpenAPI specification to ensure type safety between frontend and backend.
 * 
 * Workflow:
 * 1. Python FastAPI updates Pydantic models
 * 2. FastAPI auto-generates openapi.json
 * 3. This script generates TS interfaces
 * 4. Frontend imports typed API client
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:9080';
const OPENAPI_PATH = path.join(process.cwd(), 'generated', 'openapi.json');
const OUTPUT_DIR = path.join(process.cwd(), 'packages', 'ts-types', 'src', 'generated');

async function main() {
  console.log('🔄 Starting TypeScript type generation from OpenAPI spec...\n');

  try {
    // Step 1: Fetch OpenAPI spec from Python backend
    console.log('📥 Fetching OpenAPI spec from', PYTHON_API_URL);
    const response = await fetch(`${PYTHON_API_URL}/openapi.json`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.statusText}`);
    }

    const openApiSpec = await response.json();
    
    // Save OpenAPI spec
    await fs.mkdir(path.dirname(OPENAPI_PATH), { recursive: true });
    await fs.writeFile(OPENAPI_PATH, JSON.stringify(openApiSpec, null, 2));
    console.log('✅ OpenAPI spec saved to', OPENAPI_PATH);

    // Step 2: Generate TypeScript types using openapi-typescript
    console.log('\n📝 Generating TypeScript types...');
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // Install openapi-typescript if not already installed
    try {
      await execAsync('npx openapi-typescript --version');
    } catch {
      console.log('Installing openapi-typescript...');
      await execAsync('npm install -g openapi-typescript');
    }

    // Generate types
    const outputPath = path.join(OUTPUT_DIR, 'api-types.ts');
    await execAsync(`npx openapi-typescript ${OPENAPI_PATH} -o ${outputPath}`);
    
    console.log('✅ TypeScript types generated at', outputPath);

    // Step 3: Generate API client (optional)
    console.log('\n🔧 Generating API client...');
    
    // Create a simple API client wrapper
    const clientCode = `
// Auto-generated API client from OpenAPI spec
// DO NOT EDIT MANUALLY

import type { paths } from './api-types';

export type ApiPaths = paths;

// Add typed fetch wrapper here
export function createApiClient(baseUrl: string) {
  return {
    // Add typed methods based on OpenAPI spec
  };
}
`;

    await fs.writeFile(path.join(OUTPUT_DIR, 'api-client.ts'), clientCode.trim());
    console.log('✅ API client generated');

    // Step 4: Update package exports
    console.log('\n📦 Updating package exports...');
    const indexPath = path.join(OUTPUT_DIR, 'index.ts');
    const indexCode = `
// Generated API types and client
export * from './api-types';
export * from './api-client';
`.trim();
    
    await fs.writeFile(indexPath, indexCode);
    console.log('✅ Package exports updated');

    console.log('\n✨ Type generation complete!\n');
    console.log('Next steps:');
    console.log('1. Import types in your frontend: import { ApiPaths } from "@poloniex-platform/ts-types/generated"');
    console.log('2. Use types for API calls to ensure type safety');
    console.log('3. Re-run this script when backend API changes\n');

  } catch (error) {
    console.error('❌ Error generating types:', error);
    process.exit(1);
  }
}

main();
