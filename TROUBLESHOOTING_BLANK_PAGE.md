# Troubleshooting: Blank Page in Production

## Problem Description

When visiting the production URL (e.g., https://poloniex-trading-platform-production.up.railway.app/), the page shows a **blank white screen** with no content, menus, or error messages.

## Quick Fix Checklist

### 1. Verify Railway UI Configuration

In the Railway dashboard for the `polytrade-fe` service:

- [ ] **Root Directory**: Must be **completely empty** (not `/`, not `./`, not `./frontend` - just blank)
- [ ] **Build Command**: Must be **empty** (let railpack.json handle it)
- [ ] **Install Command**: Must be **empty** (let railpack.json handle it)
- [ ] **Start Command**: Must be **empty** (let railpack.json handle it)
- [ ] **Watch Paths**: Set to `frontend/**`

**Why this matters**: The root `railpack.json` defines `"frontend": { "root": "./frontend" }`. If you set Root Directory in the UI, it overrides this and breaks the build.

### 2. Run Pre-Deployment Validation

Before deploying, run the verification script locally:

```bash
yarn deploy:check:frontend
```

This will check:
- ✅ Railpack configuration is correct
- ✅ Build output (dist folder) exists and is valid
- ✅ serve.js is configured properly
- ✅ Workspace configuration is correct

Fix any errors or warnings before deploying.

### 3. Check Railway Build Logs

After deployment, check the logs for these success indicators:

**Install Step (from /app)**:
```
✅ npm i -g corepack@latest
✅ corepack enable
✅ corepack prepare yarn@4.9.2 --activate
✅ yarn install --frozen-lockfile
```

**Build Step (from /app/frontend)**:
```
✅ node prebuild.mjs
✅ vite build
✅ ✓ built in X.XXs
```

**Deploy Step (from /app/frontend)**:
```
============================================================
Frontend Static Server - Startup Validation
============================================================
Working Directory: /app/frontend
Dist Root: /app/frontend/dist
Port: [Railway PORT]
------------------------------------------------------------
✅ Found 50+ asset files in dist/assets/
✅ Validation passed - all required files present
============================================================
🚀 Static server listening on http://0.0.0.0:[PORT]
```

### 4. Verify Environment Variables

In Railway dashboard, ensure these variables are set:

**Required**:
- `NODE_ENV=production`

**Recommended**:
- `VITE_BACKEND_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}`
- `VITE_API_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}`

### 5. Test Health Check

Once deployed, test the health check endpoint:

```bash
curl https://your-app.up.railway.app/healthz
```

Should return:
```json
{
  "status": "healthy",
  "timestamp": "...",
  "service": "polytrade-fe",
  "version": "...",
  "uptime": ...,
  "components": {
    "assets": "healthy",
    "libraries": "healthy",
    "config": "healthy",
    "validation": "healthy"
  }
}
```

## Common Error Scenarios

### Scenario 1: "Build output not found" Error

**Symptoms**: Server starts but returns "Build output not found. Did you run yarn build?" message.

**Cause**: The `vite build` step didn't run or failed during deployment.

**Solution**:
1. Check Railway build logs for errors during `vite build`
2. Look for TypeScript errors or dependency issues
3. Ensure prebuild.mjs can find the shared folder
4. Verify the build step in frontend/railpack.json includes `vite build`

### Scenario 2: Server Doesn't Start at All

**Symptoms**: Deployment succeeds but service doesn't respond, health check fails.

**Cause**: The start command can't find serve.js or is running from the wrong directory.

**Solution**:
1. Verify Root Directory in Railway UI is **empty/blank**
2. Check that frontend/railpack.json has `"startCommand": "node serve.js"`
3. Ensure Railway isn't using a custom start command override
4. Check deployment logs for "Cannot find module" errors

### Scenario 3: Blank Page with No Errors in Logs

**Symptoms**: Server starts, health check passes, but browser shows blank page.

**Cause**: The wrong index.html is being served (source instead of built).

**Solution**:
1. Check deployment logs for the startup validation output
2. Verify it says "Found 50+ asset files in dist/assets/"
3. Ensure dist/index.html exists (not just source index.html)
4. Visit /healthz to confirm server is running correctly
5. Check browser console for JavaScript errors

### Scenario 4: "yarn not found" Error During Install

**Symptoms**: Build fails with "yarn: command not found" error.

**Cause**: Corepack isn't being installed or activated properly.

**Solution**:
1. Verify frontend/railpack.json install commands include:
   ```json
   "commands": [
     "cd /app && npm i -g corepack@latest",
     "cd /app && corepack enable",
     "cd /app && corepack prepare yarn@4.9.2 --activate",
     "cd /app && yarn install --frozen-lockfile"
   ]
   ```
2. Ensure Railway isn't overriding install commands

### Scenario 5: Assets 404 Errors in Browser Console

**Symptoms**: Page loads but shows errors like "Failed to load /assets/index-XXX.js"

**Cause**: Assets aren't being served correctly or have wrong paths.

**Solution**:
1. Check that dist/assets/ folder exists and has JS/CSS files
2. Verify serve.js cache policy for /assets/ path
3. Ensure base path in vite.config.ts is set to "/"
4. Check that index.html in dist/ has correct /assets/ references

## Technical Background

### How the Build Process Works

1. **Install** (from repository root `/app`):
   - Installs Yarn 4.9.2 via Corepack
   - Runs `yarn install --frozen-lockfile` to install all workspace dependencies
   - Both frontend and backend dependencies are installed in one step

2. **Build** (from service root `/app/frontend`):
   - Runs `node prebuild.mjs` to copy shared modules
   - Runs `vite build` to compile React app
   - Generates `dist/` folder with:
     - `index.html` (transformed with asset references)
     - `assets/` folder (compiled JS, CSS, fonts, images)
     - Other static files (favicon, manifest, etc.)

3. **Deploy** (from service root `/app/frontend`):
   - Runs `node serve.js` to start static file server
   - Server validates dist/ folder exists
   - Listens on `$PORT` at `0.0.0.0`
   - Serves files from `dist/` directory
   - Provides health check at `/healthz`

### Why Source index.html Has ./src/main.tsx Reference

The `frontend/index.html` file in the repository contains:
```html
<script type="module" src="./src/main.tsx"></script>
```

This is **correct and expected** for development! During the build process:

1. Vite reads this source `index.html`
2. Vite transforms it and creates a new `dist/index.html`
3. The `dist/index.html` has proper asset references like:
   ```html
   <script type="module" crossorigin src="/assets/index-HASH.js"></script>
   ```
4. Production serves `dist/index.html`, **not** the source file

If you see the source reference in production, it means:
- The server is serving the wrong file (shouldn't happen with current setup)
- The build didn't run and dist/ is missing
- The Root Directory setting in Railway is causing confusion

## Getting Help

If you're still seeing a blank page after following this guide:

1. Run `yarn deploy:check:frontend` and share the output
2. Share the Railway deployment logs (install, build, and deploy sections)
3. Share the output from visiting `/healthz` endpoint
4. Check browser console for any JavaScript errors
5. Verify Railway service configuration screenshots

## Related Documentation

- `RAILWAY_CONFIGURATION.md` - Complete Railway configuration guide
- `RAILWAY_DEPLOYMENT_CHECKLIST.md` - Pre-deployment checklist
- `frontend/serve.js` - Static server implementation with validation
- `scripts/verify-frontend-deployment.js` - Automated verification tool
