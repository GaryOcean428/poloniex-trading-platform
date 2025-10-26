# Railway Railpack Deployment Cheatsheet 2025

## Poloniex Trading Platform - Verified Configuration

This cheatsheet is specifically tailored for the **Poloniex Trading Platform** monorepo deployment to Railway using Railpack v1.

**Project Structure:**
```
polytrade/
├── railpack.json                           # ✅ Root coordination
├── frontend/                               # React 19 + Vite
│   ├── railpack.json
│   ├── package.json
│   ├── yarn.lock
│   └── serve.js                           # Production static server
├── backend/                                # Node.js + Express
│   ├── railpack.json
│   ├── package.json
│   ├── yarn.lock
│   └── dist/                              # TypeScript build output
└── python-services/poloniex/              # Python 3.13.2 + FastAPI
    ├── railpack.json
    └── requirements.txt
```

---

## Technology Stack Standards

| Technology | Version | Package Manager | Build System |
|-----------|---------|----------------|--------------|
| Node.js | 20.x LTS | Yarn 4.9.2 (Corepack) | Railpack |
| Python | 3.13.2 | pip | Railpack |
| React | 19.x | Yarn 4.9.2 | Vite |
| TypeScript | 5.9+ | Yarn 4.9.2 | tsc |
| Yarn | 4.9.2 | Corepack | N/A |

---

## Golden Rules ⚡

1. ✅ **ALWAYS** use `railpack.json` as the single source of truth
2. ✅ **ALWAYS** bind to `0.0.0.0` (never `localhost` or `127.0.0.1`)
3. ✅ **ALWAYS** use `process.env.PORT` or `$PORT` (never hardcode ports)
4. ✅ **ALWAYS** include health check endpoint (`/api/health` for backend, `/healthz` for frontend)
5. ✅ **ALWAYS** commit service-specific lockfiles (`frontend/yarn.lock`, `backend/yarn.lock`)
6. ❌ **NEVER** use Dockerfile, railway.toml, or nixpacks.toml with railpack.json
7. ❌ **NEVER** reference another service's PORT (use `RAILWAY_PUBLIC_DOMAIN` or `RAILWAY_PRIVATE_DOMAIN`)
8. ❌ **NEVER** commit secrets to railpack.json (use Railway environment variables)
9. ❌ **NEVER** nest `provider` or `steps` under `build` object (must be at root level)
10. ❌ **NEVER** use unsupported fields like `version`, `metadata`, `healthCheckPath`, `restartPolicyType` in railpack.json

---

## Railway Service Configuration

### Service Matrix

| Service | Railway Service ID | Root Directory | Config File | Port Range | Health Endpoint |
|---------|-------------------|----------------|-------------|------------|-----------------|
| polytrade-fe | c81963d4-f110-49cf-8dc0-311d1e3dcf7e | `./frontend` | `frontend/railpack.json` | 5675-5699 | `/healthz`, `/` |
| polytrade-be | e473a919-acf9-458b-ade3-82119e4fabf6 | `./backend` | `backend/railpack.json` | 8765-8799 | `/api/health` |
| ml-worker | 86494460-6c19-4861-859b-3f4bd76cb652 | `./python-services/poloniex` | `python-services/poloniex/railpack.json` | 9080-9099 | `/health` |

### Critical Railway UI Settings

For each service in Railway Dashboard:

1. **Root Directory**: Set to service-specific path (see table above)
2. **Build Command**: Leave empty (handled by railpack.json)
3. **Install Command**: Leave empty (handled by railpack.json)
4. **Start Command**: Leave empty (handled by railpack.json)
5. **Health Check Path**: Configure in Railway UI (not in railpack.json)
   - Frontend: `/healthz` or `/`
   - Backend: `/api/health`
   - Python: `/health`
6. **Health Check Timeout**: 300 seconds (recommended for backend)

---

## Environment Variables

### Automatically Provided by Railway

```bash
PORT                          # Randomly assigned by Railway
RAILWAY_ENVIRONMENT           # production, staging, development
RAILWAY_SERVICE_NAME          # Your service name
RAILWAY_PUBLIC_DOMAIN         # Public URL (if exposed)
RAILWAY_PRIVATE_DOMAIN        # Internal networking URL
RAILWAY_GIT_BRANCH            # Current git branch
RAILWAY_GIT_COMMIT_SHA        # Current commit SHA
RAILWAY_DEPLOYMENT_ID         # Unique deployment ID
```

