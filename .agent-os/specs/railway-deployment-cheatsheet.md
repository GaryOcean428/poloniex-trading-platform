---
description: Railway Deployment Master Cheat Sheet (Polytrade Monorepo)
---

# Railway Deployment Master Cheat Sheet

Authoritative checklist and troubleshooting guide for deploying the Polytrade multi-service monorepo to Railway using Railpack v1.

Applies to services:
- Frontend: `frontend/railpack.json`
- Backend: `backend/railpack.json`
- Python (ML): `python-services/poloniex/railpack.json`

## Golden Rules

- One Railpack per service with `provider: "railway"`.
- Do NOT set install/build/start overrides in Railway UI (Railpack is source of truth).
- Always bind to `0.0.0.0` and read from `$PORT`.
- Commit per-service lockfiles (`frontend/yarn.lock`, `backend/yarn.lock`).
- Use `${{service.RAILWAY_PUBLIC_DOMAIN}}` for inter-service URLs.

## Pre-Deployment Checklist

- Railpack schema (v1):
  - provider present: `"provider": "railway"`
  - keys limited to allowed fields for v1 (install/build/deploy sections using images/steps as per spec)
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

- Python 3.11
- Install: `pip install -r requirements.txt`
- Start: `uvicorn health:app --host 0.0.0.0 --port $PORT`
- Health: FastAPI `/health`

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
  - Fix: conform to v1 schema; use supported image/step inputs only

- Error: "No project found in /app"
  - Cause: Wrong Root Directory in Railway UI
  - Fix: Set per-service root (frontend/backend/python-service)

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
  - Listening on 0.0.0.0:$PORT
  - Health check responses OK (200)

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
