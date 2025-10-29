# Railway Port Configuration Guide

## Issue Summary

The backend service was experiencing 502 Bad Gateway errors due to a port mismatch between the service configuration and Railway's domain routing.

## Root Cause

**Port Mismatch**: Backend was listening on a different port than what Railway's domain configuration expected, causing the Railway proxy to be unable to route traffic to the backend service.

## Solution Overview

The backend code has been updated to include:

1. **Enhanced Environment Validation**: Detailed logging of all configuration parameters
2. **Process Stability**: Proper error handlers for unhandled rejections and exceptions
3. **Graceful Shutdown**: SIGTERM and SIGINT handlers for clean shutdowns
4. **Production Monitoring**: Heartbeat logging every 60 seconds in production
5. **Structured Logging**: Better observability with JSON-formatted logs

## Railway Configuration Requirements

### Backend Service (polytrade-be)

#### Required Environment Variables

```bash
# Core Configuration
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<secure-random-string-32-chars-min>

# Service Communication
FRONTEND_URL=https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}
FRONTEND_STANDALONE=true

# Optional but Recommended
API_ENCRYPTION_KEY=<secure-random-string-32-chars-min>
CORS_ALLOWED_ORIGINS=https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}

# Poloniex API (for live trading)
POLONIEX_API_KEY=<your-api-key>
POLONIEX_API_SECRET=<your-api-secret>
```

#### Railway Service Settings

**CRITICAL**: Railway automatically sets the `PORT` environment variable. **DO NOT** manually set `PORT` in the environment variables.

✅ **Correct Configuration**:
- Let Railway automatically assign PORT (typically 3000)
- Backend code reads `process.env.PORT` with fallback to 8765
- Domain configuration should match the PORT Railway assigns

❌ **Incorrect Configuration**:
- Manually setting PORT=8080 in Railway UI
- Hardcoding port numbers in code
- Domain pointing to different port than service listens on

#### Domain Configuration

The backend domain should automatically route to the port where the service is listening. Railway handles this automatically when:

1. Service binds to `process.env.PORT`
2. Service binds to `0.0.0.0` (not `localhost` or `127.0.0.1`)
3. No manual PORT override is set in environment variables

### Frontend Service (polytrade-fe)

#### Required Environment Variables

```bash
# Backend Communication
VITE_BACKEND_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
VITE_WS_URL=wss://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}

# Optional
VITE_API_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
```

## Backend Code Configuration

The backend is correctly configured to:

### 1. Use Railway PORT Environment Variable

```typescript
// backend/src/config/env.ts
const PORT = parseInt(process.env.PORT || '8765', 10);
```

### 2. Bind to 0.0.0.0 (Railway Requirement)

```typescript
// backend/src/index.ts
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
});
```

### 3. Enhanced Logging for Debugging

```typescript
// Environment validation logging
logger.info('Environment validation passed', {
  NODE_ENV,
  PORT,
  FRONTEND_URL: FRONTEND_URL || 'not set',
  HAS_DATABASE: !!DATABASE_URL,
  HAS_JWT_SECRET: !!JWT_SECRET,
  // ... more config details
});

// Startup logging
logger.info(`✅ Backend startup complete`, {
  port: PORT,
  env: process.env.NODE_ENV || 'development',
  timestamp: new Date().toISOString(),
  nodeVersion: process.version,
  platform: process.platform
});
```

### 4. Production Heartbeat Monitoring

```typescript
// Production health monitoring
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    logger.info('💓 Backend heartbeat', {
      uptime: Math.floor(process.uptime()),
      memory: { /* memory stats */ },
      timestamp: new Date().toISOString()
    });
  }, 60000); // Every 60 seconds
}
```

### 5. Process Error Handlers

```typescript
// Unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection:', { reason, promise });
});

// Uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => process.exit(0));
});
```

## Verification Steps

### 1. Check Backend Logs

After deployment, check the Railway logs for:

```
✅ Expected Log Messages:
- "Environment validation passed" with JSON configuration details
- "Backend startup complete" with port, env, nodeVersion
- "Server running on port <PORT>" (should match Railway's assigned PORT)
- "Socket.IO server initialized"

❌ Error Patterns to Watch For:
- "Port must be a valid port number" - Port configuration issue
- "Environment validation failed" - Missing required env vars
- "EADDRINUSE" - Port already in use (rare on Railway)
```

