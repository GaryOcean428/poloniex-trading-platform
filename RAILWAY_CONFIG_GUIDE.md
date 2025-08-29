# Railway Deployment Configuration

## Overview
This monorepo uses Yarn 4.9.2 workspaces and deploys three services to Railway:
- **Frontend** (polytrade-fe) - React/TypeScript application
- **Backend** (polytrade-be) - Node.js/Express API  
- **ML Worker** (ml-worker) - Python/FastAPI service

## Critical Configuration Requirements

### 1. Valid Railpack Providers
Railway's Railpack builder requires valid provider values. Invalid providers cause misdetection of service types.

**Valid Providers:**
- `node` - Node.js applications
- `python` - Python applications
- `ruby`, `php`, `golang`, `java`, `rust`, `elixir`, `deno`, `staticfile`, `shell`

**Invalid:** `railway` is NOT a valid provider and will cause build failures.

### 2. Yarn 4.9.2 Workspace Setup
This monorepo requires Yarn 4.9.2 with workspaces. Each service's railpack.json must:
1. Enable Corepack
2. Activate Yarn 4.9.2
3. Run workspace commands from root context

### 3. Service Configurations

#### Frontend Service (polytrade-fe)
```json
{
  "provider": "node",
  "packageManager": "yarn",
  "install": {
    "commands": [
      "corepack enable",
      "corepack prepare yarn@4.9.2 --activate",
      "yarn install --immutable"
    ]
  }
}
```

#### Backend Service (polytrade-be)
```json
{
  "provider": "node",
  "packageManager": "yarn",
  "install": {
    "commands": [
      "corepack enable",
      "corepack prepare yarn@4.9.2 --activate",
      "yarn install --immutable"
    ]
  }
}
```

#### ML Worker Service (ml-worker)
```json
{
  "provider": "python",
  "python": {
    "version": "3.11"
  }
}
```

## Railway Service Settings

### Environment Variables
Each service needs:
- `NODE_ENV=production`
- `RAILWAY_ENVIRONMENT=production`

### Build Settings
- **Do NOT set Root Directory** - Leave empty for monorepo access
- **Build Command**: Use workspace commands from package.json
- **Start Command**: Use workspace-specific start commands

## Troubleshooting

### Provider Detection Issues
**Symptom**: "Detected Python" for Node.js service
**Cause**: Invalid provider in railpack.json
**Fix**: Change provider to valid value (`node` or `python`)

### Yarn Not Found
**Symptom**: "yarn: not found"
**Cause**: Corepack not enabled or wrong provider
**Fix**: Ensure provider is `node` and Corepack commands run first

### Shared Module Resolution
**Symptom**: "Cannot find module '@shared/...'"
**Cause**: Monorepo structure not accessible
**Fix**: Remove Root Directory setting, use workspace commands

## Deployment Checklist

1. ✅ Verify all railpack.json files use valid providers
2. ✅ Ensure Corepack enables Yarn 4.9.2
3. ✅ Check yarn.lock exists in repository root
4. ✅ Confirm .yarnrc.yml configuration
5. ✅ Test build commands locally with `yarn build:frontend` and `yarn build:backend`
6. ✅ Verify shared module bundling with `yarn bundle:shared`
7. ✅ Monitor Railway build logs for provider detection

## References
- [Railway Railpack Documentation](https://docs.railway.com/guides/build-configuration)
- [Railway Monorepo Guide](https://docs.railway.com/guides/monorepo)
- [Yarn Workspaces Documentation](https://yarnpkg.com/features/workspaces)
