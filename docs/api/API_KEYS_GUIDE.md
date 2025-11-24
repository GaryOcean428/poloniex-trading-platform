# API Keys Configuration Guide

## ⚠️ Important: Where API Keys Should Be

### ❌ NEVER Store API Keys in Frontend
```bash
# DO NOT DO THIS:
VITE_POLONIEX_API_KEY=your_key_here  # ❌ EXPOSED TO BROWSER
VITE_POLONIEX_API_SECRET=your_secret # ❌ ANYONE CAN SEE THIS
```

**Why?** Frontend environment variables are:
- Bundled into JavaScript
- Visible in browser DevTools
- Accessible to anyone viewing your site
- A major security risk

### ✅ Correct: Store API Keys in Backend Database

```
User Browser (Frontend)
    ↓ Authenticated Request (JWT Token)
Backend Server
    ↓ Fetch User's Encrypted API Keys from Database
    ↓ Decrypt Keys
    ↓ Make API Call to Poloniex
Poloniex API
```

## How to Add Your API Keys

### Step 1: Get Poloniex API Keys

1. Log into your Poloniex account
2. Go to **API Management**
3. Create a new API key with **Futures Trading** permissions
4. **Important**: Enable these permissions:
   - ✅ Read (view balance, positions)
   - ✅ Trade (place/cancel orders)
   - ❌ Withdraw (NOT recommended for trading bots)
5. **Whitelist IP**: Add your Railway backend IP
   - Get IP from: `https://polytrade-be.up.railway.app/api/futures/health`
   - Look for `publicIp` field

### Step 2: Add Keys to Platform

1. **Log into the platform**
   - Go to: https://poloniex-trading-platform-production.up.railway.app
   - Click **Login** or **Sign Up**

2. **Navigate to Account Settings**
   - Click your profile/avatar
   - Select **Account** or **Settings**
   - Find **API Key Management** section

3. **Add New API Credential**
   - Click **+ Add API Key** button
   - Fill in the form:
     ```
     Credential Name: My Poloniex Futures
     API Key: [paste your key]
     API Secret: [paste your secret]
     Permissions:
       ✅ Read
       ✅ Trade
       ❌ Withdraw
     ```
   - Click **Save**

4. **Verify Connection**
   - Keys are encrypted and stored in database
   - Go to **Dashboard**
   - You should see real balance instead of mock data
   - If you have open positions, they will appear

## Error Messages Explained

### "VITE_POLONIEX_API_KEY is not defined"

**What it means**: The frontend is looking for an environment variable that shouldn't exist.

**Solution**: This is expected! API keys should be added through the Account page, not environment variables.

