# Railway Configuration Cross-Project Verification

This document verifies the Poloniex Trading Platform configuration against common Railway deployment issues found in other projects.

## Comparison Summary

| Issue | Other Projects | This Project | Status |
|-------|---------------|--------------|--------|
| Root railpack provider | ❌ Wrong provider set | ✅ No provider (correct) | **FIXED** |
| Python install steps | ❌ Missing venv creation | ✅ Proper venv setup | **FIXED** |
| Python requirements path | ❌ Path mismatches | ✅ Correct path | **VERIFIED** |
| Start command paths | ❌ Hardcoded /app paths | ✅ Relative paths | **FIXED** |
| Python version consistency | ⚠️ Inconsistent versions | ✅ Consistent 3.13 | **VERIFIED** |
| Node install commands | ❌ Unnecessary cd /app | ✅ Clean commands | **FIXED** |
| Deploy inputs | ❌ Missing inputs | ✅ Proper inputs | **VERIFIED** |

## Critical Issues Addressed

### 🟢 Issue 1: Root railpack.json Provider (P0)

**Other Projects Problem:**
```json
{
  "provider": "python",  // ❌ Wrong - root should not have provider
  "services": { ... }
}
```

**This Project (CORRECT):**
```json
{
  "$schema": "https://schema.railpack.com",
  "services": {
    "frontend": { "root": "./frontend" },
    "backend": { "root": "./backend" },
    "ml-worker": { "root": "./python-services/poloniex" }
  }
}
```

✅ **Status:** Root railpack.json correctly defines service roots without specifying a provider.

---

### 🟢 Issue 2: Python Service Missing Install Steps (P0)

**Other Projects Problem:**
```json
{
  "provider": "python",
  "deploy": {
    "startCommand": "/app/.venv/bin/python ..."  // ❌ .venv doesn't exist
  }
}
```

**This Project - BEFORE FIX:**
```json
{
  "provider": "python",
  "packages": { "python": "3.13" },
  "deploy": {
    "startCommand": "/app/.venv/bin/python -m uvicorn main:app ..."  // ❌ No install steps
  }
}
```

**This Project - AFTER FIX:**
```json
{
  "provider": "python",
  "packages": { "python": "3.13" },
  "steps": {
    "install": {
      "commands": [
        "python -m venv .venv",
        ".venv/bin/pip install --upgrade pip",
        ".venv/bin/pip install -r requirements.txt"
      ]
    }
  },
  "deploy": {
    "startCommand": ".venv/bin/python -m uvicorn health:app --host 0.0.0.0 --port $PORT",
    "healthCheckPath": "/health",
    "inputs": [{"step": "install"}]
  }
}
```

✅ **Status:** Python service now has proper install steps that create venv and install dependencies.

**Key Changes:**
1. Added `steps.install` with venv creation
2. Changed startCommand from `/app/.venv/` (absolute) to `.venv/` (relative to service root)
3. Fixed module reference from `main:app` to `health:app` (actual entry point)
4. Added `inputs` to ensure install runs before deploy

---

### 🟢 Issue 3: Python Requirements.txt Path (P0)

**Other Projects Problem:**
```
service_root/
  railpack.json
  main.py
  requirements/        # ❌ requirements in subdirectory
    requirements.txt
```

**This Project (CORRECT):**
```
python-services/poloniex/
  railpack.json
  health.py
  main.py
  requirements.txt     # ✅ requirements.txt at service root
  pyproject.toml
```

✅ **Status:** Requirements.txt is correctly located at the service root where railpack.json expects it.

---

### 🟢 Issue 4: Frontend Unnecessary cd Commands (P1)

**This Project - BEFORE FIX:**
```json
{
  "steps": {
    "install": {
      "commands": [
        "cd /app && npm i -g corepack@latest",  // ❌ Unnecessary cd
        "cd /app && corepack enable",
        "cd /app && corepack prepare yarn@4.9.2 --activate",
        "cd /app && yarn install --frozen-lockfile"
      ]
    }
  }
}
```

