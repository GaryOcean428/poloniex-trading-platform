# Railway Deployment Quick Reference

## 📚 Documentation Index

This project has comprehensive Railway + Railpack deployment documentation organized for different needs:

### 🚀 Quick Start
- **[RAILWAY_DEPLOYMENT_CHECKLIST.md](RAILWAY_DEPLOYMENT_CHECKLIST.md)** - Step-by-step deployment guide for immediate deployment needs

### 📖 Complete Reference
- **[docs/RAILWAY_RAILPACK_CHEATSHEET.md](docs/RAILWAY_RAILPACK_CHEATSHEET.md)** - Comprehensive cheatsheet with:
  - Verified railpack.json configurations for all three services
  - Port binding patterns and health check implementations
  - Common issues and solutions with code examples
  - Performance optimization and security best practices
  - Complete troubleshooting guide

### ⚡ Agent Reference
- **[.agent-os/specs/railway-deployment-cheatsheet.md](.agent-os/specs/railway-deployment-cheatsheet.md)** - Concise technical reference for AI agents and developers

### 🔧 Configuration Details
- **[RAILWAY_CONFIGURATION.md](RAILWAY_CONFIGURATION.md)** - Railway-specific settings and environment variables
- **[RAILWAY_COMPLIANCE.md](RAILWAY_COMPLIANCE.md)** - Compliance and best practices verification

---

## Service Configuration Quick Reference

| Service | Root Directory | Port | Health Endpoint | Config File |
|---------|---------------|------|-----------------|-------------|
| **Frontend** | `./frontend` | 5675 | `/healthz`, `/api/health` | `frontend/railpack.json` |
| **Backend** | `./backend` | 8765 | `/api/health` | `backend/railpack.json` |
| **ML Worker** | `./python-services/poloniex` | 9080 | `/health` | `python-services/poloniex/railpack.json` |

**Railway Service IDs:**
- Frontend (polytrade-fe): `c81963d4-f110-49cf-8dc0-311d1e3dcf7e`
- Backend (polytrade-be): `e473a919-acf9-458b-ade3-82119e4fabf6`
- ML Worker (ml-worker): `86494460-6c19-4861-859b-3f4bd76cb652`

---

## Technology Stack

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | 20.x LTS | Managed by Railpack |
| Yarn | 4.9.2 | Managed by Corepack |
| Python | 3.13.2 | Exact version (not 3.13+) |
| React | 19.x | With Vite build system |
| TypeScript | 5.9+ | Compiled to dist/ |

---

## Golden Rules ⚡

1. ✅ **ALWAYS** use `railpack.json` as the single source of truth
2. ✅ **ALWAYS** bind to `0.0.0.0` (never `localhost` or `127.0.0.1`)
3. ✅ **ALWAYS** use `process.env.PORT` or `$PORT` (never hardcode ports)
4. ✅ **ALWAYS** include health check endpoint
5. ✅ **ALWAYS** commit service-specific lockfiles
6. ❌ **NEVER** nest `provider` or `steps` under `build` object
7. ❌ **NEVER** use unsupported fields like `version`, `metadata`, `healthCheckPath`, `restartPolicyType` in railpack.json
8. ❌ **NEVER** commit secrets to railpack.json

---

## Common Commands

### Validation
```bash
# Validate all railpack.json files
jq empty frontend/railpack.json backend/railpack.json python-services/poloniex/railpack.json

# Run Railway validation script
yarn railway:validate

# Check for hardcoded ports
grep -r "localhost" frontend/ backend/
```

### Building
```bash
# Build frontend
yarn build:frontend

# Build backend
yarn build:backend

# Build all
yarn build
```

### Testing Locally
```bash
# Frontend
cd frontend && yarn dev

# Backend
cd backend && yarn dev

# Test health endpoints
curl http://localhost:5675/healthz
curl http://localhost:8765/api/health
```

---

## Quick Troubleshooting

### Issue: "Install inputs must be an image or step input"
**Fix:** Remove any `inputs` from the `install` step in railpack.json

### Issue: "No project found in /app"
**Fix:** Set Root Directory in Railway UI to service-specific path (`./frontend`, `./backend`, or `./python-services/poloniex`)

### Issue: Health Check Timeout
**Fix:** Increase timeout to 300 seconds in Railway UI settings

### Issue: Application failed to respond
**Fix:** Ensure binding to `0.0.0.0` and using `process.env.PORT`

---

## Environment Variables

### Frontend (polytrade-fe)
```bash
PORT=${{PORT}}                # Auto-provided
NODE_ENV=production
VITE_API_URL=${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
```

### Backend (polytrade-be)
```bash
PORT=${{PORT}}                # Auto-provided
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<generate-secure-secret>
FRONTEND_URL=${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}
```

### Python (ml-worker)
```bash
PORT=${{PORT}}                # Auto-provided
PYTHONUNBUFFERED=1
BACKEND_URL=${{polytrade-be.RAILWAY_PRIVATE_DOMAIN}}
```

---

## Need Help?

1. **For step-by-step deployment**: See [RAILWAY_DEPLOYMENT_CHECKLIST.md](RAILWAY_DEPLOYMENT_CHECKLIST.md)
2. **For detailed examples**: See [docs/RAILWAY_RAILPACK_CHEATSHEET.md](docs/RAILWAY_RAILPACK_CHEATSHEET.md)
3. **For troubleshooting**: Check the "Common Issues & Solutions" section in the complete cheatsheet
4. **For Railway issues**: https://discord.gg/railway
5. **For Railpack schema**: https://schema.railpack.com

---

**Last Updated:** October 2025  
**Project:** Poloniex Trading Platform  
**Version:** 1.0.0
