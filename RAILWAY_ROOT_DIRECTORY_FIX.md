# Railway Root Directory Fix - Yarn Workspaces

**⚠️ HISTORICAL DOCUMENT - OUTDATED**: This document describes an older configuration approach where services run from `/app` without using root railpack.json service definitions.

**Current Configuration**: The project now uses:
- Root `railpack.json` with service definitions (`"backend": { "root": "./backend" }`)
- Services run from their respective service roots (e.g., backend runs from `/app/backend`)
- Start command is `node dist/index.js` (NOT `node backend/dist/src/index.js`)
- Build output is flattened by `flatten-dist.mjs` script

See `RAILWAY_CONFIGURATION.md` and `CLAUDE.md` for current best practices.

**This document is kept for reference only. The paths shown here are INCORRECT for the current configuration.**

---

## The Problem

**Backend Error:**
```
Usage Error: No project found in /app
```

**Frontend Error:**
```
Error: Cannot find module '/app/serve.js'
```

## Root Cause

**Railway's Root Directory setting doesn't work with Yarn workspaces.**

When you set Root Directory to `./backend` or `./frontend`, Railway:
1. Only copies that subdirectory to the build container
2. Excludes the root `package.json`, `yarn.lock`, and `.yarnrc.yml`
3. Yarn can't find the workspace configuration
4. Build fails or files end up in wrong locations

## The Solution

**You MUST remove the Root Directory settings from Railway UI for both services.**

### Step-by-Step Fix

#### 1. Update Backend Service in Railway

1. Go to Railway Dashboard → `polytrade-be` service
2. Click **Settings**
3. Scroll to **Service Settings** section
4. Find **Root Directory** field
5. **DELETE the value** (make it empty/blank)
6. Click **Save** or it auto-saves
7. Trigger a new deployment

#### 2. Update Frontend Service in Railway

1. Go to Railway Dashboard → `polytrade-fe` service
2. Click **Settings**
3. Scroll to **Service Settings** section
4. Find **Root Directory** field
5. **DELETE the value** (make it empty/blank)
6. Click **Save** or it auto-saves
7. Trigger a new deployment

#### 3. ML Worker (No Changes Needed)

- `ml-worker` can keep Root Directory = `./python-services/poloniex`
- Python services don't use workspaces, so isolation works fine

## How It Works After This Change

### Without Root Directory (Correct for Workspaces):

Railway will:
1. Copy the **entire repository** to `/app`
2. Detect the root `railpack.json` which defines services
3. Install workspace dependencies from root
4. Build each service using workspace commands
5. Deploy with correct paths

### File Structure in Container:

```
/app/
├── package.json          # Root workspace config
├── yarn.lock             # Shared lockfile
├── .yarnrc.yml          # Yarn config
├── railpack.json        # Service definitions
├── backend/
│   ├── dist/
│   │   └── src/
│   │       └── index.js
│   └── railpack.json
└── frontend/
    ├── dist/
    ├── serve.js
    └── railpack.json
```

### Deploy Commands Will Work:

**Backend:**
```bash
node backend/dist/src/index.js  # Correct path from /app
```

**Frontend:**
```bash
node frontend/serve.js  # Correct path from /app
```

## Expected Build Behavior

### Backend Build Logs Should Show:

```
↳ Using config file `railpack.json`
↳ Using provider Node from config
↳ Found workspace with 2 packages  ✅

Steps
──────────
▸ install (from root)
  $ yarn install --check-cache  ✅

▸ build backend workspace
  $ cd backend && yarn build

Deploy
──────────
  $ node backend/dist/src/index.js
```

### Frontend Build Logs Should Show:

```
↳ Using config file `railpack.json`
↳ Detected Node
↳ Found workspace with 2 packages  ✅

Steps
──────────
▸ install (from root)
  $ yarn install --check-cache  ✅

▸ build frontend workspace
  $ cd frontend && yarn build

Deploy
──────────
  $ node frontend/serve.js
```

## Why This Is The Correct Approach

| Approach | Works for Workspaces? | Reason |
|----------|----------------------|---------|
| **Root Directory set** | ❌ No | Isolates service, breaks workspace resolution |
| **Root Directory empty** | ✅ Yes | Builds from repo root, workspace commands work |
| **Monorepo with root railpack.json** | ✅ Yes | Railway's recommended pattern for workspaces |

## Alternative: If You MUST Use Root Directory

If you absolutely need Root Directory isolation (not recommended), you would need to:

1. Copy workspace root files into each service directory during build
2. Modify install commands to reconstruct workspace structure
3. Much more complex and error-prone

**Don't do this.** Just remove Root Directory.

## Verification After Fix

### 1. Check Railway Service Settings

**Backend:**
- Root Directory: `[empty]` ✅
- Build Command: `[empty]` (let Railpack handle)
- Start Command: `[empty]` (use railpack.json)

**Frontend:**
- Root Directory: `[empty]` ✅
- Build Command: `[empty]` (let Railpack handle)
- Start Command: `[empty]` (use railpack.json)

### 2. Watch Build Logs

Should see:
```
Found workspace with 2 packages  ✅
yarn install --check-cache  ✅
Building workspace: backend (or frontend)
Build completed
```

### 3. Watch Deploy Logs

**Backend should show:**
```
Starting Container
Server listening on port $PORT
✓ Database connected
```

**Frontend should show:**
```
Starting Container
Static server listening on http://0.0.0.0:$PORT
```

### 4. Test Healthchecks

```bash
# Backend
curl https://polytrade-be.up.railway.app/api/health
# Expect: {"status":"ok",...}

# Frontend
curl https://poloniex-trading-platform-production.up.railway.app/healthz
# Expect: {"status":"healthy","components":{...}}
```

## Summary

**Action Required:**

1. ❌ **Remove** Root Directory from `polytrade-be` in Railway UI
2. ❌ **Remove** Root Directory from `polytrade-fe` in Railway UI
3. ✅ Keep Root Directory for `ml-worker` (it's fine for Python)
4. ⏳ Wait for Railway to redeploy
5. ✅ Verify services are healthy

**Why:**
- Yarn workspaces MUST build from repository root
- Root Directory breaks workspace dependency resolution
- This is Railway's recommended approach for monorepos with workspaces

**Result:**
- ✅ Backend will install dependencies and build successfully
- ✅ Frontend will build and serve files correctly
- ✅ Both services will pass healthchecks
- ✅ Deployments will be stable

## Additional Notes

- The `railpack.json` in the repo root already defines service paths correctly
- Railway will automatically route to the right service configurations
- No code changes needed - only Railway UI settings
- This is the standard pattern for Yarn workspace deployments on Railway

## If Issues Persist

After removing Root Directory, if you still see errors:

1. **Clear Railway build cache**: Trigger a fresh deployment
2. **Check Environment Variables**: Ensure PORT, NODE_ENV are set
3. **Verify railpack.json files**: Should have correct startCommand paths
4. **Check volume mounts**: Volumes shouldn't override /app directory

Share the new build/deploy logs if problems continue.
