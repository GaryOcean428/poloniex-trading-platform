# Railway Manual Configuration Steps - polytrade-be Service

## Overview

After deploying the code fixes, these manual steps must be completed in the Railway Dashboard to fully resolve the deployment timeout issues.

## Service Information

- **Service Name**: polytrade-be
- **Service ID**: e473a919-acf9-458b-ade3-82119e4fabf6
- **Project**: Poloniex Trading Platform

## Required Manual Steps

### Step 1: Remove Conflicting Environment Variables

#### 1.1 Remove BUILD_COMMAND (if present)

**Why**: This environment variable overrides the Railpack configuration. Railpack should control the build process.

**Steps**:
1. Navigate to Railway Dashboard
2. Select project → polytrade-be service
3. Go to **Variables** tab
4. Search for `BUILD_COMMAND`
5. If present, click the **Delete** button
6. Confirm deletion

#### 1.2 Remove RAILWAY_NO_CACHE (if present)

**Why**: This forces full rebuilds on every deployment, significantly increasing build times. Railway's caching can reduce build times by 30-50%.

**Steps**:
1. In the **Variables** tab
2. Search for `RAILWAY_NO_CACHE`
3. If present, click the **Delete** button
4. Confirm deletion

### Step 2: Verify Root Directory Setting

**Why**: This ensures Railway only builds the backend service, not the entire monorepo.

**Steps**:
1. Go to **Settings** tab
2. Scroll to **Root Directory** section
3. **MUST be set to**: `backend`
4. **Should NOT be**: empty, `/`, or any other value
5. If incorrect, update it to `backend` and save

### Step 3: Verify Build Configuration (Optional Verification)

**Why**: Confirm Railway is using Railpack for builds.

**Steps**:
1. In **Settings** tab, check **Build Settings**
2. **Builder** should be: `RAILPACK`
3. **Build Command** should be: empty (let Railpack handle it)
4. **Install Command** should be: empty (let Railpack handle it)

If any custom commands are set, remove them and let Railpack handle the build process.

### Step 4: Review Redis Configuration (Optional)

**Only complete if your backend uses Redis. Skip otherwise.**

#### Option A: If Using Redis Stack Service

**Steps**:
1. In **Variables** tab, find Redis variables
2. Update to reference the Redis service:
   ```
   REDIS_URL=${{Redis-Stack.REDIS_URL}}
   REDIS_PASSWORD=${{Redis-Stack.REDIS_PASSWORD}}
   ```
3. Save changes

#### Option B: If NOT Using Redis

**Steps**:
1. In **Variables** tab, search for Redis-related variables:
   - `REDIS_URL`
   - `REDIS_PASSWORD`
   - `REDIS_PRIVATE_DOMAIN`
2. Delete any Redis variables that are empty or unused
3. This reduces configuration noise

### Step 5: Trigger New Deployment

**After completing all manual steps above:**

1. Go to **Deployments** tab
2. Click **New Deployment** button
3. Select the latest commit (should include the railpack.json fixes)
4. Click **Deploy**

## Verification Checklist

After deployment completes, verify these indicators:

### ✅ Build Phase Success Indicators:
- [ ] Build starts and progresses normally
- [ ] Build logs show: `"Bundling shared modules into backend..."` (once only)
- [ ] NO Vite/frontend compilation output in logs
- [ ] NO messages about multiple services building
- [ ] Build completes in **< 15 minutes** (previously 30+ min)
- [ ] Export phase completes successfully (no "context canceled" error)

### ✅ Deployment Success Indicators:
- [ ] Deployment status shows: **Active** (green)
- [ ] Service is accessible at the Railway-provided URL
- [ ] Health check endpoint responds: `/api/health` returns `200 OK`
- [ ] No crash loops or restart attempts
- [ ] Logs show normal application startup

### ❌ Failure Indicators (Contact Support If These Occur):
- [ ] Build still times out after 30+ minutes
- [ ] Vite compilation appears in backend build logs
- [ ] "context canceled" error during export
- [ ] Node.js version warnings appear
- [ ] Service won't start or crashes immediately

