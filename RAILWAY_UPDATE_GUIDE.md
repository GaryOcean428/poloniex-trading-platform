# Railway Service Configuration Update Guide

## Required After Monorepo Migration

After migrating to the clean monorepo structure, Railway service settings must be updated to point to the new directory locations.

## Services to Update

### 1. ml-worker Service

**Current Configuration (BROKEN):**
- Root Directory: `python-services/poloniex` ❌

**New Configuration (REQUIRED):**
- Root Directory: `kernels/core` ✅

**Steps to Fix:**
1. Go to Railway Dashboard
2. Navigate to **ml-worker** service
3. Click **Settings** tab
4. Find **Root Directory** setting
5. Change from `python-services/poloniex` to `kernels/core`
6. Click **Save**
7. Trigger a new deployment

**Alternative:** If the service continues to fail, you can also set it at the root level:
- Root Directory: `.` (root)
- The service will use `railpack-ml-worker.json` from the repository root

---

### 2. polytrade-fe Service

**Current Configuration:**
- Root Directory: `frontend` ❌

**New Configuration:**
- Root Directory: `apps/web` ✅

**Steps to Fix:**
1. Go to Railway Dashboard
2. Navigate to **polytrade-fe** service
3. Click **Settings** tab
4. Find **Root Directory** setting
5. Change from `frontend` to `apps/web`
6. Click **Save**
7. Trigger a new deployment

---

### 3. polytrade-be Service

**Current Configuration:**
- Root Directory: `backend` ❌

**New Configuration:**
- Root Directory: `apps/api` ✅

**Steps to Fix:**
1. Go to Railway Dashboard
2. Navigate to **polytrade-be** service
3. Click **Settings** tab
4. Find **Root Directory** setting
5. Change from `backend` to `apps/api`
6. Click **Save**
7. Trigger a new deployment

---

## Configuration Files Available

Each service has configuration files in multiple locations for flexibility:

### ML Worker
- Root-level: `railpack-ml-worker.json` (if root directory is `.`)
- Service-level: `kernels/core/railpack.json` (if root directory is `kernels/core`)
- Service-level: `kernels/core/railway.json` (Railway config file)

### Frontend (Web)
- Root-level: `railpack-frontend.json` (if root directory is `.`)
- Service-level: `apps/web/railpack.json` (if root directory is `apps/web`)
- Service-level: `apps/web/railway.json` (Railway config file)

### Backend (API)
- Root-level: `railpack-backend.json` (if root directory is `.`)
- Service-level: `apps/api/railpack.json` (if root directory is `apps/api`)

---

## Verification After Update

After updating each service, verify the build succeeds:

### ML Worker
```
✓ Root directory: kernels/core
✓ Installing uv
✓ Installing Python packages with uv
✓ Starting uvicorn server
```

### Frontend
```
✓ Root directory: apps/web
✓ Installing dependencies with yarn
✓ Building with vite
✓ Starting Caddy server
```

### Backend
```
✓ Root directory: apps/api
✓ Installing dependencies with yarn
✓ Building TypeScript
✓ Starting Node.js server
```

---

## Troubleshooting

### "Directory does not exist" Error

**Problem:** Railway still looking for old directory (e.g., `python-services/poloniex`)

**Solution:**
1. Double-check Root Directory setting in Railway UI
2. Clear Railway cache by triggering a new build
3. If issue persists, temporarily set Root Directory to `.` (root) and use root-level railpack files

### Build Command Not Found

**Problem:** Service can't find workspace or build commands

**Solution:**
1. Ensure Root Directory is set correctly
2. Verify the railpack.json file exists in that directory
3. Check workspace names match (@poloniex-platform/web, @poloniex-platform/api)

### Service Still Failing

**Problem:** After updating Root Directory, service still fails

**Solution:**
1. Check Railway build logs for specific error messages
2. Verify environment variables are still set
3. Ensure the railpack.json file in the new directory is correct
4. Try triggering a fresh deployment (not a rebuild)

---

## Quick Reference: New Directory Structure

```
poloniex-trading-platform/
├── apps/
│   ├── web/          # Frontend (was frontend/)
│   └── api/          # Backend (was backend/)
├── kernels/
│   └── core/         # ML Worker (was python-services/poloniex/)
└── packages/         # Shared packages
```

---

## Railway Service IDs

| Service | Service ID | New Root Directory |
|---------|------------|-------------------|
| polytrade-fe | c81963d4-f110-49cf-8dc0-311d1e3dcf7e | `apps/web` |
| polytrade-be | e473a919-acf9-458b-ade3-82119e4fabf6 | `apps/api` |
| ml-worker | 86494460-6c19-4861-859b-3f4bd76cb652 | `kernels/core` |

---

## Need Help?

If you continue to experience issues after following this guide:
1. Check the Railway build logs for specific errors
2. Verify all three services have updated Root Directory settings
3. Ensure railpack.json files exist in the new locations
4. Contact Railway support if the issue persists
