# Railway Deployment Fixes

## Issues Identified and Resolved

### Frontend Service Issues

**Problem:**
```
yarn install --immutable
Usage Error: No project found in /app
```

**Root Cause:**
- Railway's Root Directory setting (`./frontend`) isolated the frontend service
- Yarn Workspaces requires access to the monorepo root files:
  - Root `package.json` with workspace configuration
  - `yarn.lock`
  - `.yarnrc.yml`
- When isolated, `yarn install` couldn't find the workspace context

**Solution:**
Updated `frontend/railpack.json` to install from the workspace root:

```json
{
  "steps": {
    "install": {
      "commands": [
        "npm i -g corepack@latest",
        "corepack enable",
        "corepack prepare yarn@4.9.2 --activate",
        "cd .. && yarn install --immutable"  // ← Install from workspace root
      ]
    },
    "build": {
      "commands": [
        "node prebuild.mjs",
        "yarn build"  // ← Build in service directory
      ],
      "inputs": [{"step": "install"}]
    }
  },
  "deploy": {
    "startCommand": "node serve.js"  // ← Deploy from service directory
  }
}
```

### Backend Service Issues

**Problem:**
```
Error: Cannot find module '/app/dist/src/index.js'
```

**Root Cause:**
- Backend build succeeded from monorepo root (detected workspace with 2 packages)
- Deploy command looked for `dist/src/index.js` in `/app` (root)
- Actual build output was in `backend/dist/src/index.js`

**Solution:**
Updated `backend/railpack.json` to use correct paths:

```json
{
  "steps": {
    "build": {
      "commands": [
        "cd backend && node prebuild.mjs",
        "cd backend && rm -rf dist",
        "cd backend && yarn workspace backend run tsc -p tsconfig.build.json",
        "cd backend && rm -rf .shared-build"
      ],
      "inputs": [{"step": "install"}]
    }
  },
  "deploy": {
    "startCommand": "node backend/dist/src/index.js",  // ← Fixed path
    "healthCheckPath": "/api/health"
  }
}
```

## Railway Configuration Requirements

### Service Settings (Railway UI)

| Service | Railway Service ID | Root Directory | Notes |
|---------|-------------------|----------------|-------|
| polytrade-fe | c81963d4-f110-49cf-8dc0-311d1e3dcf7e | `frontend` | Keep this setting |
| polytrade-be | e473a919-acf9-458b-ade3-82119e4fabf6 | Remove or set to `.` | Backend needs root access |

### Critical Settings

1. **Frontend Service:**
   - ✅ Root Directory: `frontend` (or remove it)
   - ✅ Let Railpack handle build commands
   - ✅ Keep environment variables (PORT, VITE_*, etc.)

2. **Backend Service:**
   - ✅ Root Directory: Remove or set to `.` (monorepo root)
   - ✅ Let Railpack handle build commands
   - ✅ Keep environment variables (PORT, NODE_ENV, DATABASE_URL, etc.)

3. **Both Services:**
   - ❌ Remove any Build Command overrides
   - ❌ Remove any Install Command overrides
   - ✅ Ensure environment variables are set

## Architecture Overview

```
poloniex-trading-platform/
├── railpack.json                    # Root coordination file
├── package.json                     # Workspace root with workspaces: ["frontend", "backend"]
├── yarn.lock                        # Shared lockfile
├── .yarnrc.yml                      # Yarn configuration
├── frontend/
│   ├── railpack.json               # Service config (installs from root)
│   ├── package.json                # Frontend workspace package
│   └── serve.js                    # Production server
├── backend/
│   ├── railpack.json               # Service config (builds/deploys with paths)
│   ├── package.json                # Backend workspace package
│   └── dist/src/index.js           # Built entry point
└── python-services/poloniex/
    └── railpack.json               # Python service config
```

## How the Fixes Work

### Yarn Workspaces Context

**Install Phase:**
- Frontend: `cd .. && yarn install --immutable`
  - Changes to parent directory (workspace root)
  - Installs all workspace dependencies
  - Creates `node_modules` in both root and workspaces

**Build Phase:**
- Frontend: Runs from service directory with workspace context
- Backend: Changes to `backend/` and builds there

**Deploy Phase:**
- Frontend: Runs `node serve.js` from service directory
- Backend: Runs `node backend/dist/src/index.js` from root

### Monorepo Path Resolution

Railway's behavior with Root Directory:
- When Root Directory = `frontend`: Working dir is `/app` (the frontend dir)
- When Root Directory is not set: Working dir is `/app` (the monorepo root)

Our fixes handle both scenarios:
- Frontend uses `cd ..` to reach workspace root
- Backend uses `backend/` prefix in deploy command

## Verification Steps

### 1. Check Build Logs

**Frontend Success Indicators:**
```
✓ Successfully prepared Railpack plan
✓ yarn install --immutable (from parent directory)
✓ vite build (frontend build)
✓ No "No project found" errors
```

**Backend Success Indicators:**
```
✓ Successfully prepared Railpack plan
✓ Found workspace with 2 packages
✓ yarn run build
✓ Built in X.XXs
✓ No module not found errors
```

### 2. Check Deploy Logs

**Frontend Success:**
```
✓ Starting Container
✓ Frontend server running on port 5675
✓ Healthcheck passing at /healthz
```

**Backend Success:**
```
✓ Starting Container
✓ Server started on port 8765
✓ Database connected
✓ Healthcheck passing at /api/health
```

### 3. Test Endpoints

```bash
# Frontend
curl https://poloniex-trading-platform-production.up.railway.app/healthz

# Backend
curl https://polytrade-be.up.railway.app/api/health
```

## Rollback Plan

If deployment fails:

1. **Revert railpack.json changes:**
   ```bash
   git revert <commit-hash>
   git push origin claude/fix-railway-deployment-011CUMrShUGE6x7fWFmoiFWn
   ```

2. **Check Railway logs for specific errors**

3. **Verify Railway UI settings match requirements above**

## Additional Notes

### Environment Variables Required

**Frontend:**
- `PORT` (default: 5675)
- `VITE_API_URL`
- `VITE_WS_URL`
- `NODE_ENV=production`

**Backend:**
- `PORT` (default: 8765)
- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGIN`

### Health Check Configuration

Both services have health check endpoints configured:
- Frontend: `/healthz` (300s timeout)
- Backend: `/api/health` (300s timeout)

These ensure services are fully started before Railway marks them as healthy.

## Related Documentation

- [CLAUDE.md](./CLAUDE.md) - Railway + Railpack best practices
- [RAILWAY_SERVICE_CONFIG.md](./RAILWAY_SERVICE_CONFIG.md) - Service configuration details
- [Railway Docs](https://docs.railway.app) - Official Railway documentation
- [Railpack Schema](https://schema.railpack.com) - Railpack configuration schema

## Summary

**Changes Made:**
1. ✅ Frontend: Install from workspace root (`cd .. && yarn install`)
2. ✅ Backend: Fix deploy path (`node backend/dist/src/index.js`)
3. ✅ Both: Proper workspace context for Yarn monorepo

**Expected Outcome:**
- ✅ Frontend builds and deploys successfully
- ✅ Backend builds and deploys successfully
- ✅ Health checks pass
- ✅ Services communicate properly

**Status:** Ready for deployment testing
