# Railway Deployment Master Guide

## Overview

This is the definitive guide for Railway deployment of the Poloniex Trading Platform. All previous Railway documentation has been consolidated here.

## Current Status: ✅ RESOLVED

**Issue**: Railway builds were failing with Yarn Berry configuration conflicts  
**Resolution**: All build issues have been resolved with proper Corepack integration and environment configuration.

---

## Quick Setup Checklist

### 1. Environment Variables (REQUIRED)
Add these to **both** Railway services:

**polytrade-be service:**
- `YARN_ENABLE_STRICT_SETTINGS` = `false`

**polytrade-fe service:**
- `YARN_ENABLE_STRICT_SETTINGS` = `false`

**Steps in Railway Dashboard:**
1. Select service → Variables tab → New Variable
2. Name: `YARN_ENABLE_STRICT_SETTINGS`, Value: `false`
3. Deploy

### 2. Service Configuration
Each service uses its own `railpack.json`:

**Backend** (`backend/railpack.json`):
```json
{
  "$schema": "https://schema.railpack.com",
  "version": "1",
  "metadata": {
    "name": "polytrade-backend"
  },
  "build": {
    "provider": "node",
    "workingDirectory": "..",
    "steps": {
      "install": {
        "commands": ["yarn install --immutable"]
      },
      "build": {
        "commands": ["yarn build:backend"]
      }
    }
  },
  "deploy": {
    "startCommand": "yarn workspace backend start",
    "healthCheckPath": "/api/health",
    "healthCheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**Frontend** (`frontend/railpack.json`):
```json
{
  "$schema": "https://schema.railpack.com",
  "version": "1",
  "metadata": {
    "name": "polytrade-frontend"
  },
  "build": {
    "provider": "node",
    "workingDirectory": "..",
    "steps": {
      "install": {
        "commands": ["yarn install --immutable"]
      },
      "build": {
        "commands": ["yarn build:frontend"]
      }
    }
  },
  "deploy": {
    "startCommand": "yarn workspace frontend start",
    "healthCheckPath": "/",
    "healthCheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

---

## Railway Deployment Master Cheat Sheet

### ✅ DO
1. **Use railpack.json** as primary build configuration
2. **Set workingDirectory: ".."** for monorepo workspaces
3. **Bind to 0.0.0.0** not localhost (in your app code)
4. **Use process.env.PORT** (never hardcode ports)
5. **Add YARN_ENABLE_STRICT_SETTINGS=false** for Yarn Berry compatibility
6. **Include health check endpoints** (`/api/health` for backend, `/` for frontend)
7. **Use immutable installs** (`yarn install --immutable`)

### ❌ DON'T
1. **Don't use Dockerfile** when railpack.json exists (conflicts)
2. **Don't hardcode ports** (use process.env.PORT)
3. **Don't bind to localhost** (use 0.0.0.0)
4. **Don't reference PORT variables** across services (use PUBLIC_DOMAIN)
5. **Don't modify NODE_ENV** (Railway sets this automatically)

---

## Issue Resolution History

### Issue 1: Yarn Binary Missing (RESOLVED)
**Error**: `ENOENT: no such file or directory, stat '/app/.yarn/releases/yarn-4.9.2.cjs'`  
**Fix**: Removed `yarnPath` from `.yarnrc.yml`, use Corepack instead

### Issue 2: Missing yarn.lock (RESOLVED)
**Error**: `YN0028: The lockfile would have been created by this install, which is explicitly forbidden`  
**Fix**: Generated and committed `yarn.lock` file

### Issue 3: Legacy Configuration (RESOLVED)
**Error**: `Unrecognized or legacy configuration settings found: production`  
**Fix**: Added `YARN_ENABLE_STRICT_SETTINGS=false` environment variable

### Issue 4: Monorepo Workspace Configuration (RESOLVED)
**Error**: Services not building from correct workspace  
**Fix**: Updated railpack.json with `workingDirectory: ".."` and workspace commands

---

## Build Process Flow

```
1. Railway detects yarnberry package manager ✅
2. Installs Yarn 4.9.2 with Corepack ✅
3. Copies yarn.lock and project files ✅
4. Runs yarn install --check-cache ✅ (no legacy config errors)
5. Runs yarn install --immutable ✅
6. Runs yarn build:frontend/backend ✅
7. Starts with yarn workspace <service> start ✅
8. Health check passes ✅
```

---

## Troubleshooting

### Build Fails with "Usage Error"
- Check Railway environment variables for `YARN_ENABLE_STRICT_SETTINGS=false`
- Verify no competing build configs (Dockerfile, railway.toml)

### Health Check Fails
- Verify app binds to `0.0.0.0:${PORT}`
- Check health endpoint returns 200 status
- Confirm correct healthCheckPath in railpack.json

### Service Won't Start
- Verify startCommand uses workspace syntax
- Check that the start script exists in package.json
- Ensure all dependencies are properly installed

---

## Configuration Files

### Root Configuration
- ✅ `.yarnrc.yml` - Yarn Berry configuration with Corepack
- ✅ `package.json` - Monorepo workspace definitions
- ✅ `yarn.lock` - Dependency lockfile
- ✅ `railpack.json` - Root service definitions (optional)

### Service-Specific
- ✅ `backend/railpack.json` - Backend build/deploy config
- ✅ `frontend/railpack.json` - Frontend build/deploy config
- ✅ `python-services/poloniex/railpack.json` - ML worker config

---

## Best Practices

1. **Environment Variables**: Set at Railway service level, not in code
2. **Health Checks**: Always implement for production services
3. **Port Binding**: Use Railway's provided PORT, bind to all interfaces
4. **Build Caching**: Use `--immutable` for faster, reproducible builds
5. **Service Isolation**: Each service has its own railpack.json
6. **Monorepo Support**: Use workingDirectory and workspace commands

---

## Contact & Support

For Railway-specific issues:
- Railway Discord: https://discord.gg/railway
- Railway Docs: https://docs.railway.app

For Yarn Berry issues:
- Yarn Discord: https://discord.gg/yarnpkg
- Yarn Docs: https://yarnpkg.com

---

*Last Updated: October 2024*  
*Status: All issues resolved, deployment stable*