### Service-to-Service Communication

```bash
# Frontend → Backend (public)
BACKEND_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}

# Backend → Frontend (for CORS)
FRONTEND_URL=https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}

# Backend → ML Worker (private, internal only)
ML_WORKER_URL=http://${{ml-worker.RAILWAY_PRIVATE_DOMAIN}}
```

### Required Environment Variables

**Frontend Service (polytrade-fe):**
```bash
PORT=${{PORT}}                # Auto-provided
NODE_ENV=production
VITE_API_URL=${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
```

**Backend Service (polytrade-be):**
```bash
PORT=${{PORT}}                # Auto-provided
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<generate-secure-secret>
FRONTEND_URL=${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}
CORS_ORIGIN=${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}
```

**Python Service (ml-worker):**
```bash
PORT=${{PORT}}                # Auto-provided
PYTHONUNBUFFERED=1
BACKEND_URL=${{polytrade-be.RAILWAY_PRIVATE_DOMAIN}}
```

---

## Verified Railpack Configurations

### Frontend Service (`frontend/railpack.json`)

**Current Working Configuration:**
```json
{
  "$schema": "https://schema.railpack.com",
  "provider": "node",
  "packages": {
    "node": "20",
    "yarn": "4.9.2"
  },
  "steps": {
    "install": {
      "commands": [
        "npm i -g corepack@latest",
        "corepack enable",
        "corepack prepare yarn@4.9.2 --activate",
        "cd /app && yarn install --immutable --immutable-cache"
      ]
    },
    "build": {
      "commands": [
        "node prebuild.mjs",
        "vite build",
        "rm -rf .shared-build"
      ],
      "inputs": [{"step": "install"}]
    }
  },
  "deploy": {
    "startCommand": "node serve.js",
    "inputs": [{"step": "build"}]
  }
}
```

**Key Points:**
- Uses Corepack to manage Yarn 4.9.2
- Runs prebuild script to bundle shared dependencies
- Vite build creates optimized production bundle
- Custom `serve.js` serves static files with proper caching
- Health check at `/healthz` with comprehensive validation

### Backend Service (`backend/railpack.json`)

**Current Working Configuration:**
```json
{
  "$schema": "https://schema.railpack.com",
  "provider": "node",
  "packages": {
    "node": "20",
    "yarn": "4.9.2"
  },
  "steps": {
    "install": {
      "commands": [
        "npm i -g corepack@latest",
        "corepack enable",
        "corepack prepare yarn@4.9.2 --activate",
        "cd /app && yarn install --immutable --immutable-cache"
      ]
    },
    "build": {
      "commands": [
        "node prebuild.mjs",
        "rm -rf dist",
        "tsc -p tsconfig.build.json",
        "rm -rf .shared-build"
      ],
      "inputs": [{"step": "install"}]
    }
  },
  "deploy": {
    "startCommand": "node backend/dist/src/index.js",
    "healthCheckPath": "/api/health",
    "healthCheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**Key Points:**
- TypeScript compilation to `dist/` directory
- Prebuild script bundles shared dependencies
- Start command points to compiled `dist/src/index.js`
- Health check at `/api/health` endpoint
- Restart policy for automatic recovery

**⚠️ Note on Health Check Fields:**
The fields `healthCheckPath`, `healthCheckTimeout`, `restartPolicyType`, and `restartPolicyMaxRetries` are shown in the current configuration but may not be part of the official Railpack schema. They might be Railway-specific settings that should be configured in the Railway UI instead.

### Python Service (`python-services/poloniex/railpack.json`)

**Current Working Configuration:**
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
        "python -m venv .venv",
        ".venv/bin/pip install --upgrade pip",
        ".venv/bin/pip install -r requirements.txt"
      ]
    }
  },
  "deploy": {
    "startCommand": "/app/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port $PORT",
    "inputs": [{"step": "install"}]
  }
}
```

**Key Points:**
- Python 3.13.2 (exact version, not 3.13+)
- Virtual environment in `.venv`
- Uvicorn serves FastAPI on `0.0.0.0:$PORT`
- Health check at `/health` endpoint

---

## Port Binding Patterns

### Frontend (`frontend/serve.js`)

```javascript
import http from 'http';

const PORT = parseInt(process.env.PORT || '5675', 10);
const HOST = '0.0.0.0';

const server = http.createServer((req, res) => {
  // ... request handling
});

server.listen(PORT, HOST, () => {
  console.log(`🚀 Static server listening on http://${HOST}:${PORT}`);
});
```

### Backend (Express)

```javascript
import express from 'express';

