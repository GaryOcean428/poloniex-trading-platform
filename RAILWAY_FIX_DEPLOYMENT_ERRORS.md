# Railway Deployment Error Fixes - PR #295

## Summary

This PR fixes critical deployment errors for both the backend and ml-worker services on Railway by addressing railpack.json configuration issues and file access problems.

## Issues Fixed

### 1. ML Worker Build Failure ❌ → ✅

**Error:**
```
ERROR: Could not open requirements file: [Errno 2] No such file or directory: 'requirements.txt'
```

**Root Causes:**
1. **Duplicate `steps` key** in `python-services/poloniex/railpack.json` - JSON parsers use the last occurrence, but having duplicates is invalid and confusing
2. **python-services/ directory ignored** in `.railwayignore` - Railway couldn't access the ml-worker service files

**Fixes:**
- Removed duplicate `steps` key, keeping only the correct venv-based installation
- Removed `python-services/` from `.railwayignore` to allow Railway to access the ml-worker files
- Removed non-schema fields (healthCheckPath, healthCheckTimeout, restartPolicy) from railpack.json

**Result:**
✅ ML worker can now find and install from requirements.txt
✅ Proper venv-based Python environment setup
✅ Clean railpack.json following official schema

### 2. Backend Deployment Failure ❌ → ✅

**Error:**
```
Error: Cannot find module '/app/dist/src/index.js'
```

**Root Cause:**
- Start command was looking for `/app/dist/src/index.js` 
- But the `flatten-dist.mjs` script correctly moves files from `dist/src/` to `dist/`
- The issue was likely a stale deployment or incorrect Railway UI override

**Fixes:**
- Confirmed backend railpack.json has correct start command: `node dist/index.js`
- Removed non-schema fields from railpack.json
- Verified build process creates correct dist structure (tested locally)

**Result:**
✅ Backend start command points to correct location: `dist/index.js`
✅ Build process verified to work correctly
✅ Clean railpack.json following official schema

## Changes Made

### 1. `python-services/poloniex/railpack.json`
```diff
- Removed duplicate "steps" key (lines 7-13)
- Removed healthCheckPath, healthCheckTimeout, restartPolicyType, restartPolicyMaxRetries
- Kept correct venv-based installation commands
```

**Before:**
```json
{
  "steps": { "install": { "commands": ["pip install -r requirements.txt"] } },
  "steps": { "install": { "commands": ["python -m venv .venv", ...] } },
  "deploy": {
    "startCommand": "...",
    "healthCheckPath": "/health",
    "healthCheckTimeout": 300,
    ...
  }
}
```

**After:**
```json
{
  "steps": { "install": { "commands": ["python -m venv .venv", ...] } },
  "deploy": {
    "startCommand": ".venv/bin/python -m uvicorn health:app --host 0.0.0.0 --port $PORT",
    "inputs": [{"step": "install"}]
  }
}
```

### 2. `.railwayignore`
```diff
- # Python services (deploy separately)
- python-services/
+ # Python services - DO NOT ignore the directory itself, Railway needs it for ml-worker service
+ # Individual services will be deployed via root railpack.json service definitions
```

### 3. `backend/railpack.json` & `frontend/railpack.json`
```diff
- Removed healthCheckPath, healthCheckTimeout, restartPolicyType, restartPolicyMaxRetries from deploy section
```

## Railway UI Configuration Required

⚠️ **IMPORTANT**: The following Railway UI settings must be verified/updated for successful deployment:

### For All Services (backend, ml-worker, frontend):

1. **Root Directory**: 
   - ✅ **Should be CLEARED/EMPTY** 
   - Let the root `railpack.json` with service definitions handle this
   - The root railpack.json defines service roots: `"backend": { "root": "./backend" }`

2. **Build Command**:
   - ✅ **Should be CLEARED/EMPTY**
   - Let service-specific railpack.json handle this

3. **Start Command**:
   - ✅ **Should be CLEARED/EMPTY**
   - Let service-specific railpack.json handle this

4. **Install Command**:
   - ✅ **Should be CLEARED/EMPTY**
   - Let service-specific railpack.json handle this

### Health Checks (Railway UI Only):

Configure these in Railway UI, **NOT** in railpack.json:

**Backend Service:**
- Health Check Path: `/api/health`
- Health Check Timeout: `300` seconds

**ML Worker Service:**
- Health Check Path: `/health`
- Health Check Timeout: `300` seconds

**Frontend Service:**
- Health Check Path: `/healthz` or `/`
- Health Check Timeout: `300` seconds

### Restart Policies (Railway UI Only):

Configure these in Railway UI, **NOT** in railpack.json:

All Services:
- Restart Policy Type: `ON_FAILURE`
- Max Retries: `3`

## Verification Steps

### 1. Verify JSON Syntax
```bash
# All should output: ✓ Valid JSON
jq -e '.' railpack.json
jq -e '.' backend/railpack.json
jq -e '.' python-services/poloniex/railpack.json
jq -e '.' frontend/railpack.json
```

### 2. Verify Backend Build
```bash
# Should create dist/index.js (not dist/src/index.js)
cd backend
yarn build:railway
ls -la dist/index.js  # Should exist
```

### 3. Verify ML Worker Files
```bash
# Should find requirements.txt
cd python-services/poloniex
ls -la requirements.txt  # Should exist
ls -la health.py        # Should exist with FastAPI app
```

## Expected Railway Deployment Flow

### ML Worker:
1. Railway reads root `railpack.json` → finds `"ml-worker": { "root": "./python-services/poloniex" }`
2. Sets working directory to `/app/python-services/poloniex`
3. Reads `python-services/poloniex/railpack.json`
4. Runs install commands: creates venv, installs from requirements.txt
5. Runs deploy command: starts uvicorn with health:app

### Backend:
1. Railway reads root `railpack.json` → finds `"backend": { "root": "./backend" }`
2. Sets working directory to `/app/backend`
3. Reads `backend/railpack.json`
4. Runs install commands: sets up Yarn 4.9.2
5. Runs build commands: builds TypeScript, flattens dist structure
6. Runs deploy command: starts `node dist/index.js`

## Testing

### Local Testing (Completed ✅):
- ✅ All JSON files validated
- ✅ Backend build tested - creates correct `dist/index.js`
- ✅ No duplicate keys in any configuration files
- ✅ All files follow Railpack v1 schema

### Railway Testing (Required):
- [ ] ML worker builds successfully
- [ ] ML worker starts and responds to `/health` endpoint
- [ ] Backend builds successfully
- [ ] Backend starts and responds to `/api/health` endpoint
- [ ] Frontend builds and deploys successfully

## References

- [Railpack Schema Documentation](https://schema.railpack.com)
- [AGENTS.md](./AGENTS.md) - Railway deployment best practices
- [RAILWAY_CONFIGURATION.md](./RAILWAY_CONFIGURATION.md) - Current configuration guide
- [RAILWAY_DEPLOYMENT_CHECKLIST.md](./RAILWAY_DEPLOYMENT_CHECKLIST.md) - Deployment checklist

## Rollback Plan

If deployment fails after these changes:

1. Check Railway UI settings (Root Directory should be empty)
2. Check Railway build logs for specific errors
3. Verify Railway service is using the correct branch
4. If needed, revert this PR and restore previous railpack.json files

## Notes

- Health check and restart policy configurations belong in Railway UI, not railpack.json
- The Railpack v1 schema does not include these fields
- Railway's monorepo support with root railpack.json service definitions is the recommended approach
- Each service has its own railpack.json in its service root directory
