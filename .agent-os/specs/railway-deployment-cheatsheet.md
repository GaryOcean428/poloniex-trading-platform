---
description: Railway Deployment Master Cheat Sheet (Polytrade Monorepo)
---

# Railway Deployment Master Cheat Sheet

Authoritative checklist and troubleshooting guide for deploying the Polytrade multi-service monorepo to Railway using Railpack v1.

**✅ VERIFIED**: This cheat sheet follows the official Railpack schema from https://schema.railpack.com

Applies to services:
- Frontend: `frontend/railpack.json`
- Backend: `backend/railpack.json`
- Python (ML): `python-services/poloniex/railpack.json`

## Golden Rules

- One Railpack per service with `provider: "node"` or `provider: "python"` (NOT "railway").
- Do NOT set install/build/start overrides in Railway UI (Railpack is source of truth).
- Always bind to `0.0.0.0` and read from `$PORT`.
- Commit per-service lockfiles (`frontend/yarn.lock`, `backend/yarn.lock`).
- Use `${{service.RAILWAY_PUBLIC_DOMAIN}}` for inter-service URLs.
- **IMPORTANT**: Health check and restart policy fields are NOT part of railpack.json schema - they may be Railway-specific configuration.

## Pre-Deployment Checklist

- Railpack schema (official structure):
  - ✅ `$schema: "https://schema.railpack.com"` at top level
  - ✅ `provider` at root level: `"provider": "node"` or `"provider": "python"`
  - ✅ `packages` object for version control (e.g., `{ "node": "22", "yarn": "4.9.2" }`)
  - ✅ `steps` object at root level (NOT nested under `build`)
  - ✅ `deploy` object for deployment configuration
  - ❌ NO `version` field (doesn't exist in schema)
  - ❌ NO `metadata` object (not part of schema)
  - ❌ NO nested `build` object wrapping provider/steps
- Service root in Railway UI points to service directory:
  - Frontend: `./frontend`
  - Backend: `./backend`
  - Python: `./python-services/poloniex`
- Lockfiles present and tracked:
  - `frontend/yarn.lock`
  - `backend/yarn.lock`
- Port binding:
  - Node: `server.listen(process.env.PORT, '0.0.0.0')`
  - Python: `uvicorn ... --host 0.0.0.0 --port $PORT`
- Health endpoints reachable:
  - Backend: `GET /api/health` → 200 JSON
  - Frontend: `GET /health` (or `/`) → 200
  - Python: `GET /health` → 200
- No hardcoded domains/ports; use Railway reference vars
- UI overrides cleared for Install/Build/Start

## Correct Railpack.json Structure

### ✅ Official Schema Format (Node.js Service)

```json
{
  "$schema": "https://schema.railpack.com",
  "provider": "node",
  "packages": {
    "node": "22",
    "yarn": "4.9.2"
  },
  "steps": {
    "install": {
      "commands": [
        "corepack enable",
        "yarn install --frozen-lockfile"
      ]
    },
    "build": {
      "inputs": [{ "step": "install" }],
      "commands": ["yarn build"]
    }
  },
  "deploy": {
    "startCommand": "yarn start",
    "inputs": [{ "step": "build" }]
  }
}
```

### ✅ Official Schema Format (Python Service)

```json
{
  "$schema": "https://schema.railpack.com",
  "provider": "python",
  "packages": {
    "python": "3.13.2"
  },
  "steps": {
    "install": {
      "commands": [
        "pip install -r requirements.txt"
      ]
    }
  },
  "deploy": {
    "startCommand": "uvicorn main:app --host 0.0.0.0 --port $PORT",
    "inputs": [{ "step": "install" }]
  }
}
```

### ⚠️ Unsupported Fields (Not in Official Schema)

The following fields do NOT exist in the official Railpack schema and should NOT be used in railpack.json:
- ❌ `healthCheckPath` - May be Railway UI or railway.json specific
- ❌ `healthCheckTimeout` - May be Railway UI or railway.json specific
- ❌ `restartPolicyType` - Not part of Railpack schema
- ❌ `restartPolicyMaxRetries` - Not part of Railpack schema
- ❌ `version` - Field doesn't exist
- ❌ `metadata` - Object doesn't exist

**Note**: Health check configuration may be handled by Railway's platform settings or a separate railway.json file, not railpack.json.

### 📋 Key Schema Points

1. **provider** is at root level, not nested under `build`
2. **steps** is at root level, not nested under `build`
3. **packages** specifies exact versions (e.g., "node": "22", "python": "3.13.2")
4. **steps.install** and **steps.build** use `commands` arrays
5. **deploy.inputs** references previous steps for layer composition
6. **buildAptPackages** (root level) for build-time apt packages
7. **deploy.aptPackages** for runtime apt packages
8. **deploy.variables** for environment variables
9. **deploy.paths** for PATH additions

## Service-Specific Patterns

### Frontend (Static Serve)

- Build with workspace-aware Yarn commands
- Serve via `serve.js`:
  - `const PORT = parseInt(process.env.PORT || '5675', 10)`
  - `const HOST = '0.0.0.0'`
  - `server.listen(PORT, HOST, ...)`
- Caching:
  - Long cache for assets
  - No-cache for `index.html`

### Backend (Node/Express)

- Build: `tsc` to `./dist`
- Start (deploy): `node dist/src/index.js`
- Health: `/api/health` JSON 200
- CORS:
  - Allow `process.env.FRONTEND_URL`
  - Also allow `https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}`
- Socket.io CORS aligned with above

### Python (FastAPI/Uvicorn)

- Python 3.13.2 (official default, not 3.13+)
- Install: `pip install -r requirements.txt`
- Start: `uvicorn health:app --host 0.0.0.0 --port $PORT`
- Health: FastAPI `/health`
- Version managed by Mise (Railpack's version manager)

## Build System Priority (Verified)

Railway determines which build system to use in this order:

1. **Dockerfile** (if exists in project)
2. **railway.json** with builder config (if exists)
3. **Railpack** (auto-detection)

Since this project uses Railpack, ensure no Dockerfile or railway.json with builder config exists, or they will take precedence.

## Reference Variables

- `${{service.RAILWAY_PUBLIC_DOMAIN}}` for service-to-service URLs
- Examples:
  - Frontend → Backend: `https://${{api.RAILWAY_PUBLIC_DOMAIN}}`
  - Backend allowed origins: `https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}`

## Validation Commands

- JSON validity:
  - `jq -e . frontend/railpack.json`
  - `jq -e . backend/railpack.json`
  - `jq -e . python-services/poloniex/railpack.json`
- Ports in code: grep for localhost/hardcoded ports (should be none)
- Confirm lockfiles tracked:
  - `git ls-files frontend/yarn.lock backend/yarn.lock`

## Common Errors → Fixes

- Error: "Install inputs must be an image or step input"
  - Cause: invalid railpack install schema (local inputs)
  - Fix: conform to official schema; use supported image/step inputs only

- Error: "No project found in /app"
  - Cause: Wrong Root Directory in Railway UI
  - Fix: Set per-service root (frontend/backend/python-service)

- Error: Railpack validation fails with unknown fields
  - Cause: Using unsupported fields like `healthCheckPath`, `restartPolicyType`, `version`, or `metadata`
  - Fix: Remove these fields from railpack.json; they are not part of the official schema

- Error: Provider or steps not found
  - Cause: Nested `build` object wrapping provider/steps (incorrect structure)
  - Fix: Move `provider` and `steps` to root level of railpack.json

- Backend starts but 404 on health
  - Cause: Wrong path or CORS/host binding
  - Fix: Ensure `/api/health` exists; server listens on `0.0.0.0:$PORT`

- Frontend renders blank
  - Cause: Asset caching or wrong public URL
  - Fix: Cache headers set correctly; environment variables for API base URL

- Python service port issue
  - Cause: Not reading `$PORT` or bound to localhost
  - Fix: `--host 0.0.0.0 --port $PORT`

## Railway UI Settings

- Root Directory: service folder only (frontend/backend/python-service)
- Environment Variables:
  - PORT (automatically provided by Railway)
  - NODE_ENV, FRONTEND_URL, BACKEND_URL (as needed)
- No overrides in Install/Build/Start when using Railpack

## Observability

- Logs show:
  - "Successfully prepared Railpack plan"
  - Provider detection (e.g., "Detected Node.js provider")
  - Package version info (e.g., "Using Node 22", "Using Yarn 4.9.2")
  - Listening on 0.0.0.0:$PORT
  - Health check responses OK (200)
- Health checks must be configured in Railway UI or platform settings (not railpack.json)

## Quick Fix Commands

- Clear UI overrides: reset to defaults and redeploy
- Rebuild lockfiles (if needed):
  - Frontend: `yarn install` in `frontend/`
  - Backend: `yarn install` in `backend/`
- Validate JSON and commit fixes

## Monorepo Rules Recap

- Service isolation: configs live in service directories
- Shared logic in `/shared` (if applicable)
- No hardcoded hosts/ports
- Commit lockfiles and keep Yarn 4.x commands (`yarn up`, `yarn install`)

## Ports Policy (Gary8D)

- Frontend: 5675–5699
- Backend: 8765–8799
- Services: 9080–9099
- Always read `$PORT` on Railway; local dev may default within these ranges
