# Railway Backend Deployment Fix - Implementation Guide

## Overview

This document describes the fixes implemented to resolve the `polytrade-be` Railway service deployment timeout issues.

## Issues Fixed

### 1. ✅ Build Scope Isolation (CRITICAL)
**Problem**: Backend service was building entire monorepo including frontend, causing 30+ minute builds and timeouts.

**Root Cause**: `workingDirectory: ".."` in `backend/railpack.json` built from monorepo root.

**Solution**:
- Changed `workingDirectory` to `"."` (backend folder)
- Updated build commands to explicitly navigate to root only when needed
- Modified `scripts/bundle-shared.mjs` to accept service-specific argument
- Build commands now only process backend workspace

**Files Modified**:
- `backend/railpack.json`
- `scripts/bundle-shared.mjs`

### 2. ✅ Node.js Version Update (HIGH)
**Problem**: Node.js 22.11.0 < required 22.12+ for Vite 7 compatibility.

**Solution**:
- Updated `.nvmrc` from `22.11.0` to `22.12.0`

**Files Modified**:
- `.nvmrc`

### 3. ⚠️ Environment Variable Cleanup (MANUAL ACTION REQUIRED)

**Problem**: Conflicting environment variables override Railpack configuration.

**Manual Steps Required in Railway Dashboard**:

#### For `polytrade-be` service (ID: e473a919-acf9-458b-ade3-82119e4fabf6):

1. **Remove BUILD_COMMAND variable** (if present):
   - Navigate to: Service Settings → Variables
   - Delete: `BUILD_COMMAND` 
   - Reason: Railpack configuration should handle build commands

2. **Remove RAILWAY_NO_CACHE variable** (if present):
   - Navigate to: Service Settings → Variables
   - Delete: `RAILWAY_NO_CACHE`
   - Reason: Disabling cache increases build times unnecessarily

3. **Verify Root Directory Setting**:
   - Navigate to: Service Settings → Root Directory
   - Should be set to: `backend` (NOT root, NOT empty)
   - This ensures Railway builds only the backend service

4. **Review Redis Configuration** (optional):
   - If Redis is used, ensure these are set:
     - `REDIS_URL='${{Redis-Stack.REDIS_URL}}'`
     - `REDIS_PASSWORD='${{Redis-Stack.REDIS_PASSWORD}}'`
   - If Redis is NOT used, delete these variables:
     - `REDIS_URL`
     - `REDIS_PASSWORD`
     - `REDIS_PRIVATE_DOMAIN`

## Backend railpack.json Changes Explained

### Before (Problematic):
```json
{
  "build": {
    "provider": "node",
    "workingDirectory": "..",  // ❌ Builds from monorepo root
    "steps": {
      "build": {
        "commands": [
          "yarn bundle:shared",  // ❌ Bundles for ALL services
          "yarn workspace backend build:railway"
        ]
      }
    }
  },
  "deploy": {
    "startCommand": "yarn workspace backend start"  // ❌ Assumes root context
  }
}
```

**Problems**:
- Builds entire monorepo including frontend (Vite compilation visible in logs)
- Shared bundling runs for frontend AND backend
- Large Docker context causes export timeouts

### After (Fixed):
```json
{
  "build": {
    "provider": "node",
    "workingDirectory": ".",  // ✅ Builds from backend folder
    "steps": {
      "install": {
        "commands": [
          "cd ..",  // ✅ Navigate to root for install
          "corepack enable",
          "yarn install --immutable"
        ]
      },
      "build": {
        "commands": [
          "cd ..",  // ✅ Navigate to root for build
          "node scripts/bundle-shared.mjs backend",  // ✅ Only bundle for backend
          "yarn workspace backend build:railway"
        ]
      }
    }
  },
  "deploy": {
    "startCommand": "cd .. && yarn workspace backend start"  // ✅ Explicit path handling
  }
}
```

**Benefits**:
- Only backend code processed during build
- Shared bundling runs once for backend only
- Smaller Docker context → faster exports
- Expected build time: ~10-15 minutes (previously 30+ min)