## Troubleshooting

### Issue: Build Still Times Out

**Possible Causes**:
1. Root Directory not set to `backend`
2. BUILD_COMMAND still present in environment variables
3. Railway cache corrupted

**Solutions**:
1. Double-check Root Directory setting (Step 2)
2. Verify BUILD_COMMAND removed (Step 1.1)
3. Try a fresh deployment with cache cleared:
   - In deployment settings, click "Clear Cache"
   - Trigger new deployment

### Issue: Service Won't Start

**Possible Causes**:
1. Missing required environment variables
2. Database connection issues
3. Port binding issues

**Solutions**:
1. Check required environment variables are set:
   - `NODE_ENV=production`
   - `PORT` (Railway auto-sets this)
   - `DATABASE_URL`
   - `JWT_SECRET`
2. Check database service is running
3. Verify backend code binds to `0.0.0.0:${PORT}`

### Issue: Health Check Fails

**Possible Causes**:
1. Backend not responding on correct port
2. Health endpoint not implemented
3. Service crashed during startup

**Solutions**:
1. Check logs for startup errors
2. Verify health endpoint exists: `GET /api/health`
3. Check backend is binding to Railway's PORT variable

## Expected Build Log Output (Success)

```
==> Building backend service
==> Installing dependencies
[install] cd ..
[install] corepack enable
[install] yarn install --immutable
[install] ➤ YN0000: · Done in 45s 123ms

==> Building application
[build] cd ..
[build] node scripts/bundle-shared.mjs backend
[build] Bundling shared modules into backend...
[build] ✓ Bundled shared modules for backend
[build] yarn workspace backend build:railway
[build] $ yarn run prebuild && rm -rf dist && tsc -p tsconfig.build.json...
[build] Found shared folder at: /app/shared
[build] Copying from /app/shared to /app/backend/.shared-build
[build] Shared modules copied successfully
[build] ✓ Backend build completed

==> Exporting image
[export] Exporting layers...
[export] Writing image...
[export] Naming to railway.internal/polytrade-be:latest

==> Build completed successfully in 12m 34s
==> Deployment starting...
==> Deployment active
```

**Key Success Indicators**:
- Only ONE "Bundling shared modules" message (for backend)
- NO Vite compilation output
- Build time < 15 minutes
- Export completes without "context canceled"

## Contact & Support

If issues persist after completing these steps:

1. **Check Documentation**: 
   - `docs/deployment/RAILWAY_BACKEND_FIX.md` - Technical details
   - `docs/RAILWAY_DEPLOYMENT_MASTER.md` - General Railway guide

2. **Railway Support**:
   - Provide Service ID: `e473a919-acf9-458b-ade3-82119e4fabf6`
   - Include last 500 lines of build logs
   - Reference this document

3. **GitHub Issues**:
   - Create issue in repository
   - Tag with `railway` and `deployment`
   - Include build logs and error messages

## Post-Deployment Monitoring

After successful deployment, monitor these metrics:

### Daily Checks (First Week):
- [ ] Build times remain < 15 minutes
- [ ] No deployment failures
- [ ] Service health check passing
- [ ] No unexpected restarts

### Weekly Checks (Ongoing):
- [ ] Build cache being used effectively
- [ ] Deployment success rate > 95%
- [ ] Resource usage within limits
- [ ] No memory leaks or performance degradation

## Rollback Plan

If deployment fails and you need to rollback:

### Option 1: Revert Code Changes
```bash
git revert HEAD
git push origin main
```

### Option 2: Redeploy Previous Working Commit
1. In Railway Dashboard, go to Deployments
2. Find last working deployment
3. Click "Redeploy"

### Option 3: Restore Environment Variables
If you removed variables that were actually needed:
1. Restore `BUILD_COMMAND` to previous value
2. Restore `RAILWAY_NO_CACHE` to previous value
3. Trigger new deployment

---

**Last Updated**: January 2025  
**Status**: ✅ READY FOR DEPLOYMENT  
**Estimated Completion Time**: 10-15 minutes