**This Project - AFTER FIX:**
```json
{
  "steps": {
    "install": {
      "commands": [
        "npm i -g corepack@latest",
        "corepack enable",
        "corepack prepare yarn@4.9.2 --activate",
        "yarn install --immutable"
      ]
    }
  }
}
```

✅ **Status:** Removed unnecessary `cd /app &&` prefixes. Railway already executes commands in the service root context.

**Additional improvements:**
- Changed `--frozen-lockfile` to `--immutable` (Yarn 4.x recommended flag)
- Added missing `inputs: [{"step": "build"}]` to deploy step

---

### 🟢 Issue 5: Python Version Consistency (P1)

**Version Check:**
- `.python-version`: 3.13.2
- `pyproject.toml`: requires-python = ">=3.11"
- `railpack.json`: "python": "3.13"
- `pyproject.toml` target: "py313"

✅ **Status:** All configurations consistently use Python 3.13. The pyproject.toml minimum of 3.11 is acceptable as it allows 3.13.

---

### 🟢 Issue 6: Start Command Paths

**Comparison:**

| Service | Before | After | Status |
|---------|--------|-------|--------|
| Backend | `node backend/dist/index.js` | `node dist/index.js` | ✅ Fixed |
| Frontend | `node serve.js` | `node serve.js` | ✅ Already correct |
| Python | `/app/.venv/bin/python -m uvicorn main:app` | `.venv/bin/python -m uvicorn health:app` | ✅ Fixed |

All start commands now use relative paths from the service root.

---

## Configuration Best Practices Applied

### ✅ 1. Service Root Pattern
```json
// Root railpack.json
{
  "services": {
    "backend": { "root": "./backend" }
  }
}
```
- Railway sets working directory to `/app/backend`
- All commands run from this context
- Paths are relative to service root

### ✅ 2. Proper Step Dependencies
```json
{
  "steps": {
    "install": { "commands": [...] },
    "build": { 
      "commands": [...],
      "inputs": [{"step": "install"}]
    }
  },
  "deploy": {
    "startCommand": "...",
    "inputs": [{"step": "build"}]
  }
}
```

