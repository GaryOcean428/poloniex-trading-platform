# Railway Environment Variables Configuration

This document outlines the required environment variables for proper Railway deployment in compliance with .clinerules specifications.

## Backend Environment Variables

### Core Configuration
```
NODE_ENV=production
PORT=$PORT  # Railway automatically provides this
```

### CORS Configuration
```
# Primary frontend URL (Railway reference variable)
FRONTEND_URL=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}

# Backup CORS origins (comma-separated)
CORS_ALLOWED_ORIGINS=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}},https://poloniex-trading-platform.vercel.app
```

### Database Configuration
```
DATABASE_URL=${{postgres.DATABASE_URL}}
```

### API Keys (Set these in Railway dashboard)
```
POLONIEX_API_KEY=your_api_key_here
POLONIEX_API_SECRET=your_api_secret_here
```

## Frontend Environment Variables

### Backend API Configuration
```
# Backend service reference (Railway internal communication)
VITE_BACKEND_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}}

# Railway domain references
VITE_RAILWAY_PUBLIC_DOMAIN=${{backend.RAILWAY_PUBLIC_DOMAIN}}
VITE_RAILWAY_PRIVATE_DOMAIN=${{backend.RAILWAY_PRIVATE_DOMAIN}}
```

### API Configuration
```
VITE_POLONIEX_API_BASE_URL=https://api.poloniex.com/v3/futures
VITE_POLONIEX_WS_URL=wss://futures-apiws.poloniex.com
```

### Optional Configuration
```
# Force mock mode for testing
VITE_FORCE_MOCK_MODE=false

# Disable mock mode (requires valid API credentials)
VITE_DISABLE_MOCK_MODE=false
```

## Port Compliance (.clinerules)

### Development Ports
- **Frontend**: 5675-5699 (configured to use 5675)
- **Backend**: 8765-8799 (configured to use 8765)
- **Services**: 9080-9099 (Firebase and other services)

### Production Ports
- Railway automatically handles port assignment via `$PORT` environment variable
- All services bind to `0.0.0.0:$PORT` for Railway compatibility

## WebSocket Configuration

### Protocol Handling
- **HTTPS origins**: Use `wss://` protocol
- **HTTP origins**: Use `ws://` protocol
- **Railway deployment**: Automatically uses `wss://` for secure connections

### Connection URLs
- **Development**: `ws://localhost:8765` or `wss://localhost:8765` (depending on frontend protocol)
- **Production**: `wss://{backend-service}.up.railway.app`

## Railway Reference Variables

Use these patterns for inter-service communication:

### Internal Communication (HTTP)
```
http://${{service.RAILWAY_PRIVATE_DOMAIN}}:${{service.PORT}}
```

### Public Communication (HTTPS)
```
https://${{service.RAILWAY_PUBLIC_DOMAIN}}
```

## Deployment Checklist

1. ✅ **Port Binding**: Services bind to `0.0.0.0:$PORT`
2. ✅ **CORS Configuration**: Uses Railway reference variables
3. ✅ **WebSocket Protocol**: Proper wss/ws protocol selection
4. ✅ **Environment Variables**: Railway references for inter-service communication
5. ✅ **Health Checks**: Configured for `/api/health` endpoint

## Troubleshooting

### Common Issues
1. **CORS Errors**: Ensure `FRONTEND_URL` matches exact deployed domain
2. **WebSocket Errors**: Check protocol mismatch (ws vs wss)
3. **Port Errors**: Verify services bind to `$PORT` not hardcoded ports
4. **Connection Errors**: Ensure Railway reference variables are properly set

### Debugging Commands
```bash
# Check Railway service status
railway status

# View environment variables
railway variables

# Check service logs
railway logs
```