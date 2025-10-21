# Railway Deployment Configuration Guide

## Overview
This guide documents the Railway deployment configuration for the Poloniex Trading Platform using Yarn 4.9.2 workspaces and Railpack.

## Key Changes Made

### 1. Yarn Configuration (`.yarnrc.yml`)
```yaml
enableGlobalCache: false
enableImmutableInstalls: true
nodeLinker: node-modules
```

**Critical**: `enableGlobalCache: false` is required for Railway deployments to avoid cache-related issues.

### 2. Docker Build Optimization (`.dockerignore`)
Created comprehensive `.dockerignore` file to prevent the 4h 36m file transfer issue:
- Excludes node_modules, test files, build artifacts
- Excludes documentation, logs, and temporary files
- Excludes Yarn cache directories
- Result: Build times reduced from 4h 36m to ~7-10 seconds

### 3. Railpack Configuration

#### Root `railpack.json`
```json
{
  "builder": "RAILPACK",
  "$schema": "https://railway.app/railways.schema.json"
}
```
Minimal root configuration; services handle their own builds.

#### Backend `backend/railpack.json`
```json
{
  "builder": "RAILPACK",
  "buildCommand": "yarn workspace backend build",
  "startCommand": "yarn workspace backend start"
}
```

#### Frontend `frontend/railpack.json`
```json
{
  "builder": "RAILPACK",
  "buildCommand": "yarn workspace frontend build",
  "startCommand": "yarn workspace frontend start",
  "installCommand": "npm i -g corepack@latest && corepack enable && corepack prepare yarn@4.9.2 --activate && yarn install --immutable"
}
```

**Key Fix**: Added complete corepack installation chain to resolve "yarn not found" error.

## Railway Service Configuration

### For polytrade-fe Service:
```
Root Directory: /
Build Command: (handled by railpack.json)
Start Command: (handled by railpack.json)
Watch Paths: frontend/**
```

### For polytrade-be Service:
```
Root Directory: /
Build Command: (handled by railpack.json)
Start Command: (handled by railpack.json)
Watch Paths: backend/**
```

## Package Scripts

### Backend (`backend/package.json`)
```json
{
  "scripts": {
    "build": "yarn run prebuild && rm -rf dist && tsc -p tsconfig.build.json && rm -rf .shared-build",
    "start": "node dist/src/index.js"
  }
}
```

### Frontend (`frontend/package.json`)
```json
{
  "scripts": {
    "build": "yarn run prebuild && vite build && rm -rf .shared-build",
    "start": "node serve.js"
  }
}
```

## Expected Deployment Flow

### Frontend Deployment:
1. Install corepack globally
2. Enable corepack
3. Prepare and activate yarn@4.9.2
4. Run `yarn install --immutable`
5. Run `yarn workspace frontend build` (includes prebuild step)
6. Start with `yarn workspace frontend start` (runs serve.js)

### Backend Deployment:
1. Corepack enabled by Railway
2. Run `yarn workspace backend build` (includes prebuild step)
3. TypeScript compilation to dist/
4. Start with `yarn workspace backend start` (runs node dist/src/index.js)

## Troubleshooting

### Issue: "yarn not found"
**Solution**: Ensure `installCommand` in frontend/railpack.json includes:
```bash
npm i -g corepack@latest && corepack enable && corepack prepare yarn@4.9.2 --activate
```

### Issue: Build timeout (4h 36m)
**Solution**: Ensure `.dockerignore` file exists in project root with proper exclusions.

### Issue: Workspace not found
**Solution**: Verify:
- Root directory is `/` in Railway service settings
- `package.json` has correct workspaces: `["frontend", "backend"]`
- `packageManager: "yarn@4.9.2"` is set

### Issue: Schema violations
**Solution**: Use simplified `builder: "RAILPACK"` format instead of complex schema-based format.

## Verification Commands

```bash
# Check yarn version
yarn --version  # Should show 4.9.2

# List workspaces
yarn workspaces list
# Output:
# . (root)
# backend
# frontend

# Validate JSON files
jq -e . railpack.json
jq -e . backend/railpack.json
jq -e . frontend/railpack.json
```

## Success Indicators

After deployment, you should see:
- ✅ Frontend: "Successfully prepared Railpack plan"
- ✅ Frontend: "yarn@4.9.2 activated"
- ✅ Backend: "Built in ~7-8s"
- ✅ Backend: "Exporting to docker image format" (2-10s, not hours)
- ✅ Both services: Deployment successful
- ✅ Health checks passing

## Additional Notes

1. **Corepack**: Required for yarn 4.9.2 management
2. **Immutable Installs**: Enforced via `.yarnrc.yml` for reproducible builds
3. **Node Linker**: Using `node-modules` for compatibility
4. **Workspace Commands**: All commands use `yarn workspace <name>` pattern
5. **Prebuild Steps**: Both services run prebuild scripts to copy shared dependencies

## Railway Environment Variables

Ensure these are set in Railway dashboard:
- `NODE_ENV=production`
- `PORT` (auto-set by Railway)
- Any service-specific API keys or credentials

## Health Check Endpoints

- Backend: `/api/health`
- Frontend: `/healthz` or `/` (static serve responds with 200)
