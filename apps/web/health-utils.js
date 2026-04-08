/**
 * Health check utilities for polytrade-fe
 * Provides validation of static assets, libraries, and configuration
 */
import fs from 'fs';
import path from 'path';

class HealthCheckResult {
  constructor(status, message = '', details = {}) {
    this.status = status;
    this.message = message;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

class HealthChecker {
  constructor(distRoot) {
    this.distRoot = distRoot;
    this.cache = new Map();
    this.cacheTimeout = 10000;
  }

  async getCachedResult(key, checkFunction) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.result;
    }
    const result = await checkFunction();
    this.cache.set(key, { result, timestamp: Date.now() });
    return result;
  }

  /**
   * Check static assets.
   * CRITICAL: Only index.html is a hard requirement.
   * PWA assets (manifest, sw.js, icons) are nice-to-have —
   * missing them must NOT return 503 or Railway kills the container.
   */
  async checkStaticAssets() {
    return this.getCachedResult('assets', async () => {
      try {
        const criticalAssets = ['index.html'];
        const optionalAssets = ['manifest.json', 'sw.js', 'icon-192.png', 'favicon.ico'];

        const missingCritical = [];
        const missingOptional = [];
        const assetDetails = {};

        for (const asset of [...criticalAssets, ...optionalAssets]) {
          const assetPath = path.join(this.distRoot, asset);
          try {
            const stats = fs.statSync(assetPath);
            assetDetails[asset] = { exists: true, size: stats.size, modified: stats.mtime.toISOString() };
          } catch {
            if (criticalAssets.includes(asset)) {
              missingCritical.push(asset);
            } else {
              missingOptional.push(asset);
            }
            assetDetails[asset] = { exists: false };
          }
        }

        // Check assets directory
        const assetsDir = path.join(this.distRoot, 'assets');
        try {
          const assetFiles = fs.readdirSync(assetsDir);
          assetDetails['assets/js'] = { count: assetFiles.filter(f => f.endsWith('.js')).length };
          assetDetails['assets/css'] = { count: assetFiles.filter(f => f.endsWith('.css')).length };
        } catch {
          assetDetails['assets/'] = { exists: false };
        }

        // ONLY critical assets cause failure
        if (missingCritical.length > 0) {
          return new HealthCheckResult('failed', `Missing critical assets: ${missingCritical.join(', ')}`, { missingCritical, missingOptional, assetDetails });
        }

        if (missingOptional.length > 0) {
          return new HealthCheckResult('warning', `Optional assets missing: ${missingOptional.join(', ')}`, { missingOptional, assetDetails });
        }

        return new HealthCheckResult('ready', 'All assets found', assetDetails);
      } catch (error) {
        return new HealthCheckResult('failed', `Asset check failed: ${error.message}`, { error: error.stack });
      }
    });
  }

  async checkJavaScriptBundles() {
    return this.getCachedResult('js-bundles', async () => {
      try {
        const assetsDir = path.join(this.distRoot, 'assets');
        if (!fs.existsSync(assetsDir)) {
          return new HealthCheckResult('failed', 'Assets directory not found', { assetsDir });
        }

        const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
        if (jsFiles.length === 0) {
          return new HealthCheckResult('failed', 'No JavaScript bundles found', { assetsDir });
        }

        const foundBundles = {};
        for (const bundle of ['index', 'vendor']) {
          const bundleFile = jsFiles.find(f => f.includes(bundle));
          if (bundleFile) {
            const stats = fs.statSync(path.join(assetsDir, bundleFile));
            foundBundles[bundle] = { file: bundleFile, sizeKB: Math.round(stats.size / 1024) };
          }
        }

        return new HealthCheckResult('ready', `JS bundles validated (${jsFiles.length} files)`, { foundBundles, totalJsFiles: jsFiles.length });
      } catch (error) {
        return new HealthCheckResult('failed', `JS bundle check failed: ${error.message}`, {});
      }
    });
  }

  async checkConfiguration() {
    return this.getCachedResult('config', async () => {
      try {
        const indexPath = path.join(this.distRoot, 'index.html');
        if (!fs.existsSync(indexPath)) {
          return new HealthCheckResult('failed', 'index.html not found', {});
        }

        const indexContent = fs.readFileSync(indexPath, 'utf8');
        const configChecks = {
          indexHtml: {
            hasViewport: indexContent.includes('name="viewport"'),
            hasTitle: indexContent.includes('<title>'),
            hasScripts: indexContent.includes('<script'),
            size: indexContent.length
          },
          environment: {
            nodeEnv: process.env.NODE_ENV || 'production',
            port: process.env.PORT || '5675'
          }
        };

        if (!configChecks.indexHtml.hasScripts) {
          return new HealthCheckResult('failed', 'index.html has no script tags', configChecks);
        }

        return new HealthCheckResult('ready', 'Configuration validated', configChecks);
      } catch (error) {
        return new HealthCheckResult('failed', `Config check failed: ${error.message}`, {});
      }
    });
  }

  async checkLibraries() {
    return this.getCachedResult('libraries', async () => {
      try {
        const assetsDir = path.join(this.distRoot, 'assets');
        if (!fs.existsSync(assetsDir)) {
          return new HealthCheckResult('warning', 'Cannot validate libraries: assets dir missing', {});
        }
        const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
        return jsFiles.length > 0
          ? new HealthCheckResult('ready', `Library validation passed (${jsFiles.length} bundles)`, {})
          : new HealthCheckResult('warning', 'No JS bundles for library validation', {});
      } catch (error) {
        return new HealthCheckResult('warning', `Library check skipped: ${error.message}`, {});
      }
    });
  }

  /**
   * Run comprehensive health check.
   * CRITICAL: Only return 503 if index.html or JS bundles are missing.
   * Missing PWA assets (manifest, sw.js, icons) are warnings, NOT failures.
   * Railway kills the container on 503, so false negatives are catastrophic.
   */
  async runComprehensiveCheck() {
    const startTime = Date.now();
    try {
      const [assets, bundles, config, libs] = await Promise.all([
        this.checkStaticAssets(),
        this.checkJavaScriptBundles(),
        this.checkConfiguration(),
        this.checkLibraries()
      ]);

      const components = {
        assets: assets.status,
        libraries: bundles.status,
        config: config.status,
        validation: libs.status
      };

      // ONLY 'failed' status causes 503. 'warning' is fine (200).
      const failedComponents = Object.entries(components).filter(([_, s]) => s === 'failed');
      const hasFailures = failedComponents.length > 0;
      const httpStatus = hasFailures ? 503 : 200;

      const errors = [];
      if (assets.status === 'failed') errors.push(`Assets: ${assets.message}`);
      if (bundles.status === 'failed') errors.push(`Bundles: ${bundles.message}`);
      if (config.status === 'failed') errors.push(`Config: ${config.message}`);

      return {
        httpStatus,
        response: {
          status: hasFailures ? 'unhealthy' : 'healthy',
          timestamp: new Date().toISOString(),
          service: 'polytrade-fe',
          version: process.env.npm_package_version || '1.0.0',
          uptime: process.uptime(),
          responseTime: `${Date.now() - startTime}ms`,
          components,
          ...(errors.length > 0 && { errors }),
          details: {
            assets: assets.details,
            libraries: bundles.details,
            config: config.details,
            validation: libs.details
          }
        }
      };
    } catch (error) {
      return {
        httpStatus: 503,
        response: {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          service: 'polytrade-fe',
          uptime: process.uptime(),
          errors: [`Health check error: ${error.message}`]
        }
      };
    }
  }

  clearCache() {
    this.cache.clear();
  }
}

export { HealthChecker, HealthCheckResult };
