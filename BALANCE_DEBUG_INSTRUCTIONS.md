# Balance Display Debug Instructions

## Quick Diagnostic Steps

### 1. Check if you're logged in
Open browser console and run:
```javascript
localStorage.getItem('access_token') || localStorage.getItem('auth_token')
```
Should return a JWT token. If null, you need to login.

### 2. Check API Response
Open DevTools → Network tab, then refresh the page. Look for:
- `/api/dashboard/balance` request
- Click on it and check the "Response" tab

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "totalBalance": 1000.00,
    "availableBalance": 500.00,
    "marginBalance": 1000.00,
    "unrealizedPnL": 50.00,
    "currency": "USDT"
  }
}
```

**If you see mock data**:
```json
{
  "success": true,
  "data": {
    "totalBalance": 10000.00,
    ...
  },
  "mock": true
}
```
This means no API credentials found in database.

### 3. Check Credentials in Database
Run this in browser console:
```javascript
fetch('https://polytrade-be.up.railway.app/api/diagnostic/credentials-status', {
  headers: {
    'Authorization': 'Bearer ' + (localStorage.getItem('access_token') || localStorage.getItem('auth_token'))
  }
})
.then(r => r.json())
.then(d => console.log('Credentials:', d))
```

**Expected Output**:
```json
{
  "success": true,
  "hasCredentials": true,
  "credentialsCount": 1,
  "credentials": [{
    "exchange": "poloniex",
    "isActive": true,
    "keyLength": 64,
    "secretLength": 128
  }]
}
```

### 4. Test Balance Fetch
```javascript
fetch('https://polytrade-be.up.railway.app/api/diagnostic/test-balance', {
  headers: {
    'Authorization': 'Bearer ' + (localStorage.getItem('access_token') || localStorage.getItem('auth_token'))
  }
})
.then(r => r.json())
.then(d => console.log('Balance Test:', d))
```

**Success Response**:
```json
{
  "success": true,
  "step": "complete",
  "balance": { "eq": "1000.00", "availMgn": "500.00" },
  "transformed": {
    "totalBalance": 1000.00,
    "availableBalance": 500.00
  }
}
```

**Error Response** (shows exact issue):
```json
{
  "success": false,
  "step": "poloniex_api",
  "error": "Request failed with status code 401",
  "poloniexError": {
    "code": "400005",
    "msg": "Invalid signature"
  }
}
```

## Common Issues

### Issue 1: No Credentials in Database
**Symptoms**: Mock data ($10,000) displayed  
**Solution**: Go to Account page → API Keys tab → Enter Poloniex credentials → Save

### Issue 2: Invalid Signature (400005)
**Symptoms**: Error in diagnostic test  
**Cause**: API signature generation issue  
**Solution**: Backend fix already applied, redeploy backend

### Issue 3: IP Not Whitelisted (400006)
**Symptoms**: 403 error from Poloniex  
**Solution**: 
1. Get Railway backend IP from logs
2. Add to Poloniex API whitelist
3. Or remove IP whitelist restriction

### Issue 4: Balance Shows $0
**Symptoms**: API succeeds but shows $0  
**Possible Causes**:
1. Funds in Spot wallet, not Futures
2. Using Spot API key for Futures account
3. Data type conversion issue

**Check**:
```javascript
// Check raw API response
fetch('https://polytrade-be.up.railway.app/api/dashboard/balance', {
  headers: {
    'Authorization': 'Bearer ' + (localStorage.getItem('access_token') || localStorage.getItem('auth_token'))
  }
})
.then(r => r.json())
.then(d => {
  console.log('Raw Balance:', d);
  console.log('Total Balance Type:', typeof d.data.totalBalance);
  console.log('Total Balance Value:', d.data.totalBalance);
})
```

## Frontend Component Check

### Check if AccountBalanceWidget is rendering
Open React DevTools and look for `AccountBalanceWidget` component.

Check its props/state:
- `balance` object should have numeric values
- `loading` should be false
- `error` should be null

### Check Dashboard Context
```javascript
// In browser console
window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.forEach(r => {
  const fiber = r.getFiberRoots().values().next().value;
  console.log('React Fiber:', fiber);
});
```

## Backend Logs Check

SSH into Railway or check logs for:

**Success Pattern**:
```
Balance request received { userId: '...' }
Credentials retrieved { userId: '...', hasCredentials: true }
Making Poloniex v3 futures GET request to /v3/account/balance
Poloniex API response received { status: 200 }
Transformed balance: { totalBalance: 1000, ... }
```

**Error Pattern**:
```
No credentials found for user { userId: '...' }
```
Or:
```
Poloniex v3 futures API request error: { status: 401, data: {...} }
```

## Manual API Test

Use curl to test directly:
```bash
# Get your JWT token first
TOKEN="your-jwt-token-here"

# Test credentials status
curl -H "Authorization: Bearer $TOKEN" \
  https://polytrade-be.up.railway.app/api/diagnostic/credentials-status

# Test balance fetch
curl -H "Authorization: Bearer $TOKEN" \
  https://polytrade-be.up.railway.app/api/diagnostic/test-balance

# Test actual balance endpoint
curl -H "Authorization: Bearer $TOKEN" \
  https://polytrade-be.up.railway.app/api/dashboard/balance
```

## Next Steps Based on Results

### If credentials exist but balance is $0:
1. Check if funds are in Futures wallet (not Spot)
2. Verify API key has "Read" permissions
3. Check if using correct API key type (Futures vs Spot)

### If signature error (400005):
1. Backend fix already applied
2. Redeploy backend to Railway
3. Test again with diagnostic endpoint

### If IP whitelist error (400006):
1. Check Railway backend logs for IP address
2. Add IP to Poloniex whitelist
3. Or disable IP whitelist in Poloniex settings

### If no credentials found:
1. Go to Account page
2. Click API Keys tab
3. Enter Poloniex API Key and Secret
4. Click Save
5. Refresh page

## Report Results

Please run the diagnostic commands above and share:
1. Output of credentials-status check
2. Output of test-balance check
3. Screenshot of Network tab showing /api/dashboard/balance response
4. Any error messages from browser console

This will help identify the exact issue.
