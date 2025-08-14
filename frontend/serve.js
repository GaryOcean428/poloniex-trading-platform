/**
 * Minimal static server for Vite dist with correct caching and MIME types.
 * - index.html: no-store
 * - /assets/*: immutable, long cache
 * - No SPA fallback for /assets (return 404 if missing)
 * - SPA fallback (index.html) for non-asset routes
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DIST_ROOT = path.join(__dirname, 'dist');

const PORT = parseInt(process.env.PORT || '5675', 10);
const HOST = '0.0.0.0';

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

const server = http.createServer((req, res) => {
  try {
    const parsed = url.parse(req.url || '/');
    let reqPath = decodeURIComponent(parsed.pathname || '/');

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

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Static server listening on http://${HOST}:${PORT}`);
});