const app = express();
const PORT = process.env.PORT || 8765;

app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend API listening on port ${PORT}`);
});
```

### Python (FastAPI + Uvicorn)

```python
from fastapi import FastAPI
import uvicorn
import os

app = FastAPI()

@app.get("/health")
@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": os.getenv("RAILWAY_SERVICE_NAME"),
        "environment": os.getenv("RAILWAY_ENVIRONMENT")
    }

if __name__ == "__main__":
    port = int(os.getenv("PORT", 9080))
    uvicorn.run(app, host="0.0.0.0", port=port)
```

---

## Health Check Implementation

### Frontend Health Check (`frontend/serve.js`)

```javascript
// Enhanced health check at /healthz and /api/health
if (reqPath === '/api/health' || reqPath === '/healthz') {
  const healthResult = await healthChecker.runComprehensiveCheck();
  
  res.statusCode = healthResult.httpStatus;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  return res.end(JSON.stringify(healthResult.response, null, 2));
}
```

**Health Check Components:**
- ✅ Validates dist folder exists
- ✅ Checks index.html and assets present
- ✅ Verifies critical dependencies loaded
- ✅ Returns comprehensive status with components

### Backend Health Check

```javascript
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'production',
    service: process.env.RAILWAY_SERVICE_NAME
  });
});
```

### Python Health Check

```python
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": os.getenv("RAILWAY_SERVICE_NAME"),
        "environment": os.getenv("RAILWAY_ENVIRONMENT"),
        "timestamp": datetime.now().isoformat()
    }
```

---

## Monorepo Build Process

### Workspace Structure

```json
// Root package.json
{
  "workspaces": [
    "frontend",
    "backend"
  ],
  "scripts": {
    "build:frontend": "yarn bundle:shared && yarn workspace frontend build",
    "build:backend": "yarn bundle:shared && yarn workspace backend build",
    "bundle:shared": "node scripts/bundle-shared.mjs"
  }
}
```

### Shared Dependencies Pattern

Both frontend and backend use a `prebuild.mjs` script to bundle shared code:

```javascript
// prebuild.mjs (in both frontend and backend)
import { bundleSharedDeps } from '../scripts/bundle-shared.mjs';

bundleSharedDeps({
  sourceDir: '../shared',
  targetDir: './.shared-build',
  serviceType: 'frontend' // or 'backend'
});
```

This ensures shared code is properly bundled before the service-specific build.

---

## Common Issues & Solutions

### Issue 1: "Install inputs must be an image or step input"

**Symptom:**
```
Error: Install inputs must be an image or step input
```

**Cause:** Invalid railpack.json schema with local inputs in install step

**Solution:**
Remove any `inputs` from the `install` step. Install steps should not have inputs:

```json
{
  "steps": {
    "install": {
      "commands": ["yarn install --immutable"]
      // ❌ NO inputs here
    },
    "build": {
      "commands": ["yarn build"],
      "inputs": [{"step": "install"}]  // ✅ Build can reference install
    }
  }
}
```

### Issue 2: "No project found in /app"

**Symptom:**
```
Error: No project found in /app
```

**Cause:** Wrong Root Directory in Railway UI

**Solution:**
1. Go to Railway service settings
2. Set Root Directory to service-specific path:
   - Frontend: `./frontend`
   - Backend: `./backend`
   - Python: `./python-services/poloniex`

### Issue 3: Health Check Timeout

**Symptom:**
```
Health check failed: timeout after 120 seconds
```

**Solutions:**

1. **Increase timeout in Railway UI:**
   - Settings → Health Check Timeout → 300 seconds

2. **Optimize startup time:**
   ```javascript
   // Lazy load heavy dependencies
   app.get('/api/heavy', async (req, res) => {
     const heavyModule = await import('./heavy-module.js');
     // ...
   });
   ```

3. **Add readiness check:**
   ```javascript
   let isReady = false;
   
   app.get('/api/health', (req, res) => {
     if (isReady) {
       res.status(200).json({ status: 'ready' });
     } else {
       res.status(503).json({ status: 'starting' });
     }
   });
   
   // Set ready after initialization
   initializeApp().then(() => {
     isReady = true;
   });
   ```

### Issue 4: "Application failed to respond"

**Cause:** Not binding to `0.0.0.0` or not using `$PORT`

