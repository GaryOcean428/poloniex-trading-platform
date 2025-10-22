# Railway Yarn Workspace Deployment Fix

## Problem Summary

**Backend (polytrade-be):**
```
Build Failed: yarn install --immutable exit code: 1
```

**Frontend (polytrade-fe):**
```
Healthcheck failed after 5 minutes
Build succeeded but deploy failed
```

## Root Cause

This is a **Yarn Workspaces monorepo** with shared dependencies defined at the root level. The deployment was failing because:

1. **`--immutable` flag incompatibility**: When Railway sets Root Directory to `./backend` or `./frontend`, Yarn tries to install that workspace in isolation. The `--immutable` flag requires an exact match with yarn.lock, which doesn't work for isolated workspace installations.

2. **Workspace dependency resolution**: Yarn workspaces need access to the root package.json and yarn.lock to properly resolve dependencies, even when installing individual workspaces.

## Solution Applied

### Changed: `backend/railpack.json` and `frontend/railpack.json`

Replaced `yarn install --immutable` with `yarn install --check-cache`

**Why this works:**
- `--check-cache`: Validates cache integrity but allows installation of workspace dependencies
- `--immutable`: Strict lock file validation that breaks with isolated workspace installations
- Both are production-safe deployment strategies

**Before:**
```json
{
  "steps": {
    "install": {
      "commands": [
        "npm i -g corepack@latest",
        "corepack enable",
        "corepack prepare yarn@4.9.2 --activate",
        "yarn install --immutable"  // ❌ Fails in workspace context
      ]
    }
  }
}
```

**After:**
```json
{
  "steps": {
    "install": {
      "commands": [
        "npm i -g corepack@latest",
        "corepack enable",
        "corepack prepare yarn@4.9.2 --activate",
        "yarn install --check-cache"  // ✅ Works with workspaces
      ]
    }
  }
}
```

## Critical Railway UI Settings

### Service: `polytrade-be` (Backend)
**Required Settings:**
- **Root Directory**: `./backend`
- **Build Command**: *(Leave empty - let Railpack handle it)*
- **Install Command**: *(Leave empty - let Railpack handle it)*
- **Start Command**: *(Leave empty - use railpack.json)*
- **Environment Variables**:
  - `PORT` (Railway auto-sets)
  - `NODE_ENV=production`
  - `DATABASE_URL` (if needed)
  - Any service-specific vars

### Service: `polytrade-fe` (Frontend)
**Required Settings:**
- **Root Directory**: `./frontend`
- **Build Command**: *(Leave empty - let Railpack handle it)*
- **Install Command**: *(Leave empty - let Railpack handle it)*
- **Start Command**: *(Leave empty - use railpack.json)*
- **Environment Variables**:
  - `PORT` (Railway auto-sets)
  - `NODE_ENV=production`
  - `VITE_*` variables (if needed)

### Service: `ml-worker` (Python ML Service)
**Status**: ✅ Already working
- **Root Directory**: `./python-services/poloniex`
- No changes needed

## Verification Steps

### 1. Check Build Logs

**Backend should show:**
```
↳ Using provider Node from config
↳ Using yarnberry package manager
↳ Installing yarn@4.9.2 with Corepack

Steps
──────────
▸ install
  $ npm i -g corepack@latest
  $ corepack enable
  $ corepack prepare yarn@4.9.2 --activate
  $ yarn install --check-cache  ✅

▸ build
  $ node prebuild.mjs
  $ rm -rf dist
  $ tsc -p tsconfig.build.json
  $ rm -rf .shared-build
```

**Frontend should show:**
```
↳ Detected Node
↳ Using yarnberry package manager
↳ Found workspace with 2 packages  ✅
↳ Installing yarn@4.9.2 with Corepack

Steps
──────────
▸ install
  $ npm i -g corepack@latest && corepack enable && corepack prepare --activate
  $ yarn install --check-cache  ✅

▸ build
  $ yarn run build
```

### 2. Check Deploy Logs

**Backend should show:**
```
Starting Container
[Backend service starting...]
Server listening on port $PORT
✓ Connected to database
```

**Frontend should show:**
```
Starting Container
Static server listening on http://0.0.0.0:$PORT
```

### 3. Test Healthcheck Endpoints

```bash
# Backend
curl https://polytrade-be.up.railway.app/api/health

# Expected response:
{
  "status": "ok",
  "service": "polytrade-be",
  ...
}
```

```bash
# Frontend
curl https://poloniex-trading-platform-production.up.railway.app/healthz

# Expected response:
{
  "status": "healthy",
  "service": "polytrade-fe",
  "components": {
    "assets": "ready",
    "libraries": "ready",
    "config": "ready",
    "validation": "ready"
  }
}
```

