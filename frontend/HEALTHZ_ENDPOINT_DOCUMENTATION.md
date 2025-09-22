# Enhanced /healthz Endpoint Documentation

## Overview

The polytrade-fe `/healthz` endpoint has been enhanced to provide comprehensive health monitoring with strict HTTP status code validation, detailed component checks, and optimized performance.

## Endpoint URLs

- `/healthz` - Primary health check endpoint
- `/api/health` - Alternative health check endpoint (same functionality)

## HTTP Status Codes

### 200 OK - Healthy
- All static assets are accessible
- JavaScript bundles are present and valid
- Configuration files are accessible and valid
- All critical components are ready

### 503 Service Unavailable - Unhealthy
- One or more critical assets are missing
- JavaScript bundles are missing or invalid
- Configuration is inaccessible or corrupt
- Any critical component has failed validation

## Response Format

### Healthy Response (200)
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "polytrade-fe",
  "version": "1.0.0",
  "uptime": 123.456,
  "responseTime": "5ms",
  "components": {
    "assets": "ready",
    "libraries": "ready", 
    "config": "ready",
    "validation": "ready"
  },
  "details": {
    "assets": {
      "index.html": {
        "exists": true,
        "size": 3342,
        "modified": "2024-01-01T00:00:00.000Z"
      },
      "manifest.json": {
        "exists": true,
        "size": 1972,
        "modified": "2024-01-01T00:00:00.000Z"
      },
      "assets/js": {
        "count": 25,
        "files": ["index-ABC123.js", "vendor-DEF456.js", "..."]
      }
    },
    "libraries": {
      "foundBundles": {
        "index": {
          "file": "index-ABC123.js",
          "size": 102315,
          "sizeKB": 100
        },
        "vendor": {
          "file": "vendor-DEF456.js", 
          "size": 256285,
          "sizeKB": 250
        }
      },
      "totalJsFiles": 25
    },
    "config": {
      "indexHtml": {
        "hasViewport": true,
        "hasTitle": true,
        "hasScripts": true,
        "hasManifest": true
      },
      "manifest": {
        "valid": true,
        "hasName": true,
        "hasIcons": true,
        "hasStartUrl": true
      },
      "environment": {
        "nodeEnv": "production",
        "port": "5675",
        "hasVersion": false
      }
    },
    "validation": {
      "react": {
        "inBundle": true,
        "status": "ready"
      },
      "bundleSize": {
        "indexSize": 3342,
        "bundlePreview": "found"
      }
    }
  }
}
```

### Unhealthy Response (503)
```json
{
  "status": "unhealthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "polytrade-fe",
  "version": "1.0.0",
  "uptime": 123.456,
  "responseTime": "3ms",
  "components": {
    "assets": "failed",
    "libraries": "ready",
    "config": "warning", 
    "validation": "failed"
  },
  "errors": [
    "Assets: Missing critical assets: index.html, manifest.json",
    "Validation: Cannot validate libraries: index.html not found"
  ],
  "details": {
    "assets": {
      "missingAssets": ["index.html", "manifest.json"],
      "assetDetails": {
        "index.html": {
          "exists": false,
          "error": "ENOENT: no such file or directory"
        }
      }
    }
  }
}
```

## Component Status Values

- **ready** - Component is fully functional
- **warning** - Component has non-critical issues 
- **failed** - Component has critical failures

## Health Check Components

### 1. Static Assets (`assets`)
Validates presence and accessibility of critical files:
- `index.html` - Main application entry point
- `manifest.json` - PWA manifest file
- `sw.js` - Service worker file
- `icon-192.png` - Application icon
- `favicon.ico` - Browser favicon
- `assets/` directory - JavaScript and CSS bundles

### 2. JavaScript Libraries (`libraries`)
Validates JavaScript bundle integrity:
- Checks for presence of bundle files
- Validates critical bundles (index, vendor)
- Reports bundle sizes and counts
- Ensures build process completed successfully

### 3. Configuration (`config`)
Validates configuration accessibility:
- `index.html` structure and meta tags
- `manifest.json` validity and content
- Environment variable configuration
- Critical configuration presence

### 4. Library Validation (`validation`)
Basic validation of library functionality:
- Bundle content analysis
- Library signature detection
- Runtime validation readiness

## Performance Requirements

- **Response time**: < 100ms (cached results)
- **Caching**: 10-second cache for performance optimization
- **Headers**: Includes no-cache directives to prevent stale health data

## Error Handling and Logging

### Health Check Failures
Failed health checks are logged to the console with structured data:
```javascript
console.error('[HEALTH CHECK FAILED]', {
  timestamp: '2024-01-01T00:00:00.000Z',
  status: 503,
  errors: ['Assets: Missing critical assets: index.html'],
  components: { assets: 'failed', libraries: 'ready' }
});
```

### System Errors
Health check system errors are logged and handled gracefully:
```javascript
console.error('[HEALTH CHECK ERROR]', {
  timestamp: '2024-01-01T00:00:00.000Z',
  error: 'Health check system error message',
  stack: 'Error stack trace...'
});
```

## Usage Examples

### Basic Health Check
```bash
curl http://localhost:5675/healthz
```

### Health Check with Status Code
```bash
curl -w "HTTP Status: %{http_code}\n" http://localhost:5675/healthz
```

### Monitoring Script
```bash
#!/bin/bash
response=$(curl -s -w "%{http_code}" http://localhost:5675/healthz)
status_code=${response: -3}
if [ "$status_code" != "200" ]; then
  echo "Health check failed: $status_code"
  exit 1
fi
echo "Health check passed"
```

## Load Balancer Configuration

### NGINX Example
```nginx
upstream polytrade_frontend {
    server 127.0.0.1:5675;
}

location /healthz {
    proxy_pass http://polytrade_frontend;
    proxy_set_header Host $host;
    access_log off;
}
```

### Kubernetes Health Checks
```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 5675
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /healthz
    port: 5675
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 2
```

## Testing

### Manual Testing
Run the included validation script:
```bash
node test-health-endpoint.js
```

### Automated Testing
```bash
yarn test healthz-endpoint.test.js
```

### Validation Checklist

- [x] Returns 200 for healthy state
- [x] Returns 503 for unhealthy state  
- [x] All static assets validated
- [x] JavaScript libraries verified
- [x] Configuration accessibility confirmed
- [x] Detailed response body with component status
- [x] Proper error logging implemented
- [x] Response time < 100ms
- [x] Both `/healthz` and `/api/health` endpoints work
- [x] Proper HTTP headers (no-cache)
- [x] Graceful error handling
- [x] Performance caching implemented

## Security Considerations

- Health endpoint does not expose sensitive information
- No authentication required (public health status)
- Error messages do not reveal internal system details
- Caching prevents excessive file system access

## Troubleshooting

### Common Issues

1. **503 Response**: Check that `yarn build` was run and `dist/` folder exists
2. **Performance Issues**: Verify caching is working, check file system performance
3. **Missing Assets**: Ensure all public assets are copied during build process
4. **Invalid JSON**: Check that `manifest.json` is valid JSON format

### Debug Mode
Set `NODE_ENV=development` for additional debug logging and detailed error messages.