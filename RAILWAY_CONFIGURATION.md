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

**IMPORTANT**: This project uses a monorepo structure with a root `railpack.json` that defines service roots. Railway should automatically detect and use these settings.

### For polytrade-fe Service:

**Critical Settings**:
```
Root Directory: (leave empty or blank - let railpack.json handle it)
Build Command: (leave empty - handled by frontend/railpack.json)
Start Command: (leave empty - handled by frontend/railpack.json)
Install Command: (leave empty - handled by frontend/railpack.json)
Watch Paths: frontend/**
```

**Why**: The root `/railpack.json` defines `"frontend": { "root": "./frontend" }`, which tells Railway that the frontend service root is `./frontend`. Railway will automatically:
1. Run install commands from the monorepo root (`/app`) to install all workspace dependencies
2. Run build commands from the service root (`/app/frontend`)
3. Run the start command from the service root (`/app/frontend`)

**DO NOT** set Root Directory to `/` or `/app` - this will break the Railpack service root configuration.

### For polytrade-be Service:

**Critical Settings**:
```
Root Directory: (leave empty or blank - let railpack.json handle it)
Build Command: (leave empty - handled by backend/railpack.json)
Start Command: (leave empty - handled by backend/railpack.json)
Install Command: (leave empty - handled by backend/railpack.json)
Watch Paths: backend/**
```

**Why**: Same as frontend - the root railpack.json defines the service root as `./backend`.

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

### Frontend Deployment (using frontend/railpack.json):

**Install Step** (runs from /app - monorepo root):
1. `cd /app && npm i -g corepack@latest` - Install corepack globally
2. `cd /app && corepack enable` - Enable corepack
3. `cd /app && corepack prepare yarn@4.9.2 --activate` - Activate Yarn 4.9.2
4. `cd /app && yarn install --frozen-lockfile` - Install all workspace dependencies

**Build Step** (runs from /app/frontend - service root):
1. `node prebuild.mjs` - Copy shared modules
2. `vite build` - Build React app to dist/ folder
3. `rm -rf .shared-build` - Cleanup temporary build files

**Deploy Step** (runs from /app/frontend - service root):
1. `node serve.js` - Start static file server
2. Server validates dist/ folder exists with proper files
3. Server listens on PORT (from Railway) at 0.0.0.0
4. Health check available at /healthz

**Expected Log Output**:
```
============================================================
Frontend Static Server - Startup Validation
============================================================
Working Directory: /app/frontend
Script Location: /app/frontend
Dist Root: /app/frontend/dist
Port: [Railway PORT]
Host: 0.0.0.0
------------------------------------------------------------
✅ Found 50+ asset files in dist/assets/
✅ Validation passed - all required files present
============================================================
🚀 Static server listening on http://0.0.0.0:[PORT]
📁 Serving files from: /app/frontend/dist
🏥 Health check available at: http://0.0.0.0:[PORT]/healthz
============================================================
```

### Backend Deployment (using backend/railpack.json):

**Install Step** (runs from /app - monorepo root):
1. Same as frontend - installs all workspace dependencies

**Build Step** (runs from /app/backend - service root):
1. `node prebuild.mjs` - Copy shared modules
2. `rm -rf dist` - Clean old build
3. `tsc -p tsconfig.build.json` - Compile TypeScript
4. `rm -rf .shared-build` - Cleanup temporary files

**Deploy Step** (runs from /app/backend - service root):
1. `node dist/src/index.js` - Start backend server

## Troubleshooting

### Issue: Blank page in production (UI not loading)

**Symptoms**: 
- Production URL shows a blank white screen
- No errors in browser console, or errors about missing modules
- Health check may or may not be working

**Root Causes & Solutions**:

1. **Build step didn't run or failed**
   - Check Railway build logs for errors during `vite build`
   - Ensure frontend/railpack.json has proper build commands
   - Verify prebuild.mjs can find the shared folder
   
2. **Wrong Root Directory setting in Railway UI**
   - ❌ **INCORRECT**: Setting Root Directory to `/` or `/app`
   - ✅ **CORRECT**: Leave Root Directory empty (blank) so railpack.json handles it
   - The root railpack.json defines `"frontend": { "root": "./frontend" }`
   - Railway should automatically use this and run commands from the correct directories
   
3. **Missing dist folder**
   - The serve.js requires a `dist` folder with built files
   - If build didn't complete, dist won't exist
   - Check the build logs for "vite build" completion
   - Look for "✓ built in X.XXs" message in logs
   
4. **Start command running from wrong directory**
   - If Root Directory is misconfigured, `node serve.js` won't find the script
   - Ensure Railway uses the railpack.json start command
   - Don't override the start command in Railway UI settings

5. **Missing environment variables**
   - Check that required VITE_ prefixed variables are set in Railway
   - Minimum required: `NODE_ENV=production`
   - Optional but recommended: `VITE_BACKEND_URL`, `VITE_API_URL`

**Quick Fix**:
1. In Railway UI, go to polytrade-fe service settings
2. Ensure Root Directory field is **completely empty** (not `/`, not `./`, just blank)
3. Ensure Build Command field is **empty** (let railpack.json handle it)
4. Ensure Install Command field is **empty** (let railpack.json handle it)
5. Ensure Start Command field is **empty** (let railpack.json handle it)
6. Set Watch Paths to `frontend/**`
7. Trigger a new deployment

### Issue: "yarn not found"
**Solution**: The frontend/railpack.json install commands should handle this automatically:
```bash
npm i -g corepack@latest && corepack enable && corepack prepare yarn@4.9.2 --activate
```
If still getting this error, Railway may not be using the railpack.json install commands.

### Issue: Build timeout (4h 36m)
**Solution**: Ensure `.dockerignore` file exists in project root with proper exclusions to avoid uploading massive files.

### Issue: Workspace not found
**Solution**: Verify:
- Root directory is **empty/blank** in Railway service settings (not `/`)
- `package.json` has correct workspaces: `["frontend", "backend"]`
- `packageManager: "yarn@4.9.2"` is set in root package.json

### Issue: "Build output not found" error message
**Solution**: This error from serve.js means the `dist` folder is missing:
1. Check if `vite build` ran in the Railway logs
2. Verify the build step in frontend/railpack.json
3. Ensure build didn't fail due to TypeScript errors or missing dependencies
4. The enhanced serve.js now provides detailed validation messages at startup

### Issue: Schema violations
**Solution**: Use simplified format - the current railpack.json files use the correct format with `"provider": "node"` and proper steps structure.

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
