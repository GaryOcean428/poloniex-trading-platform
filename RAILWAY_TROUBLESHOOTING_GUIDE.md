# Railway Configuration Troubleshooting Guide

## 🚨 Error: "config file /backend/railway.json does not exist"

### Quick Fix (90% of cases)
The error is caused by incorrect **Railway Dashboard Configuration**, not missing files.

### ✅ Solution Options (Try in order of preference)

#### Option 1: Use Root Configuration (RECOMMENDED)
1. Go to Railway Dashboard → Select your backend service → Settings
2. Set these values:
   - **Root Directory**: `/backend`
   - **Config Path**: `/railway.json` (absolute path from repo root)
   - **Builder**: NIXPACKS
3. Click "Deploy" to save changes

#### Option 2: Use Service-Specific Configuration  
1. Go to Railway Dashboard → Select your backend service → Settings
2. Set these values:
   - **Root Directory**: `/backend`
   - **Config Path**: `/backend/railway.json` (absolute path from repo root)
   - **Builder**: NIXPACKS
3. Click "Deploy" to save changes

#### Option 3: Remove Configuration File Path
1. Go to Railway Dashboard → Select your backend service → Settings
2. **Clear the Config Path field completely** (leave it empty)
3. Manually configure these settings in the Railway UI:
   - **Root Directory**: `/backend`
   - **Build Command**: `yarn install --frozen-lockfile && yarn build`
   - **Start Command**: `yarn start:prod`
   - **Health Check Path**: `/api/health`
   - **Builder**: NIXPACKS
4. Click "Deploy" to save changes

## 🔍 Verification Steps

### 1. Check Configuration Files Exist
```bash
# Run from repository root
ls -la railway.json backend/railway.json frontend/railway.json
node validate-railway-config.js
```

### 2. Test Local Backend
```bash
cd backend
yarn install
yarn start
# Test health endpoint
curl http://localhost:3000/api/health
```

### 3. Railway Dashboard Verification
- ✅ Config Path is absolute (starts with `/`)
- ✅ Root Directory is set to `/backend`
- ✅ Builder is set to NIXPACKS
- ✅ Start command is configured

## 🚫 Common Mistakes

### ❌ Wrong Config Path Examples
```
backend/railway.json          # Missing leading slash
./backend/railway.json        # Relative path notation
railway.json                  # Missing /backend prefix for Option 2
```

### ✅ Correct Config Path Examples  
```
/railway.json                 # Option 1: Root config
/backend/railway.json         # Option 2: Service-specific config
(empty)                       # Option 3: UI configuration
```

## 📋 Environment Variables Required

Make sure these are set in Railway Dashboard:

```bash
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}
POLONIEX_API_KEY=your-api-key
POLONIEX_SECRET=your-secret
JWT_SECRET=your-jwt-secret
SESSION_SECRET=your-session-secret
```

## 🎯 Why This Error Happens

1. **Railway Config Paths are Absolute**: Always from repository root, never relative to Root Directory
2. **Mixed Configuration**: Using both config file AND UI settings can cause conflicts
3. **Path Resolution**: Railway resolves config paths before applying Root Directory

## 🔧 Advanced Debugging

### Enable Enhanced Startup Logging
```bash
# In Railway, set Start Command to:
yarn start:railway
```

This provides detailed startup information and configuration validation.

### Manual Configuration Check
```bash
# Verify all configs are valid
node validate-railway-config.js

# Check specific file exists
ls -la /path/to/repo/backend/railway.json
```

## 📞 Still Having Issues?

1. **Check Railway Build Logs**: Look for specific error messages
2. **Verify Environment Variables**: Ensure all required variables are set
3. **Test Option 1 First**: Root configuration is most reliable
4. **Use Enhanced Startup**: Set start command to `yarn start:railway` for debugging

## 🎯 Success Indicators

- ✅ Railway build completes without errors
- ✅ Backend service starts successfully  
- ✅ Health check at `/api/health` returns 200 OK
- ✅ No "config file does not exist" errors in logs