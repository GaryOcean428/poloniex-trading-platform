#!/usr/bin/env node

/**
 * Build Metrics Collection Script
 * Measures and reports build performance metrics
 * Usage: node scripts/build-metrics.mjs [workspace-name]
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const workspace = process.argv[2];
const METRICS_DIR = '.metrics';
const METRICS_FILE = join(METRICS_DIR, 'build-metrics.json');

function ensureMetricsDir() {
  if (!existsSync(METRICS_DIR)) {
    mkdirSync(METRICS_DIR, { recursive: true });
  }
}

function loadMetrics() {
  if (existsSync(METRICS_FILE)) {
    return JSON.parse(readFileSync(METRICS_FILE, 'utf8'));
  }
  return { builds: [] };
}

function saveMetrics(metrics) {
  writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
}

function measureBuild(workspace) {
  console.log(`⏱️  Measuring build time for ${workspace}...\n`);

  const startTime = Date.now();
  const startMemory = process.memoryUsage();

  try {
    let buildCommand;
    switch (workspace) {
      case 'frontend':
        buildCommand = 'yarn workspace frontend build';
        break;
      case 'backend':
        buildCommand = 'yarn workspace backend build';
        break;
      case 'all':
        buildCommand = 'yarn build';
        break;
      default:
        throw new Error(`Unknown workspace: ${workspace}`);
    }

    console.log(`Running: ${buildCommand}`);
    execSync(buildCommand, { stdio: 'inherit' });

    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - startTime;
    const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;

    return {
      workspace,
      timestamp: new Date().toISOString(),
      durationMs: duration,
      durationFormatted: formatDuration(duration),
      memoryUsedMB: Math.round(memoryDelta / 1024 / 1024),
      success: true
    };
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    return {
      workspace,
      timestamp: new Date().toISOString(),
      durationMs: duration,
      durationFormatted: formatDuration(duration),
      success: false,
      error: error.message
    };
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

function analyzeMetrics(metrics) {
  if (metrics.builds.length === 0) {
    console.log('No build metrics available yet.');
    return;
  }

  console.log('\n📊 Build Metrics Summary\n');

  const workspaces = [...new Set(metrics.builds.map(b => b.workspace))];

  workspaces.forEach(ws => {
    const wsBuilds = metrics.builds.filter(b => b.workspace === ws && b.success);
    if (wsBuilds.length === 0) return;

    const durations = wsBuilds.map(b => b.durationMs);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    const latest = wsBuilds[wsBuilds.length - 1];

    console.log(`${ws}:`);
    console.log(`  Latest: ${latest.durationFormatted} (${latest.timestamp})`);
    console.log(`  Average: ${formatDuration(avg)}`);
    console.log(`  Min: ${formatDuration(min)} | Max: ${formatDuration(max)}`);
    console.log(`  Total builds: ${wsBuilds.length}`);
    console.log();
  });

  // Alert on slow builds
  const recentBuilds = metrics.builds.slice(-10);
  const slowBuilds = recentBuilds.filter(b => b.durationMs > 300000); // 5 minutes

  if (slowBuilds.length > 0) {
    console.log('⚠️  Warning: Slow builds detected (>5 minutes):');
    slowBuilds.forEach(b => {
      console.log(`  - ${b.workspace}: ${b.durationFormatted} at ${b.timestamp}`);
    });
    console.log();
  }
}

function main() {
  ensureMetricsDir();

  if (!workspace) {
    console.log('Usage: node scripts/build-metrics.mjs [workspace|all]');
    console.log('       node scripts/build-metrics.mjs analyze');
    console.log('\nAvailable workspaces: frontend, backend, all');
    process.exit(1);
  }

  if (workspace === 'analyze') {
    const metrics = loadMetrics();
    analyzeMetrics(metrics);
    return;
  }

  const buildResult = measureBuild(workspace);
  
  console.log('\n✅ Build metrics collected:');
  console.log(`   Duration: ${buildResult.durationFormatted}`);
  if (buildResult.memoryUsedMB) {
    console.log(`   Memory: ${buildResult.memoryUsedMB} MB`);
  }

  // Save metrics
  const metrics = loadMetrics();
  metrics.builds.push(buildResult);
  
  // Keep only last 100 builds
  if (metrics.builds.length > 100) {
    metrics.builds = metrics.builds.slice(-100);
  }
  
  saveMetrics(metrics);

  console.log(`\n📁 Metrics saved to ${METRICS_FILE}`);
  console.log('   Run "node scripts/build-metrics.mjs analyze" to see trends\n');

  process.exit(buildResult.success ? 0 : 1);
}

main();