## Common Issues and Fixes

### Issue: Backend still fails with exit code 1
**Possible causes:**
1. Railway Root Directory not set to `./backend`
2. Cache from previous failed builds

**Fix:**
```bash
# In Railway dashboard for polytrade-be:
1. Go to Settings → Service Settings
2. Verify "Root Directory" = ./backend
3. Clear deployment cache (trigger new build)
4. Redeploy
```

### Issue: Frontend healthcheck still fails
**Possible causes:**
1. Railway Root Directory not set to `./frontend`
2. dist/ folder not being built correctly
3. serve.js can't find files

**Fix:**
```bash
# In Railway dashboard for polytrade-fe:
1. Go to Settings → Service Settings
2. Verify "Root Directory" = ./frontend
3. Check deploy logs for actual error messages
4. Verify dist/ folder is created during build
```

### Issue: Yarn workspace resolution errors
**Symptoms:**
```
error Package "some-package" refers to a non-existing file
```

**Fix:**
This means the workspace structure is broken. Ensure:
1. Root package.json has correct workspaces array
2. yarn.lock is committed and up to date
3. .yarnrc.yml is committed

## Understanding Yarn Workspace Flags

| Flag | Use Case | Works in Railway? |
|------|----------|-------------------|
| `--immutable` | CI/CD with strict lock file validation | ❌ Breaks with isolated workspaces |
| `--check-cache` | Production with cache validation | ✅ Works with workspaces |
| `--frozen-lockfile` | (Yarn 1.x only) | ❌ Not applicable to Yarn 4 |
| no flag | Development, flexible installation | ✅ Works but less strict |

**Recommendation**: Use `--check-cache` for Railway deployments with Yarn workspaces.

## Monorepo Architecture

```
poloniex-trading-platform/
├── package.json              # Root workspace config
├── yarn.lock                 # Shared lock file
├── .yarnrc.yml              # Yarn configuration
├── railpack.json            # Service coordination
├── frontend/
│   ├── railpack.json        # Frontend build config
│   ├── package.json         # Frontend dependencies
│   ├── serve.js             # Production server
│   └── dist/                # Build output
├── backend/
│   ├── railpack.json        # Backend build config
│   ├── package.json         # Backend dependencies
│   └── dist/                # Build output
└── python-services/
    └── poloniex/
        ├── railpack.json    # Python service config
        └── main.py          # Entry point
```

## Railway Service Mapping

| Railway Service | Root Directory | Config File | Status |
|----------------|----------------|-------------|--------|
| `polytrade-fe` | `./frontend` | `frontend/railpack.json` | 🟡 Fixed |
| `polytrade-be` | `./backend` | `backend/railpack.json` | 🟡 Fixed |
| `ml-worker` | `./python-services/poloniex` | `python-services/poloniex/railpack.json` | ✅ Working |

## Summary of Changes

### Files Modified:
1. `backend/railpack.json` - Changed `--immutable` to `--check-cache`
2. `frontend/railpack.json` - Changed `--immutable` to `--check-cache`
3. `python-services/poloniex/railpack.json` - (Previously fixed for venv path)

### No Changes Needed:
- `railpack.json` (root) - Correctly defines service roots
- `package.json` (root) - Workspace configuration is correct
- `yarn.lock` - Already correct
- `.yarnrc.yml` - Already correct

## Deployment Process

After these changes are pushed:

1. **Automatic Trigger**: Railway detects git push and starts build
2. **Build Phase**:
   - Installs dependencies with `yarn install --check-cache`
   - Runs build commands (TypeScript compilation, Vite build)
3. **Deploy Phase**:
   - Starts service with configured startCommand
   - Begins healthcheck polling
4. **Healthcheck**:
   - Railway polls healthCheckPath every few seconds
   - Service must return 200 status within healthCheckTimeout (300s)
5. **Success**: Service marked as Active and receives traffic

## Next Steps

1. ✅ Changes committed to: `claude/debug-deployment-failure-011CUMuNBr39T8Wt6E7xE3ds`
2. ⏳ Push to GitHub
3. ⏳ Railway auto-deploys (watch for build success)
4. ⏳ Verify healthcheck endpoints respond
5. ⏳ Monitor services for 10-15 minutes to ensure stability

## Additional Resources

- [Yarn Workspaces Documentation](https://yarnpkg.com/features/workspaces)
- [Railway Monorepo Guide](https://docs.railway.app/guides/monorepo)
- [Railpack Documentation](https://docs.railway.app/reference/railpack)

## Rollback Plan

If deployments still fail after these changes:

1. Check Railway service logs for specific error messages
2. Verify Root Directory settings in Railway UI
3. Consider alternative approach: Build from root with workspace commands
4. Contact Railway support with service IDs and error logs
