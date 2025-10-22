# Railway Deployment Fix - Python Service Path Issue

## Problem Summary
Both Python services (`monkey-coder-backend` and `monkey-coder-ml`) were failing with:
```
/bin/bash: line 1: .venv/bin/python: No such file or directory
```

## Root Cause
The Python service's `railpack.json` was using a **relative path** in the startCommand, but Railway's runtime environment couldn't resolve `.venv/bin/python` correctly, especially when volumes are mounted.

## Solution Applied

### Fixed: `python-services/poloniex/railpack.json`
- Changed `startCommand` from relative to absolute path
- Standardized schema to match Node.js services format
- Let Railpack handle automatic venv creation at `/app/.venv`

**Before:**
```json
{
  "build": {
    "provider": "python",
    "steps": {
      "install": {
        "commands": ["pip install --no-cache-dir -r requirements.txt"]
      }
    }
  },
  "deploy": {
    "startCommand": "uvicorn main:app --host 0.0.0.0 --port $PORT",
    ...
  }
}
```

**After:**
```json
{
  "provider": "python",
  "packages": {
    "python": "3.13"
  },
  "deploy": {
    "startCommand": "/app/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port $PORT",
    ...
  }
}
```

## Critical Railway UI Settings to Verify

### Service: `monkey-coder-ml` (Python ML Worker)
**Required Settings:**
- **Root Directory**: `./python-services/poloniex`
- **Build Command**: *(Leave empty - let Railpack handle it)*
- **Install Command**: *(Leave empty - let Railpack handle it)*
- **Start Command**: *(Leave empty - use railpack.json)*
- **Environment Variables**:
  - `PORT` (Railway auto-sets this)
  - `PYTHONUNBUFFERED=1`
  - Any service-specific vars (API keys, etc.)

### Service: `monkey-coder-backend` (Node.js Backend)
**Important Note:** If `monkey-coder-backend` is showing Python detection in logs, the Root Directory is **misconfigured**.

**Required Settings:**
- **Root Directory**: `./backend`
- **Build Command**: *(Leave empty - let Railpack handle it)*
- **Install Command**: *(Leave empty - let Railpack handle it)*
- **Start Command**: *(Leave empty - use railpack.json)*

## Verification Steps

### 1. Check Railway Service Configuration
For each service in Railway dashboard:
```bash
# Via Railway CLI (if available)
railway service
railway variables
```

Or manually in Railway UI:
1. Go to each service's Settings
2. Verify "Root Directory" under "Service Settings"
3. Clear any "Build Command" or "Start Command" overrides
4. Verify environment variables

### 2. Check Build Logs
After deploying, verify in build logs:
- **For Python service**: Should see "↳ Detected Python" and "↳ Using pip"
- **For Node backend**: Should see "↳ Detected Node" or Yarn/npm commands

### 3. Check Deploy Logs
After successful build, deploy logs should show:
```
Starting Container
INFO:     Started server process [1]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:$PORT
```

**Not this:**
```
/bin/bash: line 1: .venv/bin/python: No such file or directory
```

## If Issues Persist

### Issue: Backend still shows Python detection
**Cause:** Root Directory is pointing to wrong path
**Fix:**
1. Go to Railway service settings for `monkey-coder-backend`
2. Set Root Directory to: `./backend`
3. Redeploy

### Issue: Volume mount overwrites .venv
**Cause:** Railway volume mount is overriding `/app` directory
**Fix:**
1. Check if volumes are configured in Railway
2. Volumes should NOT mount to `/app` directly
3. Use specific paths like `/app/data` or `/app/uploads` for volumes

### Issue: Healthcheck still fails
**Cause:** Application might not be starting on correct port
**Fix:**
1. Ensure `PORT` environment variable is set by Railway
2. Verify healthcheck path matches the app:
   - ML Worker: `/health`
   - Backend: `/api/health`
3. Check app logs for actual startup errors

## Testing the Fix

After deploying, test the healthcheck endpoints:

```bash
# ML Worker
curl https://monkey-coder-ml-production.up.railway.app/health

# Expected response:
{
  "status": "ok",
  "service": "ml-worker",
  "python": "3.13.9",
  ...
}
```

```bash
# Backend
curl https://monkey-coder-backend-production.up.railway.app/api/health

# Expected response:
{
  "status": "ok",
  ...
}
```

## Summary of Changes

### Files Modified:
1. `python-services/poloniex/railpack.json`
   - Changed to use absolute path: `/app/.venv/bin/python -m uvicorn ...`
   - Standardized schema format
   - Removed manual venv creation (let Railpack handle it)

### No Changes Needed:
- `backend/railpack.json` - Already correct
- `frontend/railpack.json` - Already correct
- `railpack.json` (root) - Already correct

## Next Steps

1. Commit and push these changes to the Railway deployment branch
2. Railway will auto-deploy on push
3. Verify build logs show correct language detection
4. Verify deploy logs show successful startup
5. Test healthcheck endpoints
6. Monitor for 5-10 minutes to ensure services stay healthy

## Additional Notes

- Railpack 0.9.1 automatically creates venv at `/app/.venv` for Python projects
- Always use absolute paths in `startCommand` when referencing venv binaries
- Railway's volume mounts can interfere with build-time generated files
- The `healthCheckTimeout: 300` gives services 5 minutes to become healthy (useful for cold starts)
