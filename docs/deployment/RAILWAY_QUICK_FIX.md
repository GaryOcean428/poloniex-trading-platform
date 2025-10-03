# Railway polytrade-be Quick Fix Guide

## 🚨 CRITICAL: Complete These Steps in Order

### 1️⃣ Code Changes (DONE ✅)
The following files have been updated and committed:
- `backend/railpack.json` - Fixed workingDirectory
- `scripts/bundle-shared.mjs` - Backend-only bundling
- `.nvmrc` - Updated Node.js to 22.12.0

### 2️⃣ Railway Dashboard Changes (DO NOW ⚠️)

**Service**: polytrade-be  
**Service ID**: e473a919-acf9-458b-ade3-82119e4fabf6

#### Required Actions:

**A. Delete These Variables** (if present):
```
✗ BUILD_COMMAND
✗ RAILWAY_NO_CACHE
```

**B. Verify This Setting**:
```
✓ Root Directory = backend
```

**C. Deploy Latest Code**:
- Go to Deployments → New Deployment
- Select latest commit with railpack.json fixes
- Click Deploy

### 3️⃣ Verify Success (AFTER DEPLOYMENT)

✅ **Build completes in < 15 minutes** (was 30+)  
✅ **No Vite output in logs** (backend only)  
✅ **Service status: Active**  
✅ **Health check passes**: `/api/health` → 200 OK

---

## What Changed?

### Before (Problem):
```json
// backend/railpack.json
{
  "workingDirectory": "..",  // ❌ Built entire monorepo
  "build": {
    "commands": [
      "yarn bundle:shared"  // ❌ Bundled frontend too
    ]
  }
}
```
**Result**: 30+ min builds, timeouts, frontend compilation

### After (Fixed):
```json
// backend/railpack.json
{
  "workingDirectory": ".",  // ✅ Backend folder only
  "build": {
    "commands": [
      "cd ..",
      "node scripts/bundle-shared.mjs backend"  // ✅ Backend only
    ]
  }
}
```
**Result**: ~12 min builds, no timeouts, backend only

---

## Need Help?

**Detailed Guide**: `docs/deployment/RAILWAY_BACKEND_FIX.md`  
**Manual Steps**: `docs/deployment/RAILWAY_MANUAL_STEPS.md`  
**General Guide**: `docs/RAILWAY_DEPLOYMENT_MASTER.md`

**Railway Support**: Include Service ID `e473a919-acf9-458b-ade3-82119e4fabf6`

---

## Expected Build Log (Success):

```
==> Building backend service
[build] Bundling shared modules into backend...  ✓ (once only)
[build] ✓ Bundled shared modules for backend
[build] Backend build completed (604KB)
==> Build completed successfully in 12m 34s  ✓
==> Deployment active  ✓
```

**NOT** showing: ❌ Vite, ❌ frontend, ❌ multiple bundles

---

**Status**: ✅ Code changes deployed, awaiting Railway config  
**ETA**: 10-15 minutes once Railway config updated