### ✅ 3. Python Virtual Environment
```bash
python -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

### ✅ 4. Health Check Endpoints
- Backend: `/api/health`
- Frontend: `/healthz`
- Python: `/health`

All services have proper health check paths configured.

---

## Deployment Readiness Checklist

### Backend Service ✅
- [x] Correct provider: `node`
- [x] Proper install steps with corepack
- [x] Build step with workspace command
- [x] Start command uses relative path: `node dist/index.js`
- [x] Health check: `/api/health`
- [x] Deploy inputs reference build step

### Frontend Service ✅
- [x] Correct provider: `node`
- [x] Clean install commands (no cd /app)
- [x] Build step with prebuild and vite
- [x] Start command: `node serve.js`
- [x] Health check: `/healthz`
- [x] Deploy inputs reference build step

### Python Service ✅
- [x] Correct provider: `python`
- [x] Install steps create venv
- [x] Requirements.txt at service root
- [x] Start command uses relative path: `.venv/bin/python`
- [x] Module reference correct: `health:app`
- [x] Health check: `/health`
- [x] Deploy inputs reference install step

---

## Railway Service Configuration

Each service in Railway should have:

**Backend (`polytrade-be`):**
```
Root Directory: (empty - handled by root railpack.json)
Build Command: (empty - handled by backend/railpack.json)
Start Command: (empty - handled by backend/railpack.json)
Config File: backend/railpack.json
```

**Frontend (`polytrade-fe`):**
```
Root Directory: (empty - handled by root railpack.json)
Build Command: (empty - handled by frontend/railpack.json)
Start Command: (empty - handled by frontend/railpack.json)
Config File: frontend/railpack.json
```

**Python ML Worker (`ml-worker`):**
```
Root Directory: (empty - handled by root railpack.json)
Build Command: (empty - handled by python-services/poloniex/railpack.json)
Start Command: (empty - handled by python-services/poloniex/railpack.json)
Config File: python-services/poloniex/railpack.json
```

---

## Key Differences from Problematic Projects

| Aspect | Other Projects | This Project |
|--------|---------------|--------------|
| Root config | Mixed providers | Pure service definitions |
| Python setup | Manual or missing | Automated venv creation |
| Path references | Absolute /app paths | Relative service paths |
| Install commands | Complex with cd | Clean and direct |
| Entry points | Hardcoded | Configurable via railpack |
| Dependencies | Missing inputs | Proper step dependencies |

---

## Verification Commands

### Local Build Test

**Backend:**
```bash
cd backend
yarn install --immutable
yarn workspace backend run build:railway
node dist/index.js  # Should fail on missing env vars (expected)
```

**Frontend:**
```bash
cd frontend
yarn install --immutable
node prebuild.mjs
vite build
node serve.js  # Should start serving
```

**Python:**
```bash
cd python-services/poloniex
python -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn health:app --host 0.0.0.0 --port 8000
```

---

## Summary of Fixes

### Changes Made in This PR:

1. **Python service (python-services/poloniex/railpack.json)**
   - ✅ Added install steps with venv creation
   - ✅ Fixed start command to use relative path
   - ✅ Corrected module reference from `main:app` to `health:app`
   - ✅ Added deploy inputs to reference install step

2. **Frontend service (frontend/railpack.json)**
   - ✅ Removed unnecessary `cd /app &&` commands
   - ✅ Changed `--frozen-lockfile` to `--immutable`
   - ✅ Added deploy inputs to reference build step

3. **Backend service (backend/railpack.json)**
   - ✅ Previously fixed: startCommand path
   - ✅ Already has proper install and build steps

### No Changes Needed:

- ✅ Root railpack.json already correct
- ✅ Python version consistency already good
- ✅ Requirements.txt location already correct
- ✅ Health check endpoints already configured

---

## Expected Railway Build Logs

### Python Service
```
Installing dependencies...
  $ python -m venv .venv
  $ .venv/bin/pip install --upgrade pip
  Requirement already satisfied: pip in ./.venv/lib/python3.13/site-packages (24.2)
  $ .venv/bin/pip install -r requirements.txt
  Collecting uvicorn[standard]>=0.30.0
  ...
  Successfully installed [packages]

Starting deployment...
  $ .venv/bin/python -m uvicorn health:app --host 0.0.0.0 --port $PORT
  INFO:     Started server process [1]
  INFO:     Waiting for application startup.
  INFO:     Application startup complete.
  INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Frontend Service
```
Installing dependencies...
  $ npm i -g corepack@latest
  $ corepack enable
  $ corepack prepare yarn@4.9.2 --activate
  $ yarn install --immutable

Building...
  $ node prebuild.mjs
  $ vite build
  Building for production...
  ✓ built in 2.34s

Starting deployment...
  $ node serve.js
  Server listening on port 3000
```

### Backend Service
```
Installing dependencies...
  $ npm i -g corepack@latest
  $ corepack enable
  $ corepack prepare yarn@4.9.2 --activate
  $ yarn install --immutable

Building...
  $ yarn workspace backend run build:railway
  === Build output verification ===
  dist/index.js
  ...

Starting deployment...
  $ node dist/index.js
  Backend server listening on port 8765
```

---

## References

- [Railway Railpack Schema](https://schema.railpack.com)
- [Railway Service Roots](https://docs.railway.app/guides/monorepos)
- [Python venv Documentation](https://docs.python.org/3/library/venv.html)
- [Yarn 4.x CLI](https://yarnpkg.com/cli)

---

**Last Updated:** 2025-10-25
**Project:** Poloniex Trading Platform
**Status:** ✅ All critical issues resolved
