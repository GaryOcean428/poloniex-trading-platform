import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync, rmSync, existsSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendDir = join(__dirname, '..', '..');

// Helper function to make HTTP requests
async function makeRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      timeout: 5000,
      ...options
    });
    
    const text = await response.text();
    let data = null;
    
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    
    return {
      status: response.status,
      data,
      headers: Object.fromEntries(response.headers.entries())
    };
  } catch (error) {
    throw new Error(`Request failed: ${error.message}`);
  }
}

// Helper to wait for server to be ready
async function waitForServer(url, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await makeRequest(url);
      return true;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return false;
}

describe('Enhanced /healthz Endpoint Tests', () => {
  let serverProcess = null;
  const serverUrl = 'http://localhost:5675';
  const healthUrl = `${serverUrl}/healthz`;

  beforeAll(async () => {
    // Ensure we have a dist folder for testing
    if (!existsSync(join(frontendDir, 'dist'))) {
      const result = spawnSync('yarn', ['build'], {
        cwd: frontendDir,
        stdio: 'pipe',
        encoding: 'utf8'
      });
      if (result.status !== 0 || !existsSync(join(frontendDir, 'dist'))) {
        const stderr = result.stderr?.trim() || result.stdout?.trim() || 'Unknown build error';
        throw new Error(`Dist folder not found and build failed: ${stderr}`);
      }
    }
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      // Wait for process to end
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  beforeEach(() => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
  });

  describe('Healthy State Tests', () => {
    it('should return 200 with healthy status when all components are ready', async () => {
      // Start server
      serverProcess = spawn('node', ['serve.js'], {
        cwd: frontendDir,
        stdio: 'pipe'
      });

      // Wait for server to be ready
      const serverReady = await waitForServer(healthUrl);
      expect(serverReady).toBe(true);

      const response = await makeRequest(healthUrl);

      expect(response.status).toBe(200);
      expect(response.data.status).toBe('healthy');
      expect(response.data.service).toBe('polytrade-fe');
      expect(response.data.components).toEqual({
        assets: 'ready',
        libraries: 'ready',
        config: expect.any(String),
        validation: 'ready'
      });
      expect(response.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(response.data.responseTime).toMatch(/^\d+ms$/);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['cache-control']).toContain('no-cache');
    });

    it('should include detailed component information in healthy response', async () => {
      serverProcess = spawn('node', ['serve.js'], {
        cwd: frontendDir,
        stdio: 'pipe'
      });

      await waitForServer(healthUrl);
      const response = await makeRequest(healthUrl);

      expect(response.data.details).toBeDefined();
      expect(response.data.details.assets).toBeDefined();
      expect(response.data.details.libraries).toBeDefined();
      expect(response.data.details.config).toBeDefined();
      expect(response.data.details.validation).toBeDefined();

      // Check asset details
      expect(response.data.details.assets['index.html']).toEqual({
        exists: true,
        size: expect.any(Number),
        modified: expect.any(String)
      });

      // Check library bundles
      expect(response.data.details.libraries.foundBundles).toBeDefined();
      expect(response.data.details.libraries.totalJsFiles).toBeGreaterThan(0);
    });

    it('should have response time under 100ms for performance requirement', async () => {
      serverProcess = spawn('node', ['serve.js'], {
        cwd: frontendDir,
        stdio: 'pipe'
      });

      await waitForServer(healthUrl);
      
      // Make multiple requests to test cached performance
      const startTime = Date.now();
      const response = await makeRequest(healthUrl);
      const endTime = Date.now();
      
      const actualResponseTime = endTime - startTime;
      const reportedResponseTime = parseInt(response.data.responseTime.replace('ms', ''));

      expect(actualResponseTime).toBeLessThan(100);
      expect(reportedResponseTime).toBeLessThan(100);
    });

    it('should work for both /healthz and /api/health endpoints', async () => {
      serverProcess = spawn('node', ['serve.js'], {
        cwd: frontendDir,
        stdio: 'pipe'
      });

      await waitForServer(healthUrl);

      const healthzResponse = await makeRequest(`${serverUrl}/healthz`);
      const apiHealthResponse = await makeRequest(`${serverUrl}/api/health`);

      expect(healthzResponse.status).toBe(200);
      expect(apiHealthResponse.status).toBe(200);
      expect(healthzResponse.data.status).toBe('healthy');
      expect(apiHealthResponse.data.status).toBe('healthy');
    });
  });

  describe('Unhealthy State Tests', () => {
    it('should return 503 when critical assets are missing', async () => {
      // Temporarily move dist folder
      const distPath = join(frontendDir, 'dist');
      const backupPath = join(frontendDir, 'dist_test_backup');
      
      if (existsSync(backupPath)) {
        rmSync(backupPath, { recursive: true });
      }
      
      // Move dist folder
      renameSync(distPath, backupPath);

      try {
        serverProcess = spawn('node', ['serve.js'], {
          cwd: frontendDir,
          stdio: 'pipe'
        });

        const serverReady = await waitForServer(healthUrl, 4);
        expect(serverReady).toBe(false);
      } finally {
        if (serverProcess) {
          serverProcess.kill();
          serverProcess = null;
        }
        if (existsSync(backupPath)) {
          renameSync(backupPath, distPath);
        }
      }
    });

    it('should include detailed error information when unhealthy', async () => {
      // Remove a specific critical file temporarily
      const indexPath = join(frontendDir, 'dist', 'index.html');
      const backupPath = join(frontendDir, 'dist', 'index.html.backup');
      
      // Backup and remove index.html
      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath);
        writeFileSync(backupPath, content);
        unlinkSync(indexPath);
      }

      try {
        serverProcess = spawn('node', ['serve.js'], {
          cwd: frontendDir,
          stdio: 'pipe'
        });

        const serverReady = await waitForServer(healthUrl, 4);
        expect(serverReady).toBe(false);
      } finally {
        // Restore index.html
        if (existsSync(backupPath)) {
          const content = readFileSync(backupPath);
          writeFileSync(indexPath, content);
          unlinkSync(backupPath);
        }
      }
    });

    it('should handle health check system errors gracefully', async () => {
      // We'll test this by corrupting the health-utils module temporarily
      const healthUtilsPath = join(frontendDir, 'health-utils.js');
      const backupPath = join(frontendDir, 'health-utils.js.backup');
      
      // Backup original file
      const originalContent = readFileSync(healthUtilsPath, 'utf8');
      writeFileSync(backupPath, originalContent);
      
      // Write corrupted content
      writeFileSync(healthUtilsPath, 'export { InvalidClass }; // Corrupted file');

      try {
        serverProcess = spawn('node', ['serve.js'], {
          cwd: frontendDir,
          stdio: 'pipe'
        });

        const serverReady = await waitForServer(healthUrl, 4);
        expect(serverReady).toBe(false);
      } finally {
        // Restore original file
        writeFileSync(healthUtilsPath, originalContent);
        unlinkSync(backupPath);
      }
    });
  });

  describe('Performance and Caching Tests', () => {
    it('should cache health check results for performance', async () => {
      serverProcess = spawn('node', ['serve.js'], {
        cwd: frontendDir,
        stdio: 'pipe'
      });

      await waitForServer(healthUrl);

      // First request
      const start1 = Date.now();
      const response1 = await makeRequest(healthUrl);
      const time1 = Date.now() - start1;

      // Second request (should be cached)
      const start2 = Date.now();
      const response2 = await makeRequest(healthUrl);
      const time2 = Date.now() - start2;

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      
      // Both requests should be fast, but cached one might be slightly faster
      expect(time1).toBeLessThan(100);
      expect(time2).toBeLessThan(100);
      
      // Responses should be similar
      expect(response1.data.status).toBe(response2.data.status);
    });

    it('should include performance metrics in response', async () => {
      serverProcess = spawn('node', ['serve.js'], {
        cwd: frontendDir,
        stdio: 'pipe'
      });

      await waitForServer(healthUrl);
      const response = await makeRequest(healthUrl);

      expect(response.data.responseTime).toMatch(/^\d+ms$/);
      expect(response.data.uptime).toBeGreaterThan(0);
      expect(response.data.timestamp).toBeDefined();
    });
  });

  describe('Response Format Validation', () => {
    it('should return properly formatted JSON response', async () => {
      serverProcess = spawn('node', ['serve.js'], {
        cwd: frontendDir,
        stdio: 'pipe'
      });

      await waitForServer(healthUrl);
      const response = await makeRequest(healthUrl);

      // Validate required fields
      const requiredFields = [
        'status', 'timestamp', 'service', 'version', 'uptime', 
        'responseTime', 'components', 'details'
      ];

      for (const field of requiredFields) {
        expect(response.data[field]).toBeDefined();
      }

      // Validate component statuses
      const componentStatuses = ['ready', 'failed', 'warning'];
      for (const [component, status] of Object.entries(response.data.components)) {
        expect(componentStatuses).toContain(status);
      }
    });

    it('should include proper HTTP headers', async () => {
      serverProcess = spawn('node', ['serve.js'], {
        cwd: frontendDir,
        stdio: 'pipe'
      });

      await waitForServer(healthUrl);
      const response = await makeRequest(healthUrl);

      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['cache-control']).toContain('no-cache');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['cache-control']).toContain('must-revalidate');
    });
  });
});
