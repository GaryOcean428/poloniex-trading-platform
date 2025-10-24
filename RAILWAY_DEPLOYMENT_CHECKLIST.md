# Railway Deployment Checklist ✅

## Quick Start Guide

This checklist provides the essential steps to deploy the backend service to Railway.

## Pre-Deployment Checklist

### 1. Validate Configuration ✅

```bash
# Run validation script
yarn railway:validate
```

**Expected Output:**
```
✅ All checks passed - Ready to deploy!
```

### 2. Configure Railway Service (polytrade-be)

Navigate to Railway Dashboard → polytrade-be service → Settings:

#### Required Settings:

- [ ] **Root Directory**: Set to `backend`
- [ ] **Build Command**: `yarn install --immutable && yarn bundle:shared && yarn workspace backend build:railway`
- [ ] **Start Command**: `node dist/src/index.js`
- [ ] **Healthcheck Path**: `/api/health`
- [ ] **Healthcheck Timeout**: `300` seconds

### 3. Environment Variables

Configure these environment variables in Railway:

#### Required:
- [ ] `NODE_ENV=production`
- [ ] `PORT=${{PORT}}` (Railway auto-injects)
- [ ] `DATABASE_URL=<your-database-url>`
- [ ] `JWT_SECRET=<generate-secure-secret>`

#### Recommended:
- [ ] `LOG_LEVEL=info`
- [ ] `CORS_ORIGIN=<your-frontend-domain>`
- [ ] `FRONTEND_URL=<your-frontend-domain>`
- [ ] `FRONTEND_STANDALONE=true`

#### Optional:
- [ ] `NODE_OPTIONS=--max-old-space-size=2048`
- [ ] `TZ=UTC`

### 4. Generate JWT Secret

```bash
# Generate a secure JWT secret (32+ characters)
openssl rand -base64 32

# Copy output and add to Railway environment variables
```

## Deployment Steps

### 1. Build Locally (Optional - for testing)

```bash
# Build backend
yarn build:backend

# Validate again
yarn railway:validate
```

### 2. Commit and Push

```bash
# Stage changes
git add .

# Commit
git commit -m "feat: your changes"

# Deploy
git push origin main
```

### 3. Monitor Deployment

Watch Railway logs for success indicators:

- [ ] ✓ Build completed
- [ ] ✓ Exporting to docker image format
- [ ] ✓ Deployment successful
- [ ] ✓ Health check passed

## Post-Deployment Verification

### 1. Check Health Endpoint

```bash
# Replace with your actual Railway domain
curl https://your-service.railway.app/api/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-02T...",
  "environment": "production"
}
```

### 2. Verify Service Status

- [ ] Service shows as "Active" in Railway dashboard
- [ ] No error messages in deployment logs
- [ ] Health check status is "Healthy"
- [ ] Service is accessible via public URL

## Troubleshooting Quick Reference

### Build Fails
1. Check Node version is 22.11.0 in `.nvmrc`
2. Verify build command in Railway settings
3. Check Railway build logs for specific errors

### Export Fails with Timeout
1. Verify Root Directory is set to `backend`
2. Check that build completed successfully
3. Review `.railwayignore` for unnecessary files

### Health Check Fails
1. Verify backend binds to `0.0.0.0:${PORT}`
2. Check `/api/health` endpoint returns 200 status
3. Confirm health check path is `/api/health` (configured in Railway UI, not railpack.json)

### Service Won't Start
1. Verify start command is `node dist/src/index.js`
2. Check all required environment variables are set
3. Review service logs for error messages

## Quick Links

- **Detailed Configuration Guide**: [docs/deployment/RAILWAY_SERVICE_CONFIG.md](docs/deployment/RAILWAY_SERVICE_CONFIG.md)
- **Complete Solution Document**: [docs/deployment/RAILWAY_DEPLOYMENT_SOLUTION.md](docs/deployment/RAILWAY_DEPLOYMENT_SOLUTION.md)
- **Railway MCP Tools Guide**: [docs/deployment/RAILWAY_MCP_USAGE.md](docs/deployment/RAILWAY_MCP_USAGE.md)
- **Best Practices**: [CLAUDE.md](CLAUDE.md)

## Service Reference

| Service | Railway Service ID | Root Directory |
|---------|-------------------|----------------|
| polytrade-fe | c81963d4-f110-49cf-8dc0-311d1e3dcf7e | `./frontend` |
| **polytrade-be** | **e473a919-acf9-458b-ade3-82119e4fabf6** | **`./backend`** |
| ml-worker | 86494460-6c19-4861-859b-3f4bd76cb652 | `./python-services/poloniex` |

## Files Created in This Fix

- ✅ `railway.json` - Railway configuration
- ✅ `scripts/validate-railway-deployment.mjs` - Validation script
- ✅ `docs/deployment/RAILWAY_SERVICE_CONFIG.md` - Configuration guide
- ✅ `docs/deployment/RAILWAY_MCP_USAGE.md` - MCP tools guide
- ✅ `docs/deployment/RAILWAY_DEPLOYMENT_SOLUTION.md` - Complete solution
- ✅ `RAILWAY_DEPLOYMENT_CHECKLIST.md` - This checklist

## Support

If you encounter issues:
1. Run `yarn railway:validate`
2. Check Railway deployment logs
3. Review health endpoint status
4. Consult the detailed guides listed above

---

**Status:** ✅ READY FOR DEPLOYMENT

**Last Updated:** 2025-01-02
