/**
 * Minimal static server for Vite dist with correct caching and MIME types.
 * - index.html: no-store
 * - /assets/*: immutable, long cache
 * - No SPA fallback for /assets (return 404 if missing)
 * - SPA fallback (index.html) for non-asset routes
 * - Enhanced /healthz endpoint with comprehensive validation
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import { HealthChecker } from './health-utils.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DIST_ROOT = path.join(__dirname, 'dist');

const PORT = parseInt(process.env.PORT || '5675', 10);
const HOST = '0.0.0.0';

// Initialize health checker
const healthChecker = new HealthChecker(DIST_ROOT);

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

function setCommonHeaders(res, filePath) {
  const ct = getContentType(filePath);
  res.setHeader('Content-Type', ct);

  // Special-case: service worker
  if (filePath.endsWith('/sw.js') || filePath.endsWith('\\sw.js')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
    return;
  }

  // Cache policy
  if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    // Immutable hashed assets
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (filePath.endsWith('.html')) {
    // Prevent stale index.html
    res.setHeader('Cache-Control', 'no-store');
  } else {
    // Reasonable default for other static files
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}

function existsSafe(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function serveFile(res, filePath) {
  setCommonHeaders(res, filePath);
  fs.createReadStream(filePath)
    .on('error', () => {
      res.statusCode = 500;
      res.end('Internal Server Error');
    })
    .pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url || '/');
    let reqPath = decodeURIComponent(parsed.pathname || '/');

    // Enhanced health check endpoints with comprehensive validation
    if (reqPath === '/api/health' || reqPath === '/healthz') {
      try {
        const healthResult = await healthChecker.runComprehensiveCheck();
        
        res.statusCode = healthResult.httpStatus;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        
        // Log health check failures for monitoring
        if (healthResult.httpStatus !== 200) {
          console.error('[HEALTH CHECK FAILED]', {
            timestamp: new Date().toISOString(),
            status: healthResult.httpStatus,
            errors: healthResult.response.errors,
            components: healthResult.response.components
          });
        }
        
        return res.end(JSON.stringify(healthResult.response, null, 2));
      } catch (error) {
        // Fallback health check if comprehensive check fails
        console.error('[HEALTH CHECK ERROR]', {
          timestamp: new Date().toISOString(),
          error: error.message,
          stack: error.stack
        });
        
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        
        return res.end(JSON.stringify({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          service: 'polytrade-fe',
          version: process.env.npm_package_version || '1.0.0',
          uptime: process.uptime(),
          components: {
            assets: 'failed',
            libraries: 'failed',
            config: 'failed',
            validation: 'failed'
          },
          errors: [`Health check system error: ${error.message}`]
        }, null, 2));
      }
    }

    // API status endpoint
    if (reqPath === '/api/status') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({
        service: 'polytrade-fe',
        status: 'running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'production',
        version: process.env.npm_package_version || '1.0.0'
      }));
    }

    // Normalize path traversal
    if (reqPath.includes('..')) {
      res.statusCode = 400;
      return res.end('Bad Request');
    }

    // Special asset handling: never SPA-fallback for /assets/*
    if (reqPath.startsWith('/assets/')) {
      const assetPath = path.join(DIST_ROOT, reqPath);
      if (existsSafe(assetPath)) {
        res.statusCode = 200;
        return serveFile(res, assetPath);
      }
      // Strict 404 for missing assets
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('Not Found');
    }

    // Special-case favicon to avoid noisy 500s if missing
    if (reqPath === '/favicon.ico') {
      const icoPath = path.join(DIST_ROOT, 'favicon.ico');
      if (existsSafe(icoPath)) {
        res.statusCode = 200;
        return serveFile(res, icoPath);
      }
      res.statusCode = 204; // No Content
      return res.end();
    }

    // Try to serve exact static file first
    const staticPath = path.join(DIST_ROOT, reqPath);
    if (existsSafe(staticPath)) {
      res.statusCode = 200;
      return serveFile(res, staticPath);
    }

    // For other routes, SPA fallback to index.html
    const indexPath = path.join(DIST_ROOT, 'index.html');
    if (existsSafe(indexPath)) {
      res.statusCode = 200;
      return serveFile(res, indexPath);
    }

    // If dist is missing
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Build output not found. Did you run "yarn build"?');
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Internal Server Error');
  }
});

// Startup validation
function validateSetup() {
  console.log('='.repeat(60));
  console.log('Frontend Static Server - Startup Validation');
  console.log('='.repeat(60));
  console.log(`Working Directory: ${process.cwd()}`);
  console.log(`Script Location: ${__dirname}`);
  console.log(`Dist Root: ${DIST_ROOT}`);
  console.log(`Port: ${PORT}`);
  console.log(`Host: ${HOST}`);
  console.log('-'.repeat(60));

  // Check if dist folder exists
  if (!fs.existsSync(DIST_ROOT)) {
    console.error('❌ ERROR: dist folder not found!');
    console.error(`   Expected location: ${DIST_ROOT}`);
    console.error('   This usually means the build step did not run.');
    console.error('   Please run "yarn build" or "vite build" first.');
    console.error('='.repeat(60));
    process.exit(1);
  }

  // Check if index.html exists in dist
  const indexPath = path.join(DIST_ROOT, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error('❌ ERROR: dist/index.html not found!');
    console.error(`   Expected location: ${indexPath}`);
    console.error('   The build may have failed or produced files in the wrong location.');
    console.error('='.repeat(60));
    process.exit(1);
  }

  // Check if assets folder exists
  const assetsPath = path.join(DIST_ROOT, 'assets');
  if (!fs.existsSync(assetsPath)) {
    console.warn('⚠️  WARNING: dist/assets folder not found!');
    console.warn(`   Expected location: ${assetsPath}`);
    console.warn('   The application may not load correctly.');
  } else {
    const assetFiles = fs.readdirSync(assetsPath);
    console.log(`✅ Found ${assetFiles.length} asset files in dist/assets/`);
  }

  console.log('✅ Validation passed - all required files present');
  console.log('='.repeat(60));
}

// Run validation before starting server
validateSetup();

server.listen(PORT, HOST, () => {
  console.log(`🚀 Static server listening on http://${HOST}:${PORT}`);
  console.log(`📁 Serving files from: ${DIST_ROOT}`);
  console.log(`🏥 Health check available at: http://${HOST}:${PORT}/healthz`);
  console.log('='.repeat(60));
});
