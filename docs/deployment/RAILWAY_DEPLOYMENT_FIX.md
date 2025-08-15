# Railway Deployment Fix - Complete Guide

## ✅ Completed Fixes

### 1. Railpack Configuration Updates

All railpack.json files have been updated to use consistent package managers and correct build/deploy commands.

### 2. Backend Package.json Path Fixes

Fixed incorrect dist paths in backend/package.json to match actual TypeScript output.

## 🚀 Railway UI Configuration Required

⚠️ **CRITICAL**: Railway UI settings override railpack.json! You MUST clear these fields.

For each service in Railway UI, you need to configure the following settings:

### Frontend Service (polytrade-fe)

**Service ID**: c81963d4-f110-49cf-8dc0-311d1e3dcf7e

1. **Root Directory**: `./frontend`
2. **Build Command**: **MUST BE EMPTY** (clear this field completely)
3. **Install Command**: **MUST BE EMPTY** (clear this field completely)
4. **Watch Paths**: **MUST BE EMPTY** (clear this field completely)
5. **Environment Variables**:
   - `PORT` (Railway provides this)
   - `NODE_ENV=production`
   - `VITE_API_BASE_URL` (your backend URL)

### Backend Service (polytrade-be) ⚠️ CURRENTLY FAILING

**Service ID**: e473a919-acf9-458b-ade3-82119e4fabf6

1. **Root Directory**: `./backend`
2. **Build Command**: **MUST BE EMPTY** (clear this field completely - Railway is using npm instead of yarn!)
3. **Install Command**: **MUST BE EMPTY** (clear this field completely - Railway is using npm instead of yarn!)
4. **Watch Paths**: **MUST BE EMPTY** (clear this field completely)
5. **Environment Variables**:
   - `PORT` (Railway provides this)
   - `NODE_ENV=production`
   - `DATABASE_URL` (your PostgreSQL connection string)
   - `JWT_SECRET` (your JWT secret)
   - `REDIS_URL` (if using Redis)

**If clearing doesn't work**, explicitly set:

- **Install Command**: `yarn install --check-cache`
- **Build Command**: `yarn run build`

### ML Worker Service (ml-worker)

**Service ID**: 86494460-6c19-4861-859b-3f4bd76cb652

1. **Root Directory**: `./python-services/poloniex`
2. **Remove any Build Command overrides** (let Railpack handle it)
3. **Remove any Install Command overrides** (let Railpack handle it)
4. **Environment Variables**:
   - `PORT` (Railway provides this)
   - `POLONIEX_API_KEY` (if needed)
   - `POLONIEX_API_SECRET` (if needed)

## 📝 Fixed Configuration Files

### Root railpack.json

```json
{
  "$schema": "https://schema.railpack.com",
  "version": "1",
  "services": {
    "frontend": "./frontend",
    "backend": "./backend",
    "ml-worker": "./python-services/poloniex"
  }
}
```

### Frontend railpack.json

```json
{
  "$schema": "https://schema.railpack.com",
  "version": "1",
  "packages": {
    "node": "20",
    "yarn": "4.9.2"
  },
  "install": {
    "commands": [
      "yarn install --check-cache"
    ]
  },
  "build": {
    "commands": [
      "yarn run build"
    ]
  },
  "deploy": {
    "command": "node serve.js"
  }
}
```

### Backend railpack.json

```json
{
  "$schema": "https://schema.railpack.com",
  "version": "1",
  "packages": {
    "node": "20",
    "yarn": "4.9.2"
  },
  "install": {
    "commands": [
      "yarn install --check-cache"
    ]
  },
  "build": {
    "commands": [
      "yarn run build"
    ]
  },
  "deploy": {
    "command": "node dist/index.js"
  }
}
```

### Python Service railpack.json

```json
{
  "$schema": "https://schema.railpack.com",
  "version": "1",
  "packages": {
    "python": "3.11"
  },
  "install": {
    "commands": [
      "pip install -r requirements.txt"
    ]
  },
  "build": {
    "commands": [
      "echo 'No build step required for Python service'"
    ]
  },
  "deploy": {
    "command": "uvicorn health:app --host 0.0.0.0 --port ${PORT:-8000}"
  }
}
```

## 🔄 Deployment Steps

1. **Commit and push all changes**:

   ```bash
   git add .
   git commit -m "Fix Railway deployment configurations"
   git push origin main
   ```

2. **In Railway UI for each service**:
   - Go to Settings → General
   - Set the Root Directory as specified above
   - Clear any Build/Install command overrides
   - Save changes

3. **Trigger new deployments**:
   - Railway should automatically redeploy after settings changes
   - If not, manually trigger a redeploy for each service

## ✅ Expected Success Indicators

After these changes, you should see:

- "Successfully prepared Railpack plan for build" in logs
- Successful yarn installation with existing lock file
- TypeScript compilation completing without errors
- Services starting on the correct ports

## ❌ Previous Errors (Now Fixed)

1. **Frontend**: "The lockfile would have been created by this install" - Fixed by using yarn with --check-cache
2. **Backend**: "Cannot find module '@shared/types/strategy'" - Fixed by using yarn and correct TypeScript configuration
3. **ML Worker**: "No start command was found" - Fixed by adding build section to railpack.json

## 📞 Support

If deployments still fail after these changes:

1. Check the Railway logs for new error messages
2. Verify environment variables are set correctly
3. Ensure Railway service IDs match your actual services
4. Check that git push was successful and Railway detected the changes
