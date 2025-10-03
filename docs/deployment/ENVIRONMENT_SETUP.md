# Environment Variables Setup Guide

## Overview

This guide provides step-by-step instructions for setting up all required environment variables for Railway deployment.

---

## Quick Reference

### Required Variables (Backend)
| Variable | Example | Description | Required |
|----------|---------|-------------|----------|
| `NODE_ENV` | `production` | Environment mode | ✅ Yes |
| `PORT` | `${{PORT}}` | Port (Railway auto-assigns) | ✅ Yes |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | PostgreSQL connection string | ✅ Yes |
| `JWT_SECRET` | `<32-char-secret>` | JWT signing secret | ✅ Yes |
| `API_ENCRYPTION_KEY` | `<32-char-secret>` | Data encryption key | ✅ Yes |
| `FRONTEND_URL` | `https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}` | Frontend URL for CORS | ✅ Yes |
| `FRONTEND_STANDALONE` | `true` | Deployment mode | ✅ Yes |

### Required Variables (Frontend)
| Variable | Example | Description | Required |
|----------|---------|-------------|----------|
| `VITE_API_URL` | `https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}` | Backend API URL | ✅ Yes |
| `VITE_WS_URL` | `wss://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}` | WebSocket URL | ✅ Yes |

### Trading Credentials (Optional but Recommended)
| Variable | Description | Required |
|----------|-------------|----------|
| `POLONIEX_API_KEY` | Poloniex API key | For live trading |
| `POLONIEX_API_SECRET` | Poloniex API secret | For live trading |
| `POLONIEX_PASSPHRASE` | Poloniex passphrase | For live trading |

---

## Step-by-Step Setup

### Step 1: Generate Secrets

Before setting up Railway, generate secure secrets locally:

```bash
# Generate JWT_SECRET (32+ characters)
openssl rand -base64 32
# Example output: "7TqXc9J2mR8vK4nP6wL3sF9hB5xD1yA0="

# Generate API_ENCRYPTION_KEY (32+ characters)
openssl rand -base64 32
# Example output: "9ZwQ4rY8tB2cX7vN3mK5pL6sF1hG8dA0="

# Save these securely - you'll need them in the next step
```

**⚠️ CRITICAL**: 
- Save these secrets in a secure password manager
- Never commit them to Git
- Never share them in plain text

---

### Step 2: Configure Backend Service (polytrade-be)

In Railway Dashboard → polytrade-be service → Variables tab:

#### Core Configuration
```bash
# Environment
NODE_ENV=production
PORT=${{PORT}}

# Database (use Railway Postgres plugin)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Security (paste secrets generated in Step 1)
JWT_SECRET=<paste-your-generated-jwt-secret>
API_ENCRYPTION_KEY=<paste-your-generated-encryption-key>

# Service Communication
FRONTEND_URL=https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}
CORS_ALLOWED_ORIGINS=https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}

# Deployment Mode
FRONTEND_STANDALONE=true

# Yarn Configuration
YARN_ENABLE_STRICT_SETTINGS=false
```

#### Trading Credentials (Optional)
```bash
# Poloniex API (if you have trading credentials)
POLONIEX_API_KEY=<your-poloniex-api-key>
POLONIEX_API_SECRET=<your-poloniex-api-secret>
POLONIEX_PASSPHRASE=<your-poloniex-passphrase>
```

#### Optional Configuration
```bash
# Logging
LOG_LEVEL=info

# Redis (if using caching)
# REDIS_URL=<redis-connection-string>

# Memory (if needed for large builds)
# NODE_OPTIONS=--max-old-space-size=2048
```

---

### Step 3: Configure Frontend Service (polytrade-fe)

In Railway Dashboard → polytrade-fe service → Variables tab:

```bash
# API Connection (Railway auto-resolves these references)
VITE_API_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
VITE_WS_URL=wss://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}

# Yarn Configuration
YARN_ENABLE_STRICT_SETTINGS=false

# Optional: Mock Mode (for development/testing without API)
# VITE_FORCE_MOCK_MODE=false
```

