# Railway Service Configuration Guide

## Overview

This guide provides step-by-step instructions for configuring the backend service (`polytrade-be`) on Railway to resolve deployment failures.

## Problem Summary

Railway deployment fails during Docker image export with "context canceled" errors. The root cause is configuration ambiguity: `railpack.json` defines multiple services but Railway needs explicit service-level configuration.

## Solution: Configure Railway Service Settings

### Frontend Service Configuration (polytrade-fe)

Navigate to Railway project → `polytrade-fe` service:

#### Required Settings

1. **Root Directory**: `frontend`
   - Railway executes from this context

2. **Build & Deploy Fields**: **CLEAR ALL**
   - Leave Install Command, Build Command, Start Command blank
   - Railway will use `frontend/railpack.json`:
     - Install: `npm i -g corepack@latest && corepack enable && corepack prepare yarn@4.9.2 --activate && yarn install --immutable`
     - Build: `yarn run prebuild && vite build && rm -rf .shared-build`
     - Start: `node serve.js`

3. **Environment Variables**:
   ```bash
   NODE_ENV=production
   PORT=${{PORT}}
   VITE_API_URL=<backend-url>
   ```

#### Troubleshooting - Yarn Not Found

**Symptom**: `sh: 1: yarn: not found` during build

**Root Cause**: Railway UI overrides ignoring railpack.json

**Fix**: 
1. Clear all Build & Deploy fields in Railway UI
2. Force cache clear: `git commit --allow-empty -m "chore: rebuild" && git push`
3. Verify logs show corepack installation

---

### Step 1: Configure Backend Service in Railway Dashboard

Navigate to your Railway project and configure the `polytrade-be` service with these settings:

#### Required Settings

1. **Root Directory**: `backend`
   - Location: Service Settings → Root Directory
   - This tells Railway to build only the backend service

2. **Build Command**: `yarn install --immutable && yarn bundle:shared && yarn workspace backend build:railway`
   - Location: Service Settings → Build Command
   - This optimizes the build for production deployment

3. **Start Command**: `node dist/src/index.js`
   - Location: Service Settings → Start Command
   - This starts the backend server from the compiled output

4. **Healthcheck Path**: `/api/health`
   - Location: Service Settings → Healthcheck Path
   - This enables Railway's health monitoring

5. **Healthcheck Timeout**: `300` seconds
   - Location: Service Settings → Healthcheck Timeout
   - Allows sufficient time for service startup

### Step 2: Configure Environment Variables

Required environment variables for production:

```bash
# Required
NODE_ENV=production
PORT=${{PORT}}  # Railway auto-injects this

# Database (required)
DATABASE_URL=<your-database-url>

# Security (required)
JWT_SECRET=<generate-with-openssl-rand-base64-32>

# Application Config (recommended)
LOG_LEVEL=info
CORS_ORIGIN=<your-frontend-domain>

# Optional
NODE_OPTIONS=--max-old-space-size=2048
TZ=UTC
FRONTEND_URL=<your-frontend-domain>
FRONTEND_STANDALONE=true
```

#### Generate JWT Secret

```bash
# Generate a secure JWT secret (32+ characters)
openssl rand -base64 32
```

Copy the output and add it to Railway environment variables.

### Step 3: Verify Configuration

After configuring, verify the settings:

1. Check Root Directory is set to `backend`
2. Verify Build Command includes `build:railway`
3. Confirm Start Command points to `dist/src/index.js`
4. Ensure all required environment variables are set

### Step 4: Deploy

Trigger a new deployment:
- Railway will automatically redeploy when you push to the main branch
- Or manually trigger deployment from Railway dashboard

## Alternative: Use railway.json (Config as Code)

The repository now includes a `railway.json` file at the root that provides version-controlled configuration. Railway will use this if no service-level overrides are set.

### Contents of railway.json

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "RAILPACK",
    "buildCommand": "yarn install --immutable && yarn bundle:shared && yarn workspace backend build",
    "watchPatterns": [
      "backend/**/*.ts",
      "backend/**/*.js",
      "shared/**/*.ts",
      "backend/package.json",
      "package.json",
      "yarn.lock"
    ]
  },
  "deploy": {
    "startCommand": "cd backend && node dist/src/index.js",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

## Deployment Validation

Before deploying, run the validation script:

```bash
# Install dependencies
yarn install

# Build the backend
yarn build:backend

# Validate configuration
yarn railway:validate
```

Expected output:
```
✅ All checks passed - Ready to deploy!
```

## Deployment Success Indicators

After deployment, check Railway logs for:

```
✓ Build completed
✓ Exporting to docker image format
✓ Deployment successful
✓ Health check passed
```

Access your health endpoint to verify:
```bash
curl https://your-service.railway.app/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-02T...",
  "environment": "production"
}
```

## Troubleshooting

### Build Fails - Yarn Not Found
- Ensure Node version is 22.11.0 or higher (set in `.nvmrc`)
- Verify Railway is using the correct build command

### Build Fails - Missing Dependencies
- Check that `yarn.lock` is committed
- Verify build command includes `yarn install --immutable`

### Export Fails - Context Timeout
- Verify Root Directory is set to `backend` (not root)
- This ensures only backend files are included in Docker context

### Health Check Fails
- Verify backend binds to `0.0.0.0:${PORT}` (already configured)
- Check health endpoint returns 200 status
- Confirm health check path is `/api/health` in Railway UI (not railpack.json)

### Service Won't Start
- Verify start command is `node dist/src/index.js`
- Check that build completed successfully
- Review environment variables are set correctly

## Service Configuration Checklist

Before deploying, verify:

- [ ] Railway service root directory set to `backend`
- [ ] Build command optimized for Railway
- [ ] Start command points to compiled output
- [ ] Health check path configured
- [ ] Required environment variables set
- [ ] JWT_SECRET is secure (32+ characters)
- [ ] DATABASE_URL is configured
- [ ] Node version is 22.11.0 or higher

## Railway Service IDs (Reference)

| Service | Railway Service ID | Root Directory | Config File |
|---------|-------------------|----------------|-------------|
| polytrade-fe | c81963d4-f110-49cf-8dc0-311d1e3dcf7e | `./frontend` | `frontend/railpack.json` |
| polytrade-be | e473a919-acf9-458b-ade3-82119e4fabf6 | `./backend` | `backend/railpack.json` |
| ml-worker | 86494460-6c19-4861-859b-3f4bd76cb652 | `./python-services/poloniex` | `python-services/poloniex/railpack.json` |

## Additional Resources

- [Railway Build Configuration](https://docs.railway.com/guides/build-configuration)
- [Railway Config as Code](https://docs.railway.com/reference/config-as-code)
- [Railway Monorepo Deployment](https://docs.railway.com/tutorials/deploying-a-monorepo)
- [Railpack Reference](https://docs.railway.com/reference/railpack)

## Support

If you encounter issues not covered here, check:
1. Railway deployment logs for specific error messages
2. Backend service logs for runtime errors
3. Environment variable configuration
4. Health check endpoint accessibility