**Fix:**
```javascript
// ❌ WRONG
app.listen(3000);                    // Hardcoded port
app.listen(PORT, 'localhost');       // Wrong host
app.listen(process.env.PORT || 3000, '127.0.0.1'); // Localhost

// ✅ CORRECT
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on ${PORT}`);
});
```

### Issue 5: Frontend Blank Page

**Symptom:**
Frontend loads but shows blank page

**Causes & Solutions:**

1. **Asset caching issues:**
   ```javascript
   // In serve.js - ensure proper cache headers
   if (filePath.endsWith('.html')) {
     res.setHeader('Cache-Control', 'no-store');
   } else if (filePath.includes('/assets/')) {
     res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
   }
   ```

2. **Missing environment variables:**
   ```bash
   # Set in Railway UI
   VITE_API_URL=${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
   ```

3. **SPA routing issues:**
   ```javascript
   // In serve.js - ensure SPA fallback
   // For non-asset routes, fallback to index.html
   if (!reqPath.startsWith('/assets/') && !existsSafe(staticPath)) {
     const indexPath = path.join(DIST_ROOT, 'index.html');
     if (existsSafe(indexPath)) {
       return serveFile(res, indexPath);
     }
   }
   ```

### Issue 6: TypeScript Build Fails

**Symptom:**
```
error TS2307: Cannot find module '@shared/types'
```

**Cause:** Shared dependencies not bundled

**Solution:**
Ensure prebuild script runs before TypeScript compilation:

```json
{
  "steps": {
    "build": {
      "commands": [
        "node prebuild.mjs",        // Bundle shared deps first
        "rm -rf dist",
        "tsc -p tsconfig.build.json",
        "rm -rf .shared-build"      // Cleanup after build
      ]
    }
  }
}
```

---

## Validation & Testing

### Pre-Deployment Validation

```bash
# 1. Validate railpack.json syntax
jq empty frontend/railpack.json && echo "✅ Frontend railpack.json valid"
jq empty backend/railpack.json && echo "✅ Backend railpack.json valid"
jq empty python-services/poloniex/railpack.json && echo "✅ Python railpack.json valid"

# 2. Check for hardcoded ports
grep -r "listen(3000" frontend/ backend/ && echo "❌ Found hardcoded port" || echo "✅ No hardcoded ports"
grep -r "localhost" frontend/ backend/ && echo "❌ Found localhost binding" || echo "✅ No localhost binding"

# 3. Verify lockfiles are tracked
git ls-files frontend/yarn.lock backend/yarn.lock | wc -l | grep "2" && echo "✅ Lockfiles tracked"

# 4. Test health endpoints locally
curl -f http://localhost:5675/healthz && echo "✅ Frontend health OK"
curl -f http://localhost:8765/api/health && echo "✅ Backend health OK"
```

### Local Testing with Railway Environment

```bash
#!/bin/bash
# test-railway-local.sh

export PORT=8000
export RAILWAY_ENVIRONMENT=development
export RAILWAY_SERVICE_NAME=test-service
export NODE_ENV=production
export PYTHONUNBUFFERED=1

# Start backend
cd backend && yarn start &
BACKEND_PID=$!

# Wait for startup
sleep 5

# Test health endpoint
curl -f http://localhost:8000/api/health || echo "Health check failed"

# Cleanup
kill $BACKEND_PID
```

---

## Deployment Workflow

### Step-by-Step Deployment

1. **Pre-deployment checks:**
   ```bash
   yarn railway:validate    # Run validation script
   yarn lint               # Ensure code quality
   yarn test:run          # Run tests
   ```

2. **Commit changes:**
   ```bash
   git add .
   git commit -m "feat: your changes"
   git push origin main
   ```

3. **Monitor Railway deployment:**
   - Watch build logs for "Successfully prepared Railpack plan"
   - Verify each build step completes
   - Check health endpoints after deployment

4. **Post-deployment verification:**
   ```bash
   # Test each service
   curl https://polytrade-fe-production.railway.app/healthz
   curl https://polytrade-be-production.railway.app/api/health
   curl https://ml-worker-production.railway.app/health
   ```

---

## Performance Optimization

### 1. Build Caching

```json
{
  "steps": {
    "install": {
      "commands": ["yarn install --immutable"],
      "cache": {
        "paths": ["node_modules", ".yarn/cache"]
      }
    }
  }
}
```

### 2. Frontend Asset Optimization

```javascript
// vite.config.ts
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts', 'chart.js', 'react-chartjs-2'],
          utils: ['zustand', 'axios', 'socket.io-client']
        }
      }
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true
      }
    }
  }
}
```

### 3. Backend Build Optimization

```json
{
  "steps": {
    "build": {
      "commands": [
        "node prebuild.mjs",
        "rm -rf dist",
        "tsc -p tsconfig.build.json --incremental false --sourceMap false --removeComments true",
        "node scripts/flatten-dist.mjs",
        "rm -rf .shared-build"
      ]
    }
  }
}
```

---

## Security Best Practices

### 1. Environment Variables Security

```bash
# ✅ DO: Use Railway secret variables
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=${{shared.JWT_SECRET}}

