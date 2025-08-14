# Railway Deployment Configuration

## Overview
This document outlines the Railway deployment configuration for the Polytrade platform, including environment variables, CORS settings, and WebSocket configuration.

## Railpack Configuration

All services use **Railpack** for build and deployment. **No railway.toml files should exist** in the project.

### Frontend Service (polytrade-fe)
- **Build & Deploy**: Handled by Railpack (railpack.json)
- **Start Command**: Empty (Railpack uses `deploy.command` from railpack.json)
- **Port**: Uses `$PORT` environment variable

### Backend Service (polytrade-be)
- **Build & Deploy**: Handled by Railpack (railpack.json)
- **Start Command**: Empty (Railpack uses `deploy.command` from railpack.json)
- **Port**: Uses `$PORT` environment variable (defaults to 8765 in development)

### ML Worker Service (ml-worker)
- **Build & Deploy**: Handled by Railpack (railpack.json)
- **Start Command**: Empty (Railpack uses `deploy.command` from railpack.json)
- **Port**: Uses `$PORT` environment variable (defaults to 8000 in development)

## Environment Variables

### Frontend (polytrade-fe)
```env
NODE_ENV=production
VITE_API_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
VITE_WS_URL=wss://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
VITE_BACKEND_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
```

### Backend (polytrade-be)
```env
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=your-super-secure-jwt-secret-change-this-in-production-2025
FRONTEND_URL=https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}
FRONTEND_STANDALONE=true
```

### ML Worker (ml-worker)
```env
NODE_ENV=production
POLONIEX_API_KEY=<your-api-key>
POLONIEX_API_SECRET=<your-api-secret>
API_INTERNAL_URL=http://${{polytrade-be.RAILWAY_PRIVATE_DOMAIN}}:${{polytrade-be.PORT}}
```

## CORS Configuration

The backend is configured to allow the following origins:
- `https://healthcheck.railway.app` (Railway health checks)
- `https://poloniex-trading-platform-production.up.railway.app` (Production frontend)
- `https://polytrade-be.up.railway.app` (Backend API)
- Dynamic Railway frontend domain from `RAILWAY_SERVICE_POLYTRADE_FE_URL`
- Value from `FRONTEND_URL` environment variable

CORS settings include:
- `credentials: true` (for cookie-based authentication)
- Methods: `GET`, `POST`
- Dynamic origin validation

## WebSocket Configuration

### Protocol Requirements
- **Production (HTTPS)**: Must use `wss://` protocol
- **Development (HTTP)**: Can use `ws://` protocol
- **Never mix**: HTTPS pages cannot connect to `ws://` (browser blocks this)

### Socket.IO Settings
- Transports: `['websocket', 'polling']` (both enabled for Railway compatibility)
- Ping timeout: 120 seconds
- Ping interval: 25 seconds
- Upgrade timeout: 30 seconds
- Max HTTP buffer size: 1MB

### Frontend WebSocket URL Resolution
Priority order:
1. Explicit `VITE_WS_URL` environment variable
2. Derived from `VITE_BACKEND_URL` (https:// → wss://, http:// → ws://)
3. Railway public domain from environment
4. Auto-detection based on window.location

## Security Considerations

### JWT Secret
- **MUST** be changed from default value
- Store in Railway environment variables only
- Never commit to code repository
- Use a strong, randomly generated secret (minimum 32 characters)

### API Keys
- Store Poloniex API credentials in Railway environment variables only
- Never hardcode in application code
- Use Railway's secret management for sensitive values

### Database Connection
- Use Railway's `${{Postgres.DATABASE_URL}}` reference variable
- Automatically includes credentials and connection details
- Updates automatically if database is migrated or recreated

## Deployment Checklist

### Before Deployment
- [ ] Verify no `railway.toml` files exist
- [ ] Check all `railpack.json` files are properly configured
- [ ] Ensure JWT_SECRET is set to a secure value
- [ ] Verify API keys are set in environment variables

### Railway UI Configuration
- [ ] Build Command: Empty (let Railpack handle)
- [ ] Start Command: Empty (let Railpack handle)
- [ ] Root Directory: Set correctly for each service
  - Frontend: `frontend`
  - Backend: `backend`
  - ML Worker: `python-services/poloniex`

### Environment Variables
- [ ] Frontend: NODE_ENV, VITE_API_URL set with Railway references
- [ ] Backend: NODE_ENV, DATABASE_URL, JWT_SECRET configured
- [ ] ML Worker: POLONIEX_API_KEY, POLONIEX_API_SECRET set

### Post-Deployment Verification
- [ ] Check service logs for successful startup
- [ ] Verify health endpoints respond correctly
- [ ] Test WebSocket connections (should use wss://)
- [ ] Verify CORS is working (check browser console)
- [ ] Test authentication flow

## Common Issues and Solutions

### WebSocket Connection Fails
- Ensure frontend uses `wss://` for HTTPS deployments
- Check CORS configuration includes frontend domain
- Verify Socket.IO transports include both websocket and polling

### CORS Errors
- Check backend allowedOrigins includes frontend URL
- Ensure credentials: true is set in CORS config
- Verify frontend sends credentials with requests

### Build Failures
- Ensure Yarn 4.9.2 is properly activated (corepack enable)
- Check railpack.json syntax is valid
- Verify all dependencies are installed

### Port Binding Issues
- Always use `$PORT` environment variable
- Bind to `0.0.0.0` not `localhost` or `127.0.0.1`
- Check logs for "Listening on 0.0.0.0:XXXX"

## Reference Variables

Railway provides these automatic variables:
- `RAILWAY_PUBLIC_DOMAIN`: Public URL for the service
- `RAILWAY_PRIVATE_DOMAIN`: Internal railway.internal domain
- `PORT`: Assigned port for the service
- Service references: `${{service-name.VARIABLE_NAME}}`

Use service references for inter-service communication:
- `${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}` for public API
- `${{polytrade-be.RAILWAY_PRIVATE_DOMAIN}}` for internal API
- `${{Postgres.DATABASE_URL}}` for database connection
