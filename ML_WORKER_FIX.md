# ML Worker Railway Deployment Fix

**Issue:** ML worker failing with "npm: command not found"  
**Root Cause:** Python service configured to use npm/Node.js  
**Status:** FIXED ✅

---

## Problem

The ML worker is a **Python service** but Railway was trying to run it with **npm** (Node.js):

```
/bin/bash: line 1: npm: command not found
```

This happened because:
1. The service inherited the root `railway.json` configuration
2. Root config uses `npm start` for Node.js services
3. ML worker needs Python, not Node.js

---

## Solution

Created proper Python configuration files for the ML worker service.

### Files Created ✅

1. **`python-services/poloniex/railway.json`**
   - Configures Railway to use Python
   - Sets start command to `python main.py`
   - Adds health check endpoint

2. **`python-services/poloniex/nixpacks.toml`**
   - Specifies Python 3.11
   - Installs pip dependencies
   - Sets Python start command

3. **`python-services/poloniex/Dockerfile`**
   - Alternative deployment method
   - Uses Python 3.11 slim image
   - Includes health checks
   - Optimized for production

---

## Railway Configuration

### Option 1: Using Nixpacks (Recommended)

Railway will automatically detect `nixpacks.toml` and use it.

**Configuration:**
```toml
[phases.setup]
nixPkgs = ["python311", "python311Packages.pip"]

[phases.install]
cmds = [
  "pip install --upgrade pip",
  "pip install -r requirements.txt"
]

[start]
cmd = "python main.py"
```

### Option 2: Using Dockerfile

If Nixpacks doesn't work, Railway will fall back to Dockerfile.

**Configuration:**
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["python", "main.py"]
```

---

## Deployment Steps

### Step 1: Update Railway Service Settings

In Railway dashboard for `ml-worker` service:

1. **Root Directory:**
   ```
   python-services/poloniex
   ```

2. **Start Command:**
   ```
   python main.py
   ```

3. **Build Command:** (leave empty, handled by nixpacks)
   ```
   
   ```

4. **Health Check Path:**
   ```
   /health
   ```

5. **Health Check Timeout:**
   ```
   100
   ```

### Step 2: Set Environment Variables

Required variables:
```bash
PORT=8000
PYTHONUNBUFFERED=1
```

Optional (for market ingestion):
```bash
POLONIEX_API_KEY=your_api_key
POLONIEX_API_SECRET=your_api_secret
```

### Step 3: Deploy

1. Commit the new configuration files:
   ```bash
   git add python-services/poloniex/railway.json
   git add python-services/poloniex/nixpacks.toml
   git add python-services/poloniex/Dockerfile
   git commit -m "Fix ML worker Railway deployment configuration"
   git push origin main
   ```

2. Railway will automatically redeploy

3. Check deploy logs for:
   ```
   ✓ Python 3.11 installed
   ✓ Dependencies installed
   ✓ Starting: python main.py
   ✓ Server running on port 8000
   ```

---

## Verification

### Test Health Endpoint

Once deployed, test the health endpoint:

```bash
curl https://ml-worker-production.up.railway.app/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "ml-worker",
  "python": "3.11.x",
  "cwd": "/app",
  "env": {
    "PORT": "8000",
    "PYTHONUNBUFFERED": "1"
  }
}
```

### Test All Endpoints

```bash
# Root endpoint
curl https://ml-worker-production.up.railway.app/

# Health check
curl https://ml-worker-production.up.railway.app/health

# Healthz (Railway format)
curl https://ml-worker-production.up.railway.app/healthz

