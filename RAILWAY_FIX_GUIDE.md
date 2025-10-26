# Railway Deployment Fix Guide

## Problem Summary

Railway deployments were failing with these errors:
- **ml-worker**: "Could not open requirements file: [Errno 2] No such file or directory: 'requirements.txt'"
- **backend**: "No project found in /app"

## Root Cause

The railpack.json files had commands that assumed they were running from the repository root (`/app`), but when Railway's Root Directory is set to a service subdirectory (e.g., `./backend`), the commands need to be adjusted to work from that context.

## What Was Fixed

### 1. Backend (`backend/railpack.json`)

**Changed:**
- Install command: `cd /app && yarn install` → `cd .. && yarn install`
  - Now correctly goes up one level to find the root package.json with workspace definitions
- Start command: `node dist/src/index.js` → `node dist/index.js`
  - Now runs from the flattened dist directory (after flatten-dist.mjs processes the build output)
- Added: `node scripts/flatten-dist.mjs` to build commands
  - Ensures dist files are properly flattened from dist/src/ to dist/
- Removed: Non-schema fields (healthCheckPath, healthCheckTimeout, restartPolicy)
  - These should be configured in Railway UI, not railpack.json

### 2. Frontend (`frontend/railpack.json`)

**Changed:**
- Install command: `cd /app && yarn install` → `cd .. && yarn install`
  - Consistent with backend approach

### 3. ML Worker (`python-services/poloniex/railpack.json`)

**Changed:**
- Start command: `/app/.venv/bin/python` → `.venv/bin/python`
  - Uses relative path instead of absolute path

## Railway Configuration Requirements

### Required Settings in Railway UI

For **each service**, ensure these settings are configured:

#### Backend Service (polytrade-be)
```
Root Directory: ./backend
Build Command: (empty - let Railpack handle)
Install Command: (empty - let Railpack handle)
Start Command: (empty - let Railpack handle)
Watch Paths: backend/**
```

#### Frontend Service (polytrade-fe)
```
Root Directory: ./frontend
Build Command: (empty - let Railpack handle)
Install Command: (empty - let Railpack handle)
Start Command: (empty - let Railpack handle)
Watch Paths: frontend/**
```

#### ML Worker Service (ml-worker)
```
Root Directory: ./python-services/poloniex
Build Command: (empty - let Railpack handle)
Install Command: (empty - let Railpack handle)
Start Command: (empty - let Railpack handle)
Watch Paths: python-services/poloniex/**
```

### Important Notes

1. **Leave command fields empty**: Railway will use the commands from the service-specific railpack.json files
2. **Root Directory is critical**: Must be set to the service subdirectory
3. **Health checks**: Configure these in Railway UI, not in railpack.json
4. **Workspace dependencies**: The `cd .. && yarn install` commands ensure the entire monorepo workspace is installed

## How It Works

When Railway Root Directory is set to `./backend`:
1. Railway clones the entire repository
2. Sets working directory to `/app/backend` in the container
3. Runs install commands from `backend/railpack.json`
4. The `cd ..` command goes to `/app` (repository root)
5. `yarn install` finds the root package.json with workspace definitions
6. Yarn installs all workspace dependencies
7. Build commands run from `/app/backend`
8. Start command runs from `/app/backend` with correct relative paths

## Verification

After deploying, check the Railway logs for:

### Backend Success Indicators:
```
✅ Successfully prepared Railpack plan
✅ Yarn package manager activated
✅ yarn install completed
✅ TypeScript compilation completed
✅ Flattened dist/src into dist/
✅ Starting: node dist/index.js
```

### Frontend Success Indicators:
```
✅ Successfully prepared Railpack plan
✅ Yarn package manager activated
✅ yarn install completed
✅ Vite build completed
✅ Starting: node serve.js
```

### ML Worker Success Indicators:
```
✅ Successfully prepared Railpack plan
✅ Python environment installed
✅ Created virtual environment
✅ pip install from requirements.txt completed
✅ Starting: uvicorn main:app
```

## Troubleshooting

### Still seeing "No project found in /app"?
- Verify Root Directory is set to `./backend` (not empty, not `/`)
- Clear Railway build cache and redeploy
- Check that root package.json has correct workspaces configuration

### Still seeing "requirements.txt not found"?
- Verify Root Directory is set to `./python-services/poloniex`
- Check that requirements.txt exists in that directory
- Clear Railway build cache and redeploy

### Build commands failing?
- Ensure all command overrides in Railway UI are removed
- Let Railpack handle the build process
- Check Railway logs for specific error messages