# ❌ DON'T: Commit secrets
{
  "deploy": {
    "variables": {
      "API_KEY": "sk_live_abc123"  // ❌ NEVER DO THIS
    }
  }
}
```

### 2. CORS Configuration

```javascript
import cors from 'cors';

const allowedOrigins = [
  process.env.FRONTEND_URL,
  `https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}`
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
```

### 3. Validate Required Environment Variables

```javascript
// config.ts
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'FRONTEND_URL'
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required env var: ${envVar}`);
  }
}
```

---

## Railway CLI Commands

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link to project
railway link

# Run command with Railway environment
railway run yarn dev

# Deploy manually
railway up

# View logs
railway logs

# Open service in browser
railway open

# Set environment variable
railway variables set KEY=value

# Check service status
railway status
```

---

## Troubleshooting Checklist

When deployment fails, check in this order:

1. ✅ **railpack.json syntax**: `jq empty */railpack.json`
2. ✅ **No conflicting configs**: Ensure no Dockerfile, railway.toml, nixpacks.toml
3. ✅ **Port binding**: Search code for `localhost`, `127.0.0.1`, hardcoded ports
4. ✅ **Health endpoint**: Verify endpoint exists and returns 200
5. ✅ **Root Directory**: Verify set correctly in Railway UI for each service
6. ✅ **Environment variables**: Check Railway dashboard variables tab
7. ✅ **Build logs**: Read complete Railway build logs for errors
8. ✅ **Start command**: Verify command matches your compiled output
9. ✅ **Dependencies**: Check lockfiles are present and tracked
10. ✅ **Test locally**: Run with Railway environment variables set

---

## Success Criteria

Before marking deployment as production-ready:

- [ ] All services deploy successfully on Railway
- [ ] Health checks return 200 status consistently for 5+ minutes
- [ ] Services accessible via Railway public domains
- [ ] All environment variables properly configured
- [ ] Inter-service communication works (frontend → backend → ML)
- [ ] No errors in deployment logs
- [ ] Services auto-restart on failure
- [ ] Performance is acceptable (response times < 500ms)
- [ ] Logs are structured and informative
- [ ] Security best practices followed (no secrets in code)
- [ ] CORS configured correctly
- [ ] Asset caching working properly

---

## Quick Reference Cards

### Frontend Service Quick Ref

```
Service: polytrade-fe
Root: ./frontend
Port: 5675 (local), $PORT (Railway)
Health: /healthz, /api/health
Build: Vite → dist/
Start: node serve.js
Tech: React 19, TypeScript, Vite
```

### Backend Service Quick Ref

```
Service: polytrade-be
Root: ./backend
Port: 8765 (local), $PORT (Railway)
Health: /api/health
Build: TypeScript → dist/
Start: node backend/dist/src/index.js
Tech: Node.js, Express, TypeScript
```

### Python Service Quick Ref

```
Service: ml-worker
Root: ./python-services/poloniex
Port: 9080 (local), $PORT (Railway)
Health: /health
Build: pip install -r requirements.txt
Start: uvicorn main:app --host 0.0.0.0 --port $PORT
Tech: Python 3.13.2, FastAPI, Uvicorn
```

---

## Additional Resources

- **Railway Documentation**: https://docs.railway.com
- **Railpack Specification**: https://railway.com/railpack
- **Official Schema**: https://schema.railpack.com
- **Railway CLI**: https://docs.railway.com/develop/cli
- **Railway Discord**: https://discord.gg/railway
- **Project Repository**: https://github.com/GaryOcean428/poloniex-trading-platform

---

**Version:** 2025.1 (Polytrade-Specific)  
**Last Updated:** October 2025  
**Maintained for:** Railway + Railpack v1 + Yarn 4.9.2 + React 19 + Node 20 + Python 3.13.2
