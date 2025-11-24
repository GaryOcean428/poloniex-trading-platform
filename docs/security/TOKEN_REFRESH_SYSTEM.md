# Automatic JWT Token Refresh System

## Overview

The platform now implements **automatic token refresh** to provide a seamless user experience without session interruptions.

## How It Works

### Token Lifecycle

```
User Login
    ↓
Generate Access Token (1 hour) + Refresh Token (7 days)
    ↓
User makes API requests with Access Token
    ↓
Access Token expires after 1 hour
    ↓
Axios interceptor detects 401/403 error
    ↓
Automatically calls /api/auth/refresh with Refresh Token
    ↓
Receives new Access Token + new Refresh Token
    ↓
Retries original request with new token
    ↓
User continues working (no interruption)
```

### Background Refresh

In addition to on-demand refresh, the system also:
- Checks token expiry every 5 minutes
- Proactively refreshes tokens that expire in < 10 minutes
- Prevents sudden session expiry during active use

## Token Types

### Access Token
- **Expiry**: 1 hour
- **Purpose**: Authenticate API requests
- **Storage**: localStorage (`access_token`)
- **Format**: JWT with user ID, email

### Refresh Token
- **Expiry**: 7 days
- **Purpose**: Obtain new access tokens
- **Storage**: localStorage (`refresh_token`)
- **Format**: JWT with user ID, email, type='refresh'
- **Security**: Rotated on each refresh (old token invalidated)

## Implementation Details

### Backend (Node.js/Express)

#### Login/Register Response
```javascript
{
  "token": "eyJhbGc...",        // Access token (backward compat)
  "accessToken": "eyJhbGc...",  // Access token
  "refreshToken": "eyJhbGc...", // Refresh token
  "expiresIn": 3600,            // Seconds until expiry
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "username"
  }
}
```

#### Refresh Endpoint
```
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGc..."
}

Response:
{
  "success": true,
  "accessToken": "eyJhbGc...",   // New access token
  "refreshToken": "eyJhbGc...",  // New refresh token (rotated)
  "expiresIn": 3600
}
```

### Frontend (React/TypeScript)

#### Axios Interceptor
```typescript
// Automatically added to all axios requests
axios.interceptors.request.use(config => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Automatically handles 401/403 responses
axios.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      // Refresh token and retry request
      const newToken = await refreshAccessToken();
      if (newToken) {
        error.config.headers.Authorization = `Bearer ${newToken}`;
        return axios(error.config);
      }
    }
    return Promise.reject(error);
  }
);
```

#### Background Refresh
```typescript
// Checks every 5 minutes
setInterval(async () => {
  const token = getAccessToken();
  if (tokenExpiresInLessThan10Minutes(token)) {
    await refreshAccessToken();
  }
}, 5 * 60 * 1000);
```

## Security Features

### Token Rotation
- Each refresh generates a **new** refresh token
- Old refresh token is invalidated
- Prevents token reuse attacks

### Automatic Cleanup
- Expired tokens are automatically cleared
- User redirected to login if refresh fails
- No stale tokens left in storage

### Request Queuing
- Multiple simultaneous requests don't trigger multiple refreshes
- Requests are queued during refresh
- All queued requests use the new token

## User Experience

### Before (Without Auto-Refresh)
```
User working on platform
    ↓
1 hour passes
    ↓
User clicks button
    ↓
❌ "Invalid or expired token" error
    ↓
User must manually log in again
    ↓
Loses current work/context
```

### After (With Auto-Refresh)
```
User working on platform
    ↓
1 hour passes
    ↓
User clicks button
    ↓
✅ Token automatically refreshed in background
    ↓
Request succeeds
    ↓
User continues working (no interruption)
```

## Configuration

### Backend Environment Variables
```bash
# JWT secret for signing tokens
JWT_SECRET=your-secret-key-here

# Optional: Custom token expiry (defaults shown)
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60    # 1 hour
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7      # 7 days
```

### Frontend Environment Variables
```bash
# Backend API URL (auto-detected if not set)
VITE_API_BASE_URL=https://polytrade-be.up.railway.app
```

## Testing

