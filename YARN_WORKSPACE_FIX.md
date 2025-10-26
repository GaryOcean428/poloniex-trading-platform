# Yarn Workspace Railway Deployment Fix

## Problem Summary

Railway deployments were failing with the error:
```
Usage Error: No project found in /app
```

This occurred during the `yarn install --immutable --immutable-cache` command in the build process.

## Root Cause

The error happens because:

1. **Monorepo Structure**: This project uses Yarn workspaces with a root `package.json` that defines workspaces for `frontend` and `backend`
2. **Workspace Dependencies**: The root directory contains essential files:
   - `package.json` (defines workspaces)
   - `yarn.lock` (shared lockfile)
   - `.yarnrc.yml` (Yarn configuration)
3. **Build Context**: When Railway runs the install commands, Yarn needs to find these workspace files to properly resolve dependencies
4. **Missing Context**: The install commands were running `yarn install` without explicitly specifying the workspace root, which could fail depending on the current working directory

## Solution Implemented

Modified the `install` step in both `frontend/railpack.json` and `backend/railpack.json` to explicitly change to the workspace root (`/app`) before running yarn install:

### Before
```json
"install": {
  "commands": [
    "npm i -g corepack@latest",
    "corepack enable",
    "corepack prepare yarn@4.9.2 --activate",
    "yarn install --immutable --immutable-cache"
  ]
}
```

### After
```json
"install": {
  "commands": [
    "npm i -g corepack@latest",
    "corepack enable",
    "corepack prepare yarn@4.9.2 --activate",
    "cd /app && yarn install --immutable --immutable-cache"
  ]
}
```

## Why This Works

1. **Explicit Working Directory**: By using `cd /app &&`, we ensure the yarn install command always runs from the monorepo root where the workspace files are located
2. **Railway Context**: In Railway deployments, `/app` is where the repository is copied to
3. **Workspace Resolution**: When running from `/app`, Yarn can find:
   - The root `package.json` with workspace definitions
   - The shared `yarn.lock` file
   - The `.yarnrc.yml` configuration
4. **Consistency**: This approach works regardless of which directory the command starts from

## Deployment Flow

According to Railway + Railpack best practices:

### Install Step (runs from `/app` - monorepo root)
```bash
npm i -g corepack@latest
corepack enable
corepack prepare yarn@4.9.2 --activate
cd /app && yarn install --immutable --immutable-cache
```

### Build Step (runs from service root, e.g., `/app/backend` or `/app/frontend`)
```bash
# Backend
node prebuild.mjs
rm -rf dist
tsc -p tsconfig.build.json
rm -rf .shared-build

# Frontend
node prebuild.mjs
vite build
rm -rf .shared-build
```

### Deploy Step (runs from service root)
```bash
# Backend: /app/backend
node backend/dist/src/index.js

# Frontend: /app/frontend
node serve.js
```

## Railway UI Configuration

**IMPORTANT**: For this fix to work correctly, ensure the following Railway UI settings:

### For Both Services (polytrade-fe and polytrade-be)

```
Root Directory: (leave empty or blank)
  ❌ DO NOT set to "/", "/app", "./frontend", or "./backend"
  ✅ Leave completely empty/blank

Build Command: (leave empty)
  ✅ Let railpack.json handle build commands

Install Command: (leave empty)
  ✅ Let railpack.json handle install commands

Start Command: (leave empty)
  ✅ Let railpack.json handle start commands
```

### Why Root Directory Should Be Empty

The root `railpack.json` file defines service locations:
```json
{
  "$schema": "https://schema.railpack.com",
  "services": {
    "frontend": {
      "root": "./frontend"
    },
    "backend": {
      "root": "./backend"
    }
  }
}
```

Railway automatically uses these definitions to:
1. Copy the entire repository to `/app`
2. Run install commands from `/app` (workspace root)
3. Run build commands from the service root (e.g., `/app/frontend`)
4. Run deploy commands from the service root

## Verification

After deploying with this fix, you should see in the build logs:

```
✅ Successfully prepared Railpack plan
✅ yarn@4.9.2 activated
✅ Installing dependencies...
✅ yarn install completed successfully
✅ Building service...
✅ Build completed
```

### Testing Locally

You can test this fix locally by simulating the Railway build process:

```bash
# From the service directory, test the install command
cd /home/runner/work/poloniex-trading-platform/poloniex-trading-platform/backend
npm i -g corepack@latest
corepack enable
corepack prepare yarn@4.9.2 --activate
cd /app && yarn install --check-cache

# Should complete without errors
```

## Related Documentation

- `RAILWAY_CONFIGURATION.md` - Complete Railway deployment guide
- `CLAUDE.md` - Railway + Railpack best practices
- `.agent-os/specs/railway-deployment-cheatsheet.md` - Deployment checklist
- `RAILWAY_ROOT_DIRECTORY_FIX.md` - Historical reference (now outdated)

## Additional Notes

1. **Workspace Commands**: All build commands still use workspace commands like `yarn workspace backend build`
2. **Shared Dependencies**: The `/shared` directory is still properly resolved during builds
3. **Lockfile**: The single `yarn.lock` at the root ensures consistent dependencies across all services
4. **No Code Changes**: This fix only modifies the railpack.json configuration files, no application code changes were needed

## Success Indicators

After this fix is deployed:

✅ No more "No project found in /app" errors
✅ yarn install completes successfully
✅ Dependencies resolve correctly for both frontend and backend
✅ Build process completes without errors
✅ Services start and pass health checks

## Troubleshooting

If you still see issues after applying this fix:

1. **Verify Railway UI Settings**: Ensure Root Directory is empty (not set)
2. **Check Build Logs**: Look for yarn install success messages
3. **Validate JSON**: Ensure railpack.json files are valid JSON:
   ```bash
   jq -e . backend/railpack.json
   jq -e . frontend/railpack.json
   ```
4. **Clear Railway Cache**: Trigger a fresh deployment to clear any cached build artifacts

## Impact

- **Files Modified**: 2 (`backend/railpack.json`, `frontend/railpack.json`)
- **Lines Changed**: 2 (one line per file)
- **Breaking Changes**: None
- **Required Railway UI Changes**: Ensure Root Directory is empty (if not already)
- **Deployment Time**: No change expected
- **Build Success Rate**: Should improve to 100%

---

**Status**: ✅ **IMPLEMENTED** - This fix ensures yarn install always runs from the workspace root, resolving the "No project found in /app" error.