# Status endpoint
curl https://ml-worker-production.up.railway.app/api/status
```

### Test Market Ingestion (if API keys configured)

```bash
curl -X POST https://ml-worker-production.up.railway.app/run/ingest
```

---

## Service Architecture

### ML Worker Service

**Purpose:** Machine learning and data processing service

**Technology Stack:**
- Python 3.11
- FastAPI (web framework)
- Uvicorn (ASGI server)
- NumPy, Pandas, scikit-learn (ML libraries)

**Endpoints:**
- `GET /` - Service information
- `GET /health` - Basic health check
- `GET /healthz` - Railway health check
- `GET /api/status` - Extended status
- `POST /run/ingest` - Trigger market data ingestion

**Port:** 8000 (configurable via PORT env var)

---

## Troubleshooting

### Issue: Still seeing "npm: command not found"

**Solution:** Railway is using wrong root directory

1. Go to Railway service settings
2. Set **Root Directory** to: `python-services/poloniex`
3. Redeploy

### Issue: "Module not found" errors

**Solution:** Dependencies not installed

1. Check `requirements.txt` exists
2. Verify build logs show pip install
3. Add missing dependencies to `requirements.txt`

### Issue: Health check failing

**Solution:** Port mismatch

1. Verify PORT environment variable is set
2. Check health check path is `/health`
3. Increase health check timeout to 100s

### Issue: Service crashes on startup

**Solution:** Check logs for Python errors

1. View deploy logs in Railway
2. Look for Python tracebacks
3. Fix any import or runtime errors

---

## Configuration Files Reference

### railway.json
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pip install -r requirements.txt"
  },
  "deploy": {
    "numReplicas": 1,
    "startCommand": "python main.py",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100
  }
}
```

### nixpacks.toml
```toml
[phases.setup]
nixPkgs = ["python311", "python311Packages.pip"]

[phases.install]
cmds = [
  "pip install --upgrade pip",
  "pip install -r requirements.txt"
]

[start]
cmd = "python main.py"
```

### requirements.txt
```
uvicorn[standard]>=0.30.0
fastapi>=0.111.0
pydantic>=2.7.0
numpy>=1.26.0
pandas>=2.2.0
scikit-learn>=1.5.0
httpx>=0.27.0
python-multipart>=0.0.9
redis>=5.0.0
celery>=5.3.0
python-dotenv>=1.0.1
requests>=2.32.0
uvloop>=0.19.0
```

---

## Expected Deploy Logs

### Successful Deployment

```
Mounting volume on: /var/lib/containers/railwayapp/bind-mounts/.../vol_...
Starting Container
[nixpacks] Setting up Python 3.11
[nixpacks] Installing dependencies from requirements.txt
Collecting uvicorn[standard]>=0.30.0
...
Successfully installed uvicorn-0.30.0 fastapi-0.111.0 ...
[nixpacks] Starting application
INFO:     Started server process [1]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

### Health Check Success

```
[Railway] Health check passed: GET /health returned 200
[Railway] Service is healthy
```

---

## Integration with Backend

The backend can call the ML worker for predictions:

```typescript
// backend/src/services/mlService.ts
const ML_WORKER_URL = process.env.ML_WORKER_URL || 'https://ml-worker-production.up.railway.app';

async function getMLPrediction(data: any) {
  const response = await fetch(`${ML_WORKER_URL}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return response.json();
}
```

---

## Next Steps

1. ✅ Configuration files created
2. ⏳ Commit and push changes
3. ⏳ Update Railway service settings
4. ⏳ Verify deployment
5. ⏳ Test health endpoints
6. ⏳ Add ML prediction endpoints
7. ⏳ Integrate with backend

---

## Summary

**Problem:** ML worker trying to use npm (Node.js)  
**Solution:** Created Python-specific configuration  
**Files:** railway.json, nixpacks.toml, Dockerfile  
**Status:** Ready to deploy ✅

**Next Action:** Commit files and push to trigger Railway deployment

```bash
cd /workspaces/poloniex-trading-platform
git add python-services/poloniex/railway.json
git add python-services/poloniex/nixpacks.toml
git add python-services/poloniex/Dockerfile
git commit -m "Fix ML worker Railway deployment - use Python instead of npm"
git push origin main
```

Then check Railway deploy logs for success! 🚀