---

### Step 4: Configure PostgreSQL (Railway Plugin)

1. In Railway Dashboard → polytrade-be service → Settings
2. Add Plugin → PostgreSQL
3. This automatically creates `DATABASE_URL` variable
4. Reference it in backend service with `${{Postgres.DATABASE_URL}}`

---

### Step 5: Verify Configuration

After setting variables, check your configuration:

```bash
# In Railway Dashboard, click "Deploy" or trigger a new deployment

# Monitor logs for:
✓ "Environment: production"
✓ "Server running on port..."
✓ No errors about missing environment variables

# Test endpoints:
curl https://your-backend.railway.app/api/health
# Expected: {"status":"healthy","timestamp":"...","environment":"production"}

curl https://your-frontend.railway.app/healthz
# Expected: {"status":"healthy",...}
```

---

## Environment Variable Explanations

### Backend Variables

#### `NODE_ENV=production`
- **Purpose**: Sets runtime environment mode
- **Effect**: 
  - Disables debug logging
  - Enables optimizations
  - Serves frontend static files (if FRONTEND_STANDALONE=false)
- **Default**: `development`

#### `PORT=${{PORT}}`
- **Purpose**: Port number for HTTP server
- **Railway**: Auto-assigned by Railway
- **Local**: Defaults to 8765 (range: 8765-8799)
- **Must**: Bind to `0.0.0.0` (already configured)

#### `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- **Purpose**: PostgreSQL connection string
- **Format**: `postgresql://user:password@host:port/database`
- **Railway**: Provided by Postgres plugin
- **Required**: Backend won't start without it

#### `JWT_SECRET=<secret>`
- **Purpose**: Signs JWT tokens for authentication
- **Requirements**:
  - Minimum 32 characters
  - High entropy (use `openssl rand -base64 32`)
  - Never use default values like "your-secret-key"
- **Security**: Rotate regularly (every 90 days)

#### `API_ENCRYPTION_KEY=<secret>`
- **Purpose**: Encrypts sensitive data in database
- **Requirements**: Same as JWT_SECRET
- **Security**: Rotate with caution (requires re-encryption)

#### `FRONTEND_URL=<url>`
- **Purpose**: 
  - CORS whitelist
  - Redirect when FRONTEND_STANDALONE=true
- **Railway**: Use `https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}`
- **Local**: `http://localhost:5675`

#### `FRONTEND_STANDALONE=true|false`
- **Purpose**: Controls deployment architecture
- **Values**:
  - `true`: Backend only serves API (recommended for Railway)
  - `false` or unset: Backend serves both API and frontend
- **Railway**: Set to `true` for separate services

#### `CORS_ALLOWED_ORIGINS=<urls>`
- **Purpose**: Additional CORS whitelist entries
- **Format**: Comma-separated URLs
- **Example**: `https://app1.com,https://app2.com`
- **Default**: Includes FRONTEND_URL + Railway health check

#### `POLONIEX_API_KEY`, `POLONIEX_API_SECRET`, `POLONIEX_PASSPHRASE`
- **Purpose**: Poloniex API authentication
- **Required**: Only for live trading features
- **Without**: Platform works in mock/demo mode
- **Security**: Never expose these in frontend

---

### Frontend Variables

