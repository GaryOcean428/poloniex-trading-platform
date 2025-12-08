/**
 * Health check utilities for polytrade-fe
 * Provides comprehensive validation of static assets, libraries, and configuration
 */
import fs from 'fs';
import path from 'path';

/**
 * Health check result interface
 */
class HealthCheckResult {
  constructor(status, message = '', details = {}) {
    this.status = status; // 'ready', 'failed', 'warning'
    this.message = message;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Performance-optimized health checker with caching
 */
class HealthChecker {
  constructor(distRoot) {
    this.distRoot = distRoot;
    this.cache = new Map();
    this.cacheTimeout = 10000; // 10 seconds cache
  }

  /**
   * Get cached result or run check
   */
  async getCachedResult(key, checkFunction) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.result;
    }

    const result = await checkFunction();
    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });

    return result;
  }

  /**
   * Check if critical static assets exist and are accessible
   */
  async checkStaticAssets() {
    return this.getCachedResult('assets', async () => {
      try {
        const requiredAssets = [
          'index.html',
          'manifest.json',
          'sw.js',
          'icon-192.png',
          'favicon.ico'
        ];

        const missingAssets = [];
        const assetDetails = {};

        for (const asset of requiredAssets) {
          const assetPath = path.join(this.distRoot, asset);
          try {
            const stats = fs.statSync(assetPath);
            assetDetails[asset] = {
              exists: true,
              size: stats.size,
              modified: stats.mtime.toISOString()
            };
          } catch (error) {
            missingAssets.push(asset);
            assetDetails[asset] = {
              exists: false,
              error: error.message
            };
          }
        }

        // Check assets directory
        const assetsDir = path.join(this.distRoot, 'assets');
        let jsFiles = [];
        let cssFiles = [];
        
        try {
          const assetFiles = fs.readdirSync(assetsDir);
          jsFiles = assetFiles.filter(f => f.endsWith('.js'));
          cssFiles = assetFiles.filter(f => f.endsWith('.css'));
          
          assetDetails['assets/js'] = {
            count: jsFiles.length,
            files: jsFiles.slice(0, 5) // First 5 for brevity
          };
          assetDetails['assets/css'] = {
            count: cssFiles.length,
            files: cssFiles
          };
        } catch (error) {
          missingAssets.push('assets/');
          assetDetails['assets/'] = {
            exists: false,
            error: error.message
          };
        }

        if (missingAssets.length > 0) {
          return new HealthCheckResult(
            'failed',
            `Missing critical assets: ${missingAssets.join(', ')}`,
            { missingAssets, assetDetails }
          );
        }

        return new HealthCheckResult(
          'ready',
          `All ${requiredAssets.length} critical assets found`,
          assetDetails
        );
      } catch (error) {
        return new HealthCheckResult(
          'failed',
          `Asset check failed: ${error.message}`,
          { error: error.stack }
        );
      }
    });
  }

  /**
   * Validate JavaScript bundle integrity
   */
  async checkJavaScriptBundles() {
    return this.getCachedResult('js-bundles', async () => {
      try {
        const assetsDir = path.join(this.distRoot, 'assets');
        
        if (!fs.existsSync(assetsDir)) {
          return new HealthCheckResult(
            'failed',
            'Assets directory not found',
            { assetsDir }
          );
        }

        const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
        
        if (jsFiles.length === 0) {
          return new HealthCheckResult(
            'failed',
            'No JavaScript bundles found',
            { assetsDir }
          );
        }

        // Validate main bundles exist
        const criticalBundles = ['index', 'vendor'];
        const foundBundles = {};
        const missingBundles = [];

        for (const bundle of criticalBundles) {
          const bundleFile = jsFiles.find(f => f.includes(bundle));
          if (bundleFile) {
            const bundlePath = path.join(assetsDir, bundleFile);
            const stats = fs.statSync(bundlePath);
            foundBundles[bundle] = {
              file: bundleFile,
              size: stats.size,
              sizeKB: Math.round(stats.size / 1024)
            };
          } else {
            missingBundles.push(bundle);
          }
        }

        if (missingBundles.length > 0) {
          return new HealthCheckResult(
            'warning',
            `Some expected bundles missing: ${missingBundles.join(', ')}`,
            { foundBundles, missingBundles, totalJsFiles: jsFiles.length }
          );
        }

        return new HealthCheckResult(
          'ready',
          `JavaScript bundles validated (${jsFiles.length} files)`,
          { foundBundles, totalJsFiles: jsFiles.length }
        );
      } catch (error) {
        return new HealthCheckResult(
          'failed',
          `JavaScript bundle check failed: ${error.message}`,
          { error: error.stack }
        );
      }
    });
  }

  /**
   * Verify essential configuration files are accessible
   */
  async checkConfiguration() {
    return this.getCachedResult('config', async () => {
      try {
        const configChecks = {};
        
        // Check index.html for proper meta tags and script references
        const indexPath = path.join(this.distRoot, 'index.html');
        if (fs.existsSync(indexPath)) {
          const indexContent = fs.readFileSync(indexPath, 'utf8');
          configChecks.indexHtml = {
            hasViewport: indexContent.includes('name="viewport"'),
            hasTitle: indexContent.includes('<title>'),
            hasScripts: indexContent.includes('<script'),
            hasManifest: indexContent.includes('manifest.json'),
            size: indexContent.length
          };
        } else {
          configChecks.indexHtml = { exists: false };
        }

        // Check manifest.json
        const manifestPath = path.join(this.distRoot, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            configChecks.manifest = {
              valid: true,
              hasName: !!manifestContent.name,
              hasIcons: Array.isArray(manifestContent.icons) && manifestContent.icons.length > 0,
              hasStartUrl: !!manifestContent.start_url
            };
          } catch (error) {
            configChecks.manifest = {
              valid: false,
              error: error.message
            };
          }
        } else {
          configChecks.manifest = { exists: false };
        }

        // Check for environment configuration
        configChecks.environment = {
          nodeEnv: process.env.NODE_ENV || 'production',
          port: process.env.PORT || '5675',
          hasVersion: !!process.env.npm_package_version
        };

        // Determine overall status
        let status = 'ready';
        let issues = [];

        if (!configChecks.indexHtml.exists) {
          status = 'failed';
          issues.push('index.html missing');
        } else if (!configChecks.indexHtml.hasScripts) {
          status = 'failed';
          issues.push('index.html has no script tags');
        }

        if (!configChecks.manifest.exists) {
          status = 'warning';
          issues.push('manifest.json missing');
        } else if (!configChecks.manifest.valid) {
          status = 'warning';
          issues.push('manifest.json invalid');
        }

        const message = status === 'ready' 
          ? 'Configuration validated successfully'
          : `Configuration issues: ${issues.join(', ')}`;

        return new HealthCheckResult(status, message, configChecks);
      } catch (error) {
        return new HealthCheckResult(
          'failed',
          `Configuration check failed: ${error.message}`,
          { error: error.stack }
        );
      }
    });
  }

  /**
   * Test critical library functionality (basic validation)
   */
  async checkLibraries() {
    return this.getCachedResult('libraries', async () => {
      try {
        // For server-side health check, we can only validate that the built files exist
        // and contain expected library references
        const indexPath = path.join(this.distRoot, 'index.html');
        
        if (!fs.existsSync(indexPath)) {
          return new HealthCheckResult(
            'failed',
            'Cannot validate libraries: index.html not found',
            {}
          );
        }

        const indexContent = fs.readFileSync(indexPath, 'utf8');
        const assetsDir = path.join(this.distRoot, 'assets');
        
        let bundleContent = '';
        if (fs.existsSync(assetsDir)) {
          const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
          // Check main bundle for library signatures
          const mainBundle = jsFiles.find(f => f.includes('index')) || jsFiles[0];
          if (mainBundle) {
            const bundlePath = path.join(assetsDir, mainBundle);
            bundleContent = fs.readFileSync(bundlePath, 'utf8').substring(0, 10000); // First 10KB
          }
        }

        const libraryChecks = {
          react: {
            inIndex: indexContent.toLowerCase().includes('react'),
            inBundle: bundleContent.includes('React') || bundleContent.includes('react'),
            status: 'unknown' // Can't fully validate without runtime
          },
          routing: {
            inBundle: bundleContent.includes('router') || bundleContent.includes('Router'),
            status: 'unknown'
          },
          bundleSize: {
            indexSize: indexContent.length,
            bundlePreview: bundleContent.length > 0 ? 'found' : 'missing'
          }
        };

        // Basic validation - if we have bundles, assume libraries are present
        const hasValidBundles = fs.existsSync(assetsDir) && 
          fs.readdirSync(assetsDir).filter(f => f.endsWith('.js')).length > 0;

        if (!hasValidBundles) {
          return new HealthCheckResult(
            'failed',
            'No JavaScript bundles found for library validation',
            libraryChecks
          );
        }

        return new HealthCheckResult(
          'ready',
          'Library validation completed (basic check)',
          libraryChecks
        );
      } catch (error) {
        return new HealthCheckResult(
          'failed',
          `Library check failed: ${error.message}`,
          { error: error.stack }
        );
      }
    });
  }

  /**
   * Run comprehensive health check
   */
  async runComprehensiveCheck() {
    const startTime = Date.now();
    
    try {
      const checks = await Promise.all([
        this.checkStaticAssets(),
        this.checkJavaScriptBundles(), 
        this.checkConfiguration(),
        this.checkLibraries()
      ]);

      const [assets, libraries, config, libValidation] = checks;
      
      const components = {
        assets: assets.status,
        libraries: libraries.status,
        config: config.status,
        validation: libValidation.status
      };

      // Determine overall health
      const failedComponents = Object.entries(components).filter(([_, status]) => status === 'failed');
      const hasFailures = failedComponents.length > 0;
      
      const overallStatus = hasFailures ? 'unhealthy' : 'healthy';
      const httpStatus = hasFailures ? 503 : 200;

      // Collect errors
      const errors = [];
      if (assets.status === 'failed') errors.push(`Assets: ${assets.message}`);
      if (libraries.status === 'failed') errors.push(`Libraries: ${libraries.message}`);
      if (config.status === 'failed') errors.push(`Config: ${config.message}`);
      if (libValidation.status === 'failed') errors.push(`Validation: ${libValidation.message}`);

      const responseTime = Date.now() - startTime;

      return {
        httpStatus,
        response: {
          status: overallStatus,
          timestamp: new Date().toISOString(),
          service: 'polytrade-fe',
          version: process.env.npm_package_version || '1.0.0',
          uptime: process.uptime(),
          responseTime: `${responseTime}ms`,
          components,
          ...(errors.length > 0 && { errors }),
          details: {
            assets: assets.details,
            libraries: libraries.details, 
            config: config.details,
            validation: libValidation.details
          }
        }
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        httpStatus: 503,
        response: {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          service: 'polytrade-fe',
          version: process.env.npm_package_version || '1.0.0',
          uptime: process.uptime(),
          responseTime: `${responseTime}ms`,
          components: {
            assets: 'failed',
            libraries: 'failed',
            config: 'failed',
            validation: 'failed'
          },
          errors: [`Health check system error: ${error.message}`],
          details: {
            error: error.stack
          }
        }
      };
    }
  }

  /**
   * Clear health check cache
   */
  clearCache() {
    this.cache.clear();
  }
}

export { HealthChecker, HealthCheckResult };