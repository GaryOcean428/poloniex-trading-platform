# Railway Compliance - Quick Reference

## 🚀 Changes Summary

### Files Modified
1. `backend/src/routes/autonomousTrading.js` - ES module import fix
2. `backend/package.json` - Build script updates
3. `backend/railpack.json` - Railpack v1 format
4. `frontend/package.json` - Build script updates
5. `frontend/railpack.json` - Railpack v1 format
6. `railpack.json` - Monorepo service definitions
7. `package.json` - Added railway:compliance script

### Files Created
1. `scripts/railway-compliance-check.mjs` - Automated compliance checker
2. `RAILWAY_COMPLIANCE.md` - Comprehensive deployment guide
3. `RAILWAY_COMPLIANCE_QUICK_REF.md` - This file

## ✅ Compliance Checklist

- [x] No conflicting build configs (Dockerfile, railway.toml, nixpacks.toml)
- [x] Railpack v1 format with proper structure
- [x] Yarn 4.9.2 via corepack in install steps
- [x] ES module imports (no CommonJS require)
- [x] Health check endpoints configured
- [x] Port binding to 0.0.0.0 with $PORT
- [x] Node 20+ requirement specified
- [x] Monorepo workspace structure preserved

## 🔧 Quick Commands

```bash
# Verify compliance
yarn railway:compliance

# Build everything
yarn build

# Build specific service
yarn workspace backend build
yarn workspace frontend build

# Test locally
PORT=8765 yarn workspace backend start
PORT=5675 yarn workspace frontend serve

# Check health endpoints
curl http://localhost:8765/api/health
curl http://localhost:5675/healthz
```

## 📋 Railway Service Configuration

### Backend (polytrade-be)
```
Root Directory: ./backend
Install: npm i -g corepack && corepack enable && corepack prepare yarn@4.9.2 --activate && yarn install --immutable
Build: yarn workspace backend build
Start: yarn workspace backend start
Health: /api/health
Port: $PORT (binds 0.0.0.0)
```

### Frontend (polytrade-fe)
```
Root Directory: ./frontend
Install: npm i -g corepack && corepack enable && corepack prepare yarn@4.9.2 --activate && yarn install --immutable
Build: yarn build
Start: node serve.js
Health: /healthz
Port: $PORT (binds 0.0.0.0)
```

## 🐛 Fixes Applied

### Issue 1: Frontend Build Error
**Error**: `sh: 1: yarn: not found`
**Cause**: Frontend package.json had `yarn run prebuild` in build script
**Fix**: Changed to `node prebuild.mjs`

### Issue 2: Backend Runtime Error
**Error**: `ReferenceError: require is not defined in ES module scope`
**Cause**: `autonomousTrading.js` used `require()` in ES module
**Fix**: Changed to `import { logger } from '../utils/logger.js'`

### Issue 3: Old Railpack Format
**Error**: Deprecated railpack.json format
**Fix**: Migrated to Railpack v1 with explicit steps:
- Install commands with corepack setup
- Build commands
- Deploy configuration with health checks

## 📊 Test Results

### Compliance Check: ✅ PASSED (26/26 checks)
- Build configs: ✅ Clean
- Railpack format: ✅ v1 compliant
- Package.json: ✅ Yarn 4.9.2
- ES modules: ✅ No require() statements
- Yarn config: ✅ Proper .yarnrc.yml
- Health checks: ✅ Configured
- Port binding: ✅ Correct

### Build Tests: ✅ PASSED
- Backend build: ✅ Success
- Frontend build: ✅ Success
- No errors or warnings

## 🔍 Key Changes Explained

### Why node instead of yarn run?
Railway may detect npm as the package manager. Using `node` directly avoids package manager mixing and ensures consistent execution.

### Why Railpack v1?
Railpack v1 provides:
- Explicit install/build/deploy phases
- Better control over build environment
- Health check integration
- Restart policy configuration

### Why corepack setup in install?
Ensures Yarn 4.9.2 is available regardless of Railway's default package manager detection.

## 📚 Documentation

- Full guide: `RAILWAY_COMPLIANCE.md`
- Compliance checker: `scripts/railway-compliance-check.mjs`
- Master cheat sheet: See issue description

## 🎯 Success Indicators

Look for these in Railway logs:

✅ "Successfully prepared Railpack plan for build"
✅ "Shared modules copied successfully"
✅ Backend: "Server running on port {PORT}"
✅ Frontend: "Static server listening on http://0.0.0.0:{PORT}"
✅ Health checks return 200 OK

## ⚠️ What to Avoid

❌ Don't add Dockerfile, railway.toml, or nixpacks.toml
❌ Don't use `yarn run` in build scripts executed by Railway
❌ Don't use `require()` in .js files with type: "module"
❌ Don't hardcode ports or use `localhost`
❌ Don't mix npm and yarn commands

## 🔄 Maintenance

Run before each deployment:
```bash
yarn railway:compliance
```

Keep Yarn version at 4.9.2+ (in package.json)

## 📞 Support

If deployment fails:
1. Check `yarn railway:compliance` output
2. Review Railway build/deploy logs
3. Verify environment variables
4. See `RAILWAY_COMPLIANCE.md` troubleshooting section

---

**Status**: ✅ DEPLOYMENT READY  
**Version**: Railpack v1 + Yarn 4.9.2  
**Last Updated**: October 21, 2025
