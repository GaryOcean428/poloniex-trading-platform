# Railway Deployment Fix for PR #329

## Problem Summary

All three Railway services are failing to build because they're configured with old directory paths that don't exist in the new monorepo structure.

### Error Messages

1. **ml-worker**: `directory /build-sessions/.../python-services/poloniex does not exist`
2. **polytrade-be**: Build failed (wrong root directory)
3. **polytrade-fe**: Build failed (wrong root directory)

---

## Root Cause

The monorepo restructure moved files to new locations:

| Service | Old Path | New Path | Status |
|---------|----------|----------|--------|
| ml-worker | `python-services/poloniex` | `kernels/core` | ❌ Wrong |
| polytrade-be | `backend/` | `apps/api` | ❌ Wrong |
| polytrade-fe | `frontend/` | `apps/web` | ❌ Wrong |

---

## Solution: Update Railway Service Root Directories

You need to update the **Root Directory** setting for each Railway service in the Railway dashboard.

### Step-by-Step Fix

#### 1. Fix ml-worker Service

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Select project: `polytrade-be`
3. Click on service: `ml-worker`
4. Go to **Settings** tab
5. Find **Root Directory** setting
6. Change from: `python-services/poloniex`
7. Change to: `kernels/core`
8. Click **Save**

#### 2. Fix polytrade-be Service

1. Click on service: `polytrade-be`
2. Go to **Settings** tab
3. Find **Root Directory** setting
4. Change from: `backend` (or empty)
5. Change to: `apps/api`
6. Click **Save**

#### 3. Fix polytrade-fe Service

1. Click on service: `polytrade-fe`
2. Go to **Settings** tab
3. Find **Root Directory** setting
4. Change from: `frontend` (or empty)
5. Change to: `apps/web`
6. Click **Save**

---

## Verification

After updating all three services:

1. Go back to PR #329
2. Click "Re-run deployments" or push a new commit
3. All three services should now build successfully ✅

### Expected Build Output

**ml-worker:**
```
✓ Root directory: kernels/core
✓ Found railpack.json
✓ Installing Python dependencies with uv
✓ Deployment successful
```

**polytrade-be:**
```
✓ Root directory: apps/api
✓ Found railpack.json
✓ Installing yarn dependencies
✓ Building @poloniex-platform/api
✓ Deployment successful
```

**polytrade-fe:**
```
✓ Root directory: apps/web
✓ Found railpack.json
✓ Installing yarn dependencies
✓ Building @poloniex-platform/web
✓ Starting Caddy server
✓ Deployment successful
```

---

## Alternative: Railway CLI Method

If you prefer using the Railway CLI:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project
railway link

# Update ml-worker
railway service ml-worker
railway up --service ml-worker --root kernels/core

# Update polytrade-be
railway service polytrade-be
railway up --service polytrade-be --root apps/api

# Update polytrade-fe
railway service polytrade-fe
railway up --service polytrade-fe --root apps/web
```

---

## Configuration Files Reference

The railpack.json files are already correctly configured:

### apps/api/railpack.json ✅
```json
{
  "provider": "node",
  "packages": { "node": "20", "yarn": "4.9.2" },
  "steps": {
    "install": { "commands": ["npm i -g corepack@latest", "corepack enable", "corepack prepare yarn@4.9.2 --activate", "yarn install"] },
    "build": { "commands": ["yarn workspace @poloniex-platform/api run build"], "inputs": [{"step": "install"}] }
  },
  "deploy": {
    "startCommand": "yarn workspace @poloniex-platform/api run start",
    "inputs": [{"step": "build"}]
  }
}
```

### apps/web/railpack.json ✅
```json
{
  "provider": "node",
  "packages": { "node": "20", "yarn": "4.9.2", "caddy": "latest" },
  "steps": {
    "install": { "commands": ["npm i -g corepack@latest", "corepack enable", "corepack prepare yarn@4.9.2 --activate", "yarn install --immutable --immutable-cache"] },
    "build": { "commands": ["yarn workspace @poloniex-platform/web run build", "echo '=== Verifying build output ==='", "ls -la apps/web/dist/", "ls -la apps/web/dist/assets/"], "inputs": [{"step": "install"}] }
  },
  "deploy": {
    "startCommand": "caddy run --config apps/web/Caddyfile --adapter caddyfile",
    "inputs": [{"step": "build"}]
  }
}
```

### kernels/core/railpack.json ✅
```json
{
  "provider": "python",
  "packages": { "python": "3.13" },
  "steps": {
    "install": { "commands": ["pip install uv", "uv pip install --system -e ."] }
  },
  "deploy": {
    "startCommand": "uvicorn health:app --host 0.0.0.0 --port $PORT"
  }
}
```

---

## Summary

**Action Required:** Update the Root Directory for all 3 Railway services in the Railway dashboard.

Once updated, the deployments will succeed and PR #329 can be merged! 🚀
