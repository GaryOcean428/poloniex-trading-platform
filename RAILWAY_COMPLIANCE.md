# Railway Deployment Compliance Guide

## ✅ Compliance Status: READY FOR DEPLOYMENT

This repository has been updated to comply with Railway + Yarn 4.9.2 + Railpack v1 best practices.

## What Was Fixed

### 1. Backend ES Module Compatibility
- **Issue**: `autonomousTrading.js` used CommonJS `require()` in an ES module context
- **Fix**: Changed to ES module `import` statement
- **Impact**: Eliminates "ReferenceError: require is not defined" errors

### 2. Frontend Build Configuration
- **Issue**: Build script called `yarn run prebuild` which failed when Railway detected npm
- **Fix**: Changed to `node prebuild.mjs` to avoid package manager mixing
- **Impact**: Consistent build execution regardless of Railway's package manager detection

### 3. Railpack v1 Format Migration
- **Issue**: Old `railpack.json` files used incorrect format without proper schema
- **Fix**: Migrated all railpack configs to proper Railpack v1 format:
  - **Schema URL**: `https://schema.railpack.com`
  - **Structure**: `provider`, `packages`, `steps`, `deploy`
  - **Build Dependencies**: Proper `inputs` linking install to build steps
  - **Health Checks**: `/api/health` (backend), `/healthz` (frontend)
  - **Restart Policies**: Automatic restart on failure
- **Impact**: Proper schema validation, better Railway integration, clearer build process

### 4. Monorepo Service Structure
- **Issue**: Root railpack.json didn't have proper schema and service definitions
- **Fix**: Added correct Railpack schema with explicit service definitions
- **Impact**: Railway can properly detect and build each service independently

## Railway Configuration

### Service: Frontend (polytrade-fe)
- **Root Directory**: `./frontend`
- **Start Command**: `node serve.js`
- **Health Check**: `/healthz`
- **Port**: Uses `process.env.PORT` (binds to `0.0.0.0`)

### Service: Backend (polytrade-be)  
- **Root Directory**: `./backend`
- **Start Command**: `yarn workspace backend start`
- **Health Check**: `/api/health`
- **Port**: Uses `process.env.PORT` (binds to `0.0.0.0`)

### Service: ML Worker (ml-worker)
- **Root Directory**: `./python-services/poloniex`
- **Build**: Python service with FastAPI
- **Health Check**: `/health`

## Build Process

Both frontend and backend follow this flow:

1. **Install Phase**:
   ```bash
   npm i -g corepack@latest
   corepack enable
   corepack prepare yarn@4.9.2 --activate
   yarn install --immutable
   ```

2. **Build Phase**:
   - **Frontend**: `yarn build` → runs `node prebuild.mjs && vite build && rm -rf .shared-build`
   - **Backend**: `yarn workspace backend build` → runs `node prebuild.mjs && tsc && rm -rf .shared-build`

3. **Deploy Phase**:
   - **Frontend**: Starts static file server on port from `$PORT`
   - **Backend**: Starts Express server on port from `$PORT`

## Key Compliance Points

✅ **Single Build Config**: Only Railpack v1, no Dockerfile/railway.toml/nixpacks.toml
✅ **Port Binding**: All services bind to `0.0.0.0` and read `$PORT`
✅ **Health Checks**: All services expose health endpoints
✅ **ES Modules**: Consistent use of ES module syntax
✅ **Yarn 4.9.2**: Proper corepack setup in all services
✅ **No Package Manager Mixing**: All build scripts use `node` directly, not `yarn run` in contexts where Railway might use npm

## Verification

Run the compliance checker:

```bash
yarn railway:compliance
```

Expected output:
```
✅ ALL COMPLIANCE CHECKS PASSED
Repository is ready for Railway deployment!
```

## Testing Locally

### Frontend
```bash
cd frontend
yarn install
yarn build
PORT=5675 yarn serve
# Visit http://localhost:5675
# Check health: http://localhost:5675/healthz
```

### Backend
```bash
cd backend
yarn install
yarn build
PORT=8765 yarn start
# Check health: http://localhost:8765/api/health
```

## Environment Variables Required

### Frontend
- `PORT` (Railway provides automatically)
- `VITE_API_URL` (Backend URL)
- `VITE_WS_URL` (WebSocket URL)

### Backend
- `PORT` (Railway provides automatically)
- `DATABASE_URL` (PostgreSQL connection string)
- `JWT_SECRET` (Authentication)
- `NODE_ENV` (production)
- API keys as needed

## Railway Deployment Steps

1. **Verify Compliance**:
   ```bash
   yarn railway:compliance
   ```

2. **Test Builds Locally**:
   ```bash
   yarn build
   ```

3. **Commit and Push**:
   ```bash
   git add .
   git commit -m "Railway compliance updates"
   git push origin main
   ```

4. **Monitor Railway Logs**:
   - Check build logs for "Successfully prepared Railpack plan"
   - Verify health checks return 200
   - Monitor for any startup errors

## Common Railway Issues - Now Resolved

| Issue | Previous State | Current State |
|-------|---------------|---------------|
| "yarn: not found" | Build called `yarn` in npm context | Uses `node` directly |
| "require is not defined" | CommonJS in ES modules | Pure ES module imports |
| "unable to generate plan" | Multiple build configs | Only Railpack v1 |
| Health check failures | Missing/misconfigured | Properly configured in railpack.json |
| Port binding issues | Hardcoded ports | Uses `$PORT` and `0.0.0.0` |

## Rollback Plan

If deployment fails:

1. Check Railway logs for specific errors
2. Verify environment variables are set
3. Run `yarn railway:compliance` locally
4. Test builds locally with Railway simulation:
   ```bash
   PORT=3000 yarn build && PORT=3000 yarn start
   ```

## Support Resources

- [Railway Railpack Docs](https://docs.railway.app/reference/config-as-code)
- [Yarn 4 Documentation](https://yarnpkg.com/)
- [Railway Discord](https://discord.gg/railway)

## Maintenance

- Run `yarn railway:compliance` before each deployment
- Keep Yarn version at 4.9.2+ (specified in `package.json`)
- Maintain health check endpoints
- Follow monorepo workspace structure
- Keep railpack.json files in sync with actual build commands

---

**Last Updated**: October 21, 2025  
**Compliance Version**: Railpack v1 + Yarn 4.9.2  
**Status**: ✅ DEPLOYMENT READY
