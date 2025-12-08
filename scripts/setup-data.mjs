#!/usr/bin/env node

/**
 * Setup Data Directory Script
 * 
 * Initializes the data directory structure and sets up sample data
 * for development and testing.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');

const DIRECTORIES = [
  'markets',
  'markets/historical',
  'config',
  'samples',
];

const SAMPLE_CONFIGS = {
  'config/strategies.json': {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Trading Strategies Configuration',
    strategies: [
      {
        id: 'momentum_1',
        name: 'Momentum Strategy',
        type: 'momentum',
        enabled: true,
        parameters: {
          period: 14,
          threshold: 0.02,
        },
      },
      {
        id: 'mean_reversion_1',
        name: 'Mean Reversion Strategy',
        type: 'mean_reversion',
        enabled: false,
        parameters: {
          window: 20,
          std_dev: 2,
        },
      },
    ],
  },
  'markets/symbols.json': {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Trading Symbols',
    symbols: [
      {
        symbol: 'BTC_USDT',
        base: 'BTC',
        quote: 'USDT',
        enabled: true,
      },
      {
        symbol: 'ETH_USDT',
        base: 'ETH',
        quote: 'USDT',
        enabled: true,
      },
      {
        symbol: 'SOL_USDT',
        base: 'SOL',
        quote: 'USDT',
        enabled: false,
      },
    ],
  },
};

async function ensureDirectory(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
    console.log(`✅ Created directory: ${path.relative(ROOT_DIR, dir)}`);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`✅ Created file: ${path.relative(ROOT_DIR, filePath)}`);
}

async function main() {
  console.log('🔧 Setting up data directory...\n');

  try {
    // Create directories
    console.log('📁 Creating directory structure...');
    for (const dir of DIRECTORIES) {
      await ensureDirectory(path.join(DATA_DIR, dir));
    }
    console.log('');

    // Create sample config files
    console.log('📝 Creating sample configuration files...');
    for (const [filePath, data] of Object.entries(SAMPLE_CONFIGS)) {
      const fullPath = path.join(DATA_DIR, filePath);
      
      // Check if file exists
      try {
        await fs.access(fullPath);
        console.log(`⏭️  Skipped (exists): ${filePath}`);
      } catch {
        // File doesn't exist, create it
        await writeJsonFile(fullPath, data);
      }
    }
    console.log('');

    // Create .gitkeep files for empty directories
    console.log('📌 Adding .gitkeep files...');
    const emptyDirs = ['markets/historical'];
    for (const dir of emptyDirs) {
      const gitkeepPath = path.join(DATA_DIR, dir, '.gitkeep');
      try {
        await fs.access(gitkeepPath);
      } catch {
        await fs.writeFile(gitkeepPath, '');
        console.log(`✅ Created: ${path.relative(ROOT_DIR, gitkeepPath)}`);
      }
    }
    console.log('');

    console.log('✨ Data directory setup complete!\n');
    console.log('Next steps:');
    console.log('1. Review the sample files in data/');
    console.log('2. Add your own data files as needed');
    console.log('3. Use Zod/Pydantic to validate data at runtime\n');

  } catch (error) {
    console.error('❌ Error setting up data directory:', error);
    process.exit(1);
  }
}

main();