## Verification Checklist

After deployment, verify these indicators:

### ✅ Success Indicators:
- [ ] Build completes in < 15 minutes
- [ ] No frontend/Vite output in build logs
- [ ] Log shows: `"Bundling shared modules into backend..."` (once only)
- [ ] No Node.js version warnings
- [ ] Deployment status: `ACTIVE`
- [ ] Health check passes: `/api/health` returns 200
- [ ] Logs show: `"using cached layer"` on subsequent builds

### ❌ Failure Indicators (Should NOT appear):
- [ ] Build timeout after 30+ minutes
- [ ] Vite compilation output during backend build
- [ ] `"context canceled"` errors
- [ ] Node.js version warnings

## Testing the Fixes Locally

### 1. Test Shared Module Bundling:
```bash
# Bundle only for backend
node scripts/bundle-shared.mjs backend

# Verify only backend has shared modules
ls -la backend/src/shared/
# Should show shared module files

# Verify frontend wasn't affected
ls -la frontend/src/shared/
# Should show existing shared modules (unchanged)
```

### 2. Test Backend Build:
```bash
# From repository root
cd backend

# Simulate Railway build process
cd ..
corepack enable
yarn install --immutable
node scripts/bundle-shared.mjs backend
yarn workspace backend build:railway

# Verify build output
ls -la backend/dist/
# Should show compiled JavaScript files
```

### 3. Test Backend Start:
```bash
# From repository root
cd .. && yarn workspace backend start

# Should start without errors
# Check health endpoint (in another terminal):
curl http://localhost:$PORT/api/health
# Should return: {"status":"ok"}
```

## Expected Build Log Output (After Fix)

```
[build] ==> Building backend service
[build] Bundling shared modules into backend...
[build] ✓ Bundled shared modules for backend
[build] yarn workspace v4.9.2
[build] yarn run v4.9.2
[build] $ yarn run prebuild && rm -rf dist && tsc -p tsconfig.build.json...
[build] ✓ Backend build completed (604KB)
[build] ==> Exporting image...
[build] ==> Build completed successfully in 12m 34s
```

**Key differences from problematic logs**:
- ❌ NO: `"Bundling shared modules into frontend..."`
- ❌ NO: `"vite v7.1.7 building for production..."`
- ❌ NO: `"✓ 2840 modules transformed"`
- ✅ YES: Single backend bundling only
- ✅ YES: Build completes in < 15 minutes

## Rollback Plan (If Needed)

If deployment fails with these changes:

### 1. Quick Rollback via Git:
```bash
# Revert to previous commit
git revert HEAD
git push origin main
```

### 2. Manual Railway Configuration Rollback:
- Restore `BUILD_COMMAND` if it was previously set
- Restore `RAILWAY_NO_CACHE` if it was previously set
- Verify Root Directory is still set to `backend`

### 3. Contact Railway Support:
If issues persist, provide these details:
- Service ID: `e473a919-acf9-458b-ade3-82119e4fabf6`
- Deployment logs (last 500 lines)
- This document as reference

## Long-Term Monitoring

### Track These Metrics:
1. **Build Duration**: Should remain < 15 minutes
2. **Build Cache Usage**: Should show "using cached layer" logs
3. **Deployment Success Rate**: Should be > 95%
4. **Health Check Status**: Should always pass

### Set Up Alerts:
- Build duration > 20 minutes
- Deployment failures > 2 consecutive
- Health check failures

## Related Documentation

- [Railway Deployment Master Guide](../RAILWAY_DEPLOYMENT_MASTER.md)
- [Railway Service Configuration](./RAILWAY_SERVICE_CONFIG.md)
- [Railway Deployment Solution](./RAILWAY_DEPLOYMENT_SOLUTION.md)

## Support

If you encounter issues:
1. Check Railway deployment logs
2. Verify manual configuration steps completed
3. Review verification checklist above
4. Contact Railway support with service ID

---

**Last Updated**: January 2025  
**Status**: ✅ IMPLEMENTED - Ready for Deployment
