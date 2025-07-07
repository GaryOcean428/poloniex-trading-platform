# Railway Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the Poloniex Trading Platform to Railway using a monorepo architecture with separate frontend and backend services.

## Project Structure

```
poloniex-trading-platform/
├── frontend/                    # React/Vite frontend application
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── yarn.lock
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── .env.example
│   ├── railway.json            # Service-specific config
│   ├── nixpacks.toml          # Nixpacks configuration
│   └── Dockerfile             # Optional Docker config
├── backend/                    # Node.js/Express backend API
│   ├── src/
│   ├── package.json
│   ├── yarn.lock
│   ├── tsconfig.json
│   ├── .env.example
│   ├── railway.json            # Service-specific config
│   ├── nixpacks.toml          # Nixpacks configuration
│   └── Dockerfile             # Optional Docker config
├── shared/                     # Shared TypeScript types
│   └── types/
├── railway.json               # Monorepo configuration
├── package.json               # Root workspace config
├── yarn.lock                  # Root lockfile
└── README.md
```

## Railway Configuration Options

### Option 1: Single Configuration (Recommended)

Use the root `railway.json` with multi-service configuration:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "environments": {
    "production": {
      "services": {
        "frontend": {
          "build": {
            "builder": "NIXPACKS",
            "buildCommand": "cd frontend && yarn install && yarn build",
            "watchPatterns": ["frontend/**", "shared/**"]
          },
          "deploy": {
            "startCommand": "cd frontend && yarn start",
            "restartPolicyType": "ON_FAILURE",
            "restartPolicyMaxRetries": 3,
            "overlapSeconds": 60
          }
        },
        "backend": {
          "build": {
            "builder": "NIXPACKS",
            "buildCommand": "cd backend && yarn install && yarn build",
            "watchPatterns": ["backend/**", "shared/**"]
          },
          "deploy": {
            "startCommand": "cd backend && yarn start:prod",
            "healthcheckPath": "/api/health",
            "healthcheckTimeout": 300,
            "restartPolicyType": "ON_FAILURE",
            "restartPolicyMaxRetries": 3,
            "overlapSeconds": 60
          }
        }
      }
    }
  }
}
```

### Option 2: Separate Service Configurations

Each service has its own `railway.json` configuration file.

**Frontend** (`/frontend/railway.json`):
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "yarn install && yarn build"
  },
  "deploy": {
    "startCommand": "yarn start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**Backend** (`/backend/railway.json`):
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "yarn install && yarn build"
  },
  "deploy": {
    "startCommand": "yarn start:prod",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

## Railway Dashboard Configuration

### Frontend Service Settings

- **Service Name**: `poloniex-frontend`
- **Root Directory**: `/frontend`
- **Config Path**: `/railway.json` (Option 1) or `/frontend/railway.json` (Option 2)
- **Builder**: NIXPACKS
- **Watch Paths**:
  ```
  frontend/**
  shared/**
  package.json
  ```

### Backend Service Settings

- **Service Name**: `poloniex-backend`
- **Root Directory**: `/backend`
- **Config Path**: `/railway.json` (Option 1) or `/backend/railway.json` (Option 2)
- **Builder**: NIXPACKS
- **Watch Paths**:
  ```
  backend/**
  shared/**
  package.json
  ```

## Environment Variables

### Frontend Environment Variables

```bash
# Railway System Variables (auto-generated)
PORT=
RAILWAY_PUBLIC_DOMAIN=

# Application Variables
NODE_ENV=production
VITE_API_URL=${{backend.RAILWAY_PUBLIC_DOMAIN}}
VITE_WS_URL=wss://${{backend.RAILWAY_PUBLIC_DOMAIN}}
VITE_APP_VERSION=${{RAILWAY_GIT_COMMIT_SHA}}

# Poloniex API Credentials
VITE_POLONIEX_API_KEY=your-poloniex-api-key
VITE_POLONIEX_API_SECRET=your-poloniex-api-secret
VITE_POLONIEX_PASSPHRASE=your-poloniex-passphrase

# Mock Mode Configuration
VITE_FORCE_MOCK_MODE=false
```

### Backend Environment Variables

```bash
# Railway System Variables (auto-generated)
PORT=
RAILWAY_PUBLIC_DOMAIN=

# Application Variables
NODE_ENV=production
FRONTEND_URL=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}

# Poloniex API Credentials
POLONIEX_API_KEY=your-poloniex-api-key
POLONIEX_SECRET=your-poloniex-api-secret
POLONIEX_PASSPHRASE=your-poloniex-passphrase

# Security Configuration
JWT_SECRET=your-secure-jwt-secret
SESSION_SECRET=your-secure-session-secret

# Optional: Database Configuration
# DATABASE_URL=${{database.DATABASE_URL}}
# REDIS_URL=${{redis.REDIS_URL}}
```

## Deployment Steps

### 1. Create Railway Project

1. Sign up/login to Railway
2. Create a new project
3. Connect your GitHub repository

### 2. Create Services

1. **Backend Service**:
   - Create new service in Railway
   - Connect to your GitHub repository
   - Set root directory to `/backend`
   - Configure environment variables

2. **Frontend Service**:
   - Create second service in Railway
   - Connect to same GitHub repository
   - Set root directory to `/frontend`
   - Configure environment variables

### 3. Configure Services

1. **Set Config Paths**:
   - Backend: `/railway.json` or `/backend/railway.json`
   - Frontend: `/railway.json` or `/frontend/railway.json`

2. **Configure Build Settings**:
   - Both services should use NIXPACKS builder
   - Watch patterns configured automatically

### 4. Deploy

1. Deploy backend service first
2. Note the backend Railway URL
3. Update frontend `VITE_API_URL` environment variable
4. Deploy frontend service

## Workspace Commands

The monorepo includes optimized workspace commands:

```bash
# Development
yarn dev                 # Start frontend development server
yarn dev:backend         # Start backend development server
yarn dev:frontend        # Start frontend development server

# Building
yarn build              # Build both services
yarn build:backend      # Build backend only
yarn build:frontend     # Build frontend only

# Production
yarn start              # Start backend server
yarn start:backend      # Start backend server
yarn start:frontend     # Start frontend preview server

# Testing & Linting
yarn test               # Run frontend tests
yarn lint               # Lint both services
```

## Troubleshooting

### Common Issues

1. **Build Failures**:
   - Check that root directory is set correctly
   - Verify all dependencies are in package.json
   - Check build command paths

2. **Environment Variables**:
   - Use Railway's service reference syntax: `${{service.VARIABLE}}`
   - Ensure all required variables are set
   - Check variable names for typos

3. **Port Issues**:
   - Backend: Uses `0.0.0.0:$PORT` binding
   - Frontend: Uses `0.0.0.0:$PORT` for preview server

4. **CORS Issues**:
   - Backend CORS configured for Railway domains
   - Update CORS settings if using custom domains

### Deployment Verification

1. **Backend Health Check**:
   - Visit `https://your-backend-service.up.railway.app/api/health`
   - Should return JSON with status information

2. **Frontend Access**:
   - Visit your frontend Railway URL
   - Check browser console for errors
   - Verify API connections in Network tab

3. **Service Communication**:
   - Check that frontend can reach backend API
   - Verify WebSocket connections if using real-time features

## Advanced Configuration

### Custom Domains

1. Configure custom domains in Railway dashboard
2. Update environment variables with custom URLs
3. Update CORS configuration in backend

### Database Integration

1. Add database service to Railway project
2. Configure DATABASE_URL environment variable
3. Update backend code to use database

### Monitoring

1. Use Railway's built-in logging
2. Configure health checks for both services
3. Set up alerts for service failures

## Security Best Practices

1. **Environment Variables**:
   - Never commit .env files
   - Use Railway's encrypted variable storage
   - Rotate API keys regularly

2. **CORS Configuration**:
   - Restrict origins to known domains
   - Configure proper headers

3. **API Security**:
   - Use HTTPS for all communications
   - Implement rate limiting
   - Validate all inputs

## Support

For issues with this deployment:
1. Check Railway documentation
2. Review build logs in Railway dashboard
3. Verify environment variable configuration
4. Test locally with production environment variables