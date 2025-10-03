# Railway Deployment Troubleshooting Guide

## Overview

This guide addresses common deployment issues and provides solutions based on the comprehensive platform assessment.

---

## Common Issues and Solutions

### 1. 404 Errors on SPA Routes (e.g., /dashboard/live, /strategies)

**Symptom**: Navigating to routes like `/dashboard/live` or `/strategies` returns Railway's "Not Found" page instead of loading the app.

**Root Cause**: The SPA routing fallback isn't configured correctly, or the frontend build isn't being served.

**Solution**:

#### Option A: Combined Backend/Frontend Deployment (Single Service)

Set `FRONTEND_STANDALONE=false` or leave it unset in Railway:

```bash
# Railway Environment Variables for Backend Service
FRONTEND_STANDALONE=false
```

This ensures the backend serves both API and frontend static files.

**Build Requirements**:
1. Frontend must be built and available at `backend/../frontend/dist`
2. Backend must be in production mode (`NODE_ENV=production`)

#### Option B: Separate Frontend/Backend Services

Set `FRONTEND_STANDALONE=true` for the backend service:

```bash
# Backend Service Environment Variables
FRONTEND_STANDALONE=true
FRONTEND_URL=https://<your-frontend-service>.railway.app
```

Deploy frontend as a separate Railway service using `frontend/railpack.json`.

**Verification**:
```bash
# Check backend logs for:
"Frontend dist found, serving static files"  # Good
"Frontend dist not found..."                  # Problem - need to build frontend

# Check that all routes return index.html (not 404):
curl https://your-backend.railway.app/dashboard/live
curl https://your-backend.railway.app/strategies
```

---

### 2. "OFFLINE" Status - Missing API Credentials

**Symptom**: Dashboard shows "OFFLINE" status and trading features don't work.

**Root Cause**: Missing Poloniex API credentials or other required environment variables.

**Required Environment Variables**:

#### Backend Service (polytrade-be):
```bash
# Critical - Backend Security
NODE_ENV=production
PORT=${{PORT}}                              # Railway auto-injects
DATABASE_URL=${{Postgres.DATABASE_URL}}     # From Railway Postgres plugin
JWT_SECRET=<generate-secure-32-char-secret>
API_ENCRYPTION_KEY=<generate-secure-key>

# Trading API Credentials
POLONIEX_API_KEY=<your-poloniex-api-key>
POLONIEX_API_SECRET=<your-poloniex-api-secret>
POLONIEX_PASSPHRASE=<your-poloniex-passphrase>

# Service Communication
FRONTEND_URL=https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}
CORS_ALLOWED_ORIGINS=https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}

# Deployment Mode
FRONTEND_STANDALONE=true
```

#### Frontend Service (polytrade-fe):
```bash
# API Connection
VITE_API_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
VITE_WS_URL=wss://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}

# Optional: Mock Mode for Development
VITE_FORCE_MOCK_MODE=false
```

**Generate Secure Secrets**:
```bash
# JWT_SECRET (32+ characters)
openssl rand -base64 32

# API_ENCRYPTION_KEY
openssl rand -base64 32
```

**⚠️ Security Warning**: 
- NEVER commit secrets to Git
- Use Railway's secret management
- Rotate secrets regularly
- Only expose VITE_* variables to frontend

---

### 3. Railway Placeholder Page (polytrade-be)

**Symptom**: The backend service shows Railway's generic splash page instead of the API.

**Root Causes**:
1. No entry point configured
2. Build failed
3. Health check failing

**Solution**:

#### Check Railway Service Configuration:

**Settings → Service Settings:**
- **Root Directory**: `backend`
- **Build Command**: *Leave empty* (use railpack.json)
- **Start Command**: *Leave empty* (use railpack.json)
- **Health Check Path**: `/api/health`
- **Health Check Timeout**: `300` seconds

#### Verify railpack.json:
Ensure `backend/railpack.json` exists with:
```json
{
  "$schema": "https://schema.railpack.com",
  "version": "1",
  "build": {
    "provider": "node",
    "workingDirectory": "..",
    "steps": {
      "install": {
        "commands": [
          "corepack enable",
          "yarn install --immutable"
        ]
      },
      "build": {
        "commands": [
          "yarn bundle:shared",
          "yarn workspace backend build:railway"
        ]
      }
    }
  },
  "deploy": {
    "startCommand": "yarn workspace backend start",
    "healthCheckPath": "/api/health"
  }
}
```

#### Check Logs:
```bash
# In Railway Dashboard → Service → Deployments → View Logs

# Look for:
"Server running on port..."           # Good
"Frontend dist found..."              # Good (if serving frontend)
"Environment: production"             # Good

# Errors to fix:
"MODULE_NOT_FOUND"                    # Build incomplete
"EADDRINUSE"                          # Port conflict
"DATABASE_URL is required"            # Missing env var
```

---

### 4. Yarn Override Issues

**Symptom**: Build fails with `node-gyp` errors, version mismatches, or Yarn Berry errors.

**Root Cause**: Railway UI may override commands and use npm instead of Yarn.

**Solution**:

#### Step 1: Clear Railway UI Overrides
In Railway Dashboard → Service → Settings:
1. **Install Command**: *Leave empty*
2. **Build Command**: *Leave empty*
3. **Start Command**: *Leave empty*

#### Step 2: Set Required Environment Variables
```bash
YARN_ENABLE_STRICT_SETTINGS=false
```

#### Step 3: Ensure Corepack is Enabled
All railpack.json files should include:
```json
{
  "build": {
    "steps": {
      "install": {
        "commands": [
          "corepack enable",
          "yarn install --immutable"
        ]
      }
    }
  }
}
```

---

### 5. CORS Errors

**Symptom**: Frontend can't connect to backend API, browser console shows CORS errors.

**Root Cause**: Backend CORS configuration doesn't include frontend URL.

**Solution**:

#### Backend Environment Variables:
```bash
# Single frontend URL
FRONTEND_URL=https://your-frontend.railway.app

# Multiple allowed origins (comma-separated)
CORS_ALLOWED_ORIGINS=https://your-frontend.railway.app,https://yourdomain.com

# For development
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5675,https://your-frontend.railway.app
```

#### Verify CORS Configuration:
The backend (in `backend/src/index.ts`) automatically configures CORS with:
- `FRONTEND_URL`
- `CORS_ALLOWED_ORIGINS`
- Railway health check (`https://healthcheck.railway.app`)
- Development origins (when `NODE_ENV !== 'production'`)

**Test CORS**:
```bash
curl -i \
  -H "Origin: https://your-frontend.railway.app" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS \
  https://your-backend.railway.app/api/health

# Should see:
Access-Control-Allow-Origin: https://your-frontend.railway.app
Access-Control-Allow-Credentials: true
```

---

### 6. Health Check Failures

**Symptom**: Deployment shows as "unhealthy" or service keeps restarting.

**Root Causes**:
1. Wrong health check path
2. Health check timeout too short
3. Service takes too long to start

**Solution**:

#### Correct Health Check Configuration:

**Backend Service**:
- Path: `/api/health`
- Timeout: `300` seconds
- Expected Response: `200 OK`

**Frontend Service**:
- Path: `/healthz` or `/api/health`
- Timeout: `300` seconds
- Expected Response: `200 OK`

#### Manual Health Check Test:
```bash
# Backend
curl https://your-backend.railway.app/api/health
# Expected: {"status":"healthy","timestamp":"...","environment":"production"}

# Frontend
curl https://your-frontend.railway.app/healthz
# Expected: {"status":"healthy",...,"components":{...}}
```

#### Increase Timeout:
If builds are slow, increase health check timeout in Railway:
- Settings → Health Check Timeout: `300` (or higher)

---

### 7. Build Size / Memory Issues

**Symptom**: Build fails with "Out of memory" or "Build too large" errors.

**Solution**:

#### Use Optimized Build Commands:
```bash
# Backend (uses build:railway for 40% size reduction)
yarn workspace backend build:railway

# Frontend (standard build)
yarn workspace frontend build
```

#### Optimize Bundle Size:
The platform already includes:
- Source maps disabled in production
- Comments removed
- Incremental builds disabled
- Tree shaking enabled

#### Increase Memory (if needed):
```bash
# Railway Environment Variables
NODE_OPTIONS=--max-old-space-size=2048
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] Run `yarn railway:validate` locally
- [ ] Ensure all secrets are generated (JWT_SECRET, API_ENCRYPTION_KEY)
- [ ] Verify Poloniex API credentials are ready
- [ ] Check Railway Postgres plugin is provisioned

### Railway Configuration
- [ ] Backend service root directory: `backend`
- [ ] Frontend service root directory: `frontend`
- [ ] Health check paths configured
- [ ] Environment variables set (use checklist above)
- [ ] Railway UI command overrides cleared

### Post-Deployment
- [ ] Check deployment logs for errors
- [ ] Test health endpoints
- [ ] Verify SPA routing (test `/dashboard/live`, `/strategies`)
- [ ] Test WebSocket connection
- [ ] Verify CORS (check browser console)
- [ ] Test trading features (if API keys provided)

---

## Debug Commands

```bash
# Check Railway service status
railway status

# View logs
railway logs

# Check environment variables (locally)
railway variables

# Build locally to test
yarn build:backend
yarn build:frontend

# Validate configuration
yarn railway:validate

# Test backend locally
yarn workspace backend dev

# Test frontend locally
yarn workspace frontend dev
```

---

## Getting Help

1. **Check Logs First**: Railway Dashboard → Service → Deployments → View Logs
2. **Review Documentation**:
   - `RAILWAY_DEPLOYMENT_MASTER.md` - Complete guide
   - `RAILWAY_DEPLOYMENT_CHECKLIST.md` - Quick setup
   - `RAILWAY_SERVICE_CONFIG.md` - Service configuration details
3. **Common Issues**: This document
4. **Environment Variables**: See `.env.example` for all required variables

---

## Railway Service IDs (Reference)

| Service | Railway Service ID | Root Directory | Health Check |
|---------|-------------------|----------------|--------------|
| polytrade-fe | c81963d4-f110-49cf-8dc0-311d1e3dcf7e | `./frontend` | `/healthz` |
| polytrade-be | e473a919-acf9-458b-ade3-82119e4fabf6 | `./backend` | `/api/health` |
| ml-worker | 86494460-6c19-4861-859b-3f4bd76cb652 | `./python-services/poloniex` | `/health` |

---

## Summary

The most common deployment issues are:
1. Missing or incorrect `FRONTEND_STANDALONE` configuration
2. Missing environment variables (especially secrets)
3. Incorrect health check paths
4. CORS configuration issues
5. Yarn command overrides in Railway UI

Following this guide and using the provided configurations should resolve these issues and result in a successful deployment.
