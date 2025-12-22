# Railway Service Configuration Update Guide

## Overview

After migrating to the clean monorepo structure, Railway services need their **Root Directory** settings updated in the Railway Dashboard to point to the new locations.

## Configuration File Structure

**One railpack.json per service**, located in each service's directory:

| Service | railpack.json Location | Railway Root Directory |
|---------|----------------------|------------------------|
| polytrade-fe | `apps/web/railpack.json` | `apps/web` |
| polytrade-be | `apps/api/railpack.json` | `apps/api` |
| ml-worker | `kernels/core/railpack.json` | `kernels/core` |

## Required Updates

### Railway Dashboard Settings (MANUAL UPDATE REQUIRED)

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

## Configuration Files Structure

Each service has **one** railpack.json file in its directory:

### ML Worker
- Configuration: `kernels/core/railpack.json`
- Railway metadata: `kernels/core/railway.json`
- Root Directory: `kernels/core`

### Frontend (Web)
- Configuration: `apps/web/railpack.json`
- Railway metadata: `apps/web/railway.json`
- Root Directory: `apps/web`

### Backend (API)
- Configuration: `apps/api/railpack.json`
- Root Directory: `apps/api`

**Note:** Root-level railpack files (railpack-*.json) have been removed to eliminate confusion.

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

## Configuration Files Explained

### Single railpack.json per Service

Each service has **one** railpack.json file located in its directory:
- `apps/web/railpack.json` - Frontend configuration
- `apps/api/railpack.json` - Backend configuration  
- `kernels/core/railpack.json` - ML Worker configuration

### How Railway Uses These Files

1. You set **Root Directory** in Railway Dashboard (e.g., `apps/web`)
2. Railway looks for `railpack.json` in that directory
3. Railway uses that configuration to build and deploy

### No Root-Level Files Needed

Previously, there were duplicate files at the root level (`railpack-backend.json`, etc.). These have been **removed** to eliminate confusion. 

**One configuration file per service, in that service's directory.**

---

## Need Help?

If you continue to experience issues after following this guide:
1. Check the Railway build logs for specific errors
2. Verify all three services have updated Root Directory settings
3. Ensure railpack.json files exist in the new locations (see above)
4. Review `RAILWAY_CONFIG_FILES.md` for detailed configuration reference
5. Contact Railway support if the issue persists
