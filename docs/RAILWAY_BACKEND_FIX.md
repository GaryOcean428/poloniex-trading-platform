# Railway Backend Deployment - Quick Fix Guide

## Error: "config file /backend/railway.json does not exist"

### ✅ Quick Solutions (Try in order)

#### Option 1: Use Root Configuration (Recommended)
**Railway Dashboard Settings:**
```
Service Name: poloniex-backend
Root Directory: /backend
Config Path: /railway.json
Builder: NIXPACKS
```

#### Option 2: Verify Service-Specific Configuration  
**Railway Dashboard Settings:**
```
Service Name: poloniex-backend
Root Directory: /backend
Config Path: /backend/railway.json
Builder: NIXPACKS
```

#### Option 3: Use UI Configuration Only
**Railway Dashboard Settings:**
```
Service Name: poloniex-backend
Root Directory: /backend
Config Path: (leave completely empty)
Builder: NIXPACKS
Build Command: yarn install --frozen-lockfile && yarn build
Start Command: yarn start:prod
```

### 🔧 Verification Steps

1. **Verify Files Exist:**
   ```bash
   cd /path/to/repo
   ls -la railway.json backend/railway.json
   node validate-railway-config.js
   ```

2. **Test Local Build:**
   ```bash
   cd backend
   yarn install --frozen-lockfile
   yarn build
   yarn start:prod
   ```

3. **Test Health Check:**
   ```bash
   curl http://localhost:3000/api/health
   curl http://localhost:3000/health
   ```

### 🚀 Enhanced Startup Options

**For debugging Railway deployment issues:**
```bash
cd backend
yarn start:railway  # Enhanced startup with debugging info
```

### 📋 Environment Variables Required

**Backend Service Variables in Railway:**
```bash
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}
POLONIEX_API_KEY=your-api-key
POLONIEX_SECRET=your-secret
JWT_SECRET=your-jwt-secret
SESSION_SECRET=your-session-secret
```

### 🐛 Common Issues

1. **Config Path Error**: Railway config paths must be absolute from repository root
   - ❌ Wrong: `backend/railway.json` or `./backend/railway.json`  
   - ✅ Correct: `/backend/railway.json`

2. **Root Directory Confusion**: Root Directory sets the build context, Config Path is separate
   - Root Directory: `/backend` (where Railway runs commands)
   - Config Path: `/railway.json` or `/backend/railway.json` (absolute from repo root)

3. **Missing Dependencies**: Ensure yarn.lock is committed and up to date

### 🔍 Railway-Specific Health Check

The backend includes Railway-optimized health checks:
- `/api/health` - Simple health status  
- `/health` - Detailed health with uptime and service info

Both endpoints return JSON and are suitable for Railway health checks.

### 📞 Support

If the issue persists:
1. Check Railway build logs for specific error details
2. Verify environment variables are set correctly  
3. Try Option 1 (root configuration) as it's most reliable
4. Use `yarn start:railway` for enhanced debugging output