**Action**: 
1. Ignore this error (it's harmless)
2. Add your keys through the UI as described above

### "Invalid or expired token"

**What it means**: Your login session (JWT token) has expired.

**Solution**: Log in again
1. Click **Logout**
2. Click **Login**
3. Enter your credentials
4. You'll get a fresh token

**Why it happens**: JWT tokens expire after 1 hour for security.

### "Failed to fetch balance" (500 error)

**What it means**: One of these issues:
- No API keys configured
- API keys are invalid
- IP not whitelisted on Poloniex
- API keys don't have futures permissions

**Solution**:
1. Check if you've added API keys in Account settings
2. Verify keys are correct on Poloniex
3. Ensure Railway backend IP is whitelisted
4. Confirm keys have "Futures Trading" permissions

### Agent Endpoints (403 Forbidden)

**What it means**: Autonomous agent features require special permissions.

**Solution**: These features are restricted. Contact admin for access.

## Architecture Overview

### Security Model

```typescript
// Frontend (Browser) - NO API KEYS HERE
const response = await fetch('/api/dashboard/balance', {
  headers: {
    'Authorization': `Bearer ${userJwtToken}` // Only JWT token
  }
});

// Backend (Server) - API KEYS STORED HERE
async function getBalance(req, res) {
  const userId = req.user.id; // From JWT token
  
  // Fetch user's encrypted API keys from database
  const credentials = await db.getApiCredentials(userId);
  
  // Decrypt keys (never sent to frontend)
  const { apiKey, apiSecret } = decrypt(credentials);
  
  // Make authenticated call to Poloniex
  const balance = await poloniex.getBalance(apiKey, apiSecret);
  
  res.json(balance);
}
```

### Database Schema

```sql
CREATE TABLE api_credentials (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  exchange VARCHAR(50) DEFAULT 'poloniex',
  credential_name VARCHAR(255),
  encrypted_api_key TEXT,      -- Encrypted with AES-256
  encrypted_api_secret TEXT,   -- Encrypted with AES-256
  encryption_tag TEXT,          -- For AES-GCM authentication
  permissions JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP
);
```

## Testing Your Setup

### 1. Test Without API Keys (Mock Mode)
```bash
# Should return mock data
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://polytrade-be.up.railway.app/api/dashboard/balance

# Response:
{
  "success": true,
  "data": {
    "availableBalance": "10000.00",
    "totalEquity": "10000.00",
    ...
  },
  "mock": true,  # ← Indicates mock data
  "warning": "Unable to fetch real balance..."
}
```

### 2. Test With API Keys (Real Mode)
```bash
# After adding API keys, should return real data
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://polytrade-be.up.railway.app/api/dashboard/balance

# Response:
{
  "success": true,
  "data": {
    "availableBalance": "1234.56",  # ← Real balance
    "totalEquity": "1234.56",
    ...
  }
  # No "mock" field = real data
}
```

### 3. Test Public Endpoints (No Auth Required)
```bash
# These work without any authentication
curl https://polytrade-be.up.railway.app/api/futures/ticker?symbol=BTC_USDT_PERP
curl https://polytrade-be.up.railway.app/api/futures/health
```

## Common Issues

### Issue: "Cannot read properties of undefined"
**Cause**: JWT token expired or invalid  
**Fix**: Log out and log back in

### Issue: Dashboard shows mock data forever
**Cause**: API keys not configured or invalid  
**Fix**: 
1. Go to Account → API Key Management
2. Add valid Poloniex API keys
3. Ensure IP is whitelisted
4. Refresh dashboard

### Issue: "Request failed with status code 403"
**Cause**: JWT token expired  
**Fix**: Log in again to get fresh token

### Issue: Agent features don't work
**Cause**: Agent features require special permissions  
**Fix**: These are restricted features - contact admin

## Best Practices

### ✅ DO
- Store API keys through the Account UI
- Use separate API keys for each application
- Enable only necessary permissions (Read + Trade)
- Whitelist specific IPs on Poloniex
- Rotate API keys periodically
- Monitor API key usage

### ❌ DON'T
- Put API keys in environment variables
- Share API keys between applications
- Enable withdraw permissions for bots
- Commit API keys to git
- Share API keys with others
- Use main account keys for testing

## Support

### Getting Help

1. **Check Console Logs**
   - Open browser DevTools (F12)
   - Look for detailed error messages
   - Check Network tab for API responses

2. **Verify Configuration**
   - API keys added in Account settings?
   - Keys have futures permissions?
   - IP whitelisted on Poloniex?
   - JWT token not expired?

3. **Test Endpoints**
   - Public endpoints work without auth
   - Use curl to test directly
   - Check Railway deployment logs

### Documentation

- [Poloniex API Docs](https://api-docs.poloniex.com/v3/futures/)
- [Platform Fixes](./POLONIEX_V3_API_FIXES.md)
- [Deployment Status](./DEPLOYMENT_STATUS.md)
- [Futures Trading Guide](./FUTURES_TRADING_PRIORITY_FIXES.md)

---

**Remember**: API keys are sensitive credentials. Never expose them in frontend code, environment variables, or version control. Always store them securely in the backend database with encryption.