#### `VITE_API_URL=<url>`
- **Purpose**: Backend API endpoint for HTTP requests
- **Railway**: `https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}`
- **Local**: `http://localhost:8765`
- **Must**: Include protocol (https:// or http://)

#### `VITE_WS_URL=<url>`
- **Purpose**: Backend WebSocket endpoint for real-time data
- **Railway**: `wss://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}`
- **Local**: `ws://localhost:8765`
- **Must**: Use wss:// for production (secure WebSocket)

#### `VITE_FORCE_MOCK_MODE=true|false`
- **Purpose**: Enable mock data mode for development
- **Values**:
  - `true`: Use mock data, skip API calls
  - `false`: Use real API
- **Use**: Development without backend/credentials

---

## Variable Validation

### Backend Validation
The backend validates environment variables on startup:
- Checks for required variables
- Validates secret lengths
- Logs warnings for missing optional variables
- Exits with error if critical variables missing

### Frontend Validation
The frontend validates environment variables during build:
- Checks for required VITE_* variables
- Warns about localhost URLs in production
- Prevents backend secrets from being exposed

---

## Deployment Modes

### Mode 1: Separate Services (Recommended for Railway)
```bash
# Backend
FRONTEND_STANDALONE=true
FRONTEND_URL=https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}

# Frontend
VITE_API_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
```

**Pros**:
- Independent scaling
- Easier debugging
- Railway best practice

**Cons**:
- More services to manage
- Slightly more complex setup

### Mode 2: Combined Service
```bash
# Backend only
FRONTEND_STANDALONE=false
# No VITE_* variables needed
```

**Pros**:
- Single service deployment
- Simpler setup

**Cons**:
- Must build frontend before/with backend
- Can't scale independently

---

## Security Best Practices

### Secrets Management
1. ✅ Generate strong secrets (32+ characters)
2. ✅ Use Railway's secret management
3. ✅ Never commit secrets to Git
4. ✅ Rotate secrets regularly (90 days)
5. ✅ Use different secrets for dev/staging/prod

### Frontend Security
1. ✅ Only expose VITE_* prefixed variables
2. ✅ Never prefix backend secrets with VITE_
3. ✅ Validate environment in CI/CD
4. ✅ Use HTTPS in production

### Database Security
1. ✅ Use Railway Postgres plugin (auto-configured SSL)
2. ✅ Never expose DATABASE_URL to frontend
3. ✅ Use connection pooling
4. ✅ Regular backups (Railway auto-backups)

---

## Common Mistakes

### ❌ Wrong: Exposing Backend Secrets
```bash
# NEVER DO THIS in frontend:
VITE_JWT_SECRET=<secret>           # ❌ Exposed to browser
VITE_DATABASE_URL=<url>            # ❌ Exposed to browser
VITE_API_ENCRYPTION_KEY=<secret>   # ❌ Exposed to browser
```

### ✅ Correct: Only Safe Frontend Variables
```bash
VITE_API_URL=https://api.example.com  # ✅ Safe to expose
VITE_WS_URL=wss://api.example.com     # ✅ Safe to expose
```

### ❌ Wrong: Hardcoded URLs
```bash
FRONTEND_URL=https://my-app.railway.app  # ❌ Will break if domain changes
VITE_API_URL=https://my-api.railway.app  # ❌ Will break if domain changes
```

### ✅ Correct: Railway References
```bash
FRONTEND_URL=https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}  # ✅ Dynamic
VITE_API_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}  # ✅ Dynamic
```

---

## Troubleshooting

### "JWT_SECRET is required"
**Solution**: Set JWT_SECRET in backend service
```bash
openssl rand -base64 32
# Copy output to Railway
```

### "DATABASE_URL is required"
**Solution**: Add PostgreSQL plugin to backend service

### CORS Errors
**Solution**: Verify FRONTEND_URL matches actual frontend domain
```bash
# Check in browser console for actual origin
# Set CORS_ALLOWED_ORIGINS if using custom domain
```

### "Cannot connect to API"
**Solution**: Verify VITE_API_URL in frontend
```bash
# Should match backend Railway domain
VITE_API_URL=https://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
```

---

## References

- [Railway Environment Variables](https://docs.railway.app/develop/variables)
- [Railway Service References](https://docs.railway.app/develop/variables#service-variables)
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)
- Platform Documentation: `RAILWAY_DEPLOYMENT_MASTER.md`
- Security Guide: `SECURITY.md`