### Test Token Refresh Manually
```bash
# 1. Login and get tokens
curl -X POST https://polytrade-be.up.railway.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'

# Response includes accessToken and refreshToken

# 2. Use refresh token to get new access token
curl -X POST https://polytrade-be.up.railway.app/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"YOUR_REFRESH_TOKEN"}'

# Response includes new accessToken and new refreshToken
```

### Test Automatic Refresh in Browser
1. Open browser DevTools (F12)
2. Go to Console tab
3. Login to platform
4. Wait 55 minutes (or modify token expiry for testing)
5. Make an API request (click any button)
6. Watch console logs:
   ```
   Token expiring soon, refreshing...
   Token refreshed successfully
   ```
7. Request succeeds without user intervention

### Test Token Expiry
```javascript
// In browser console
localStorage.setItem('auth_expiry', Date.now() + 60000); // Expires in 1 minute

// Wait 1 minute, then make a request
// Should automatically refresh
```

## Troubleshooting

### "Token refresh failed"
**Cause**: Refresh token expired (> 7 days) or invalid  
**Solution**: User must log in again (expected behavior)

### "Invalid token type"
**Cause**: Trying to use access token as refresh token  
**Solution**: Ensure correct token is sent to /api/auth/refresh

### Multiple refresh requests
**Cause**: Request queuing not working  
**Solution**: Check axios interceptor is properly initialized

### Redirect loop to login
**Cause**: Refresh endpoint returning 401/403  
**Solution**: Check JWT_SECRET is set correctly in backend

## Migration Guide

### For Existing Users
No action required! The system is backward compatible:
- Old tokens continue to work until expiry
- New tokens generated on next login
- Automatic refresh starts working immediately

### For Developers
If you're making direct API calls (not using axios):

```typescript
// Before
const token = getAccessToken();
fetch('/api/endpoint', {
  headers: { Authorization: `Bearer ${token}` }
});

// After (with auto-refresh)
import { getAccessTokenWithRefresh } from '@/utils/auth';

const token = await getAccessTokenWithRefresh();
fetch('/api/endpoint', {
  headers: { Authorization: `Bearer ${token}` }
});
```

## Benefits

### For Users
- ✅ No more session interruptions
- ✅ Seamless experience across long sessions
- ✅ Automatic re-authentication
- ✅ No lost work due to token expiry

### For Security
- ✅ Shorter access token lifetime (1 hour vs 24 hours)
- ✅ Token rotation prevents reuse attacks
- ✅ Automatic cleanup of expired tokens
- ✅ Graceful handling of refresh failures

### For Developers
- ✅ No manual token refresh logic needed
- ✅ Works automatically with all axios requests
- ✅ Centralized error handling
- ✅ Easy to test and debug

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Axios Interceptor                                    │  │
│  │  - Adds auth header to requests                       │  │
│  │  - Detects 401/403 responses                          │  │
│  │  - Triggers token refresh                             │  │
│  │  - Retries failed requests                            │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Background Refresh Timer                             │  │
│  │  - Checks every 5 minutes                             │  │
│  │  - Proactive refresh before expiry                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Token Storage (localStorage)                         │  │
│  │  - access_token (1 hour)                              │  │
│  │  - refresh_token (7 days)                             │  │
│  │  - auth_expiry (timestamp)                            │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓
                    HTTPS Request
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                         Backend                              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  POST /api/auth/login                                 │  │
│  │  - Verify credentials                                 │  │
│  │  - Generate access + refresh tokens                   │  │
│  │  - Return both tokens                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  POST /api/auth/refresh                               │  │
│  │  - Verify refresh token                               │  │
│  │  - Generate new access token                          │  │
│  │  - Generate new refresh token (rotation)              │  │
│  │  - Return both tokens                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  JWT Verification Middleware                          │  │
│  │  - Validates access token on protected routes         │  │
│  │  - Returns 401/403 if invalid/expired                 │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Related Documentation

- [API Keys Guide](./API_KEYS_GUIDE.md)
- [Deployment Status](./DEPLOYMENT_STATUS.md)
- [Futures Trading Guide](./FUTURES_TRADING_PRIORITY_FIXES.md)

---

**Status**: ✅ Deployed and Active  
**Version**: 1.0.0  
**Last Updated**: 2025-11-12