### 2. Test Health Endpoints

```bash
# Test backend health
curl -I https://polytrade-be.up.railway.app/api/health

# Expected Response:
HTTP/2 200
content-type: application/json; charset=utf-8

# Should return:
{
  "status": "healthy",
  "timestamp": "2025-10-29T...",
  "environment": "production"
}
```

### 3. Test Frontend Connectivity

```bash
# Test frontend can reach backend
curl -I https://polytrade-fe.up.railway.app

# Expected Response:
HTTP/2 200

# Check browser console - should NOT see:
- 502 Bad Gateway errors
- WebSocket connection failures (if backend is healthy)
- CORS errors (unless backend is unhealthy)
```

## Troubleshooting

### Issue: 502 Bad Gateway

**Symptoms**: 
- Frontend can't connect to backend
- Backend health check returns 502

**Possible Causes**:
1. Backend crashed after startup
2. Port mismatch between service and domain
3. Backend not binding to 0.0.0.0

**Debug Steps**:
```bash
# Check Railway logs
railway logs --service polytrade-be --tail 100

# Look for:
1. Did backend start successfully?
2. What port is it listening on?
3. Are there any crash logs after startup?
4. Any unhandled exceptions or promise rejections?
```

**Solution**:
1. Verify no manual PORT env var is set in Railway UI
2. Check domain configuration in Railway dashboard
3. Ensure backend code binds to `0.0.0.0` not `localhost`
4. Check for runtime errors in logs

### Issue: Backend Crashes After Startup

**Symptoms**:
- Initial startup logs look good
- 502 errors appear within minutes
- No heartbeat logs in production

**Debug Steps**:
```bash
# Check for error patterns
railway logs --service polytrade-be | grep -i "error\|exception\|rejection"

# Common causes:
1. Database connection failures
2. Unhandled promise rejections
3. Memory issues
4. Missing environment variables accessed at runtime
```

**Solution**:
- All error handlers are now in place
- Check for database connectivity issues
- Verify all required env vars are set

### Issue: WebSocket Connection Failures

**Symptoms**:
- Frontend shows WebSocket connection errors
- Backend health check works

**Debug Steps**:
```bash
# Verify backend WebSocket configuration
railway logs --service polytrade-be | grep "Socket.IO"

# Check frontend environment variables
echo $VITE_WS_URL  # Should be wss:// not ws://
```

**Solution**:
- Ensure VITE_WS_URL uses `wss://` protocol for HTTPS
- Verify backend Socket.IO is initialized (check logs)
- Check CORS configuration allows frontend origin

## Production Checklist

Before deploying to production:

- [ ] Remove any manual PORT environment variable from Railway UI
- [ ] Verify DATABASE_URL is set via Railway Postgres plugin
- [ ] Set JWT_SECRET to secure random string (32+ characters)
- [ ] Set FRONTEND_URL to frontend domain reference
- [ ] Set API_ENCRYPTION_KEY (recommended)
- [ ] Set Poloniex API credentials (if using live trading)
- [ ] Verify domain configuration in Railway dashboard
- [ ] Test health endpoints after deployment
- [ ] Monitor logs for first 5 minutes after deployment
- [ ] Check for heartbeat logs every 60 seconds

## Railway Service Reference Variables

Use these in Railway UI for inter-service communication:

```bash
# Backend → Frontend
FRONTEND_URL=https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}

# Frontend → Backend
VITE_BACKEND_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
VITE_WS_URL=wss://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}

# Database
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

## Summary

The backend code is now **Railway-ready** with:

✅ Proper PORT environment variable handling  
✅ Enhanced logging for debugging  
✅ Process stability with error handlers  
✅ Graceful shutdown support  
✅ Production monitoring with heartbeats  
✅ Structured logging for observability  

**Action Required**: Ensure Railway UI configuration matches these requirements:
- No manual PORT override
- All required environment variables set
- Domain configuration correct
- Railway Postgres plugin attached
