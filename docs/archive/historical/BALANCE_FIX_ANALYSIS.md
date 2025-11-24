# Balance Display Issue - Deep Analysis & Fixes

## Root Cause Analysis

### Issue 1: Data Type Mismatch ✅ FIXED
**Problem**: Backend returned strings, frontend expected numbers
- Backend: `{ totalEquity: '1000.00', availableBalance: '500.00' }`
- Frontend: `interface Balance { totalBalance: number; availableBalance: number; }`

**Fix Applied**:
```typescript
// backend/src/routes/dashboard.ts
const transformedBalance = {
  totalBalance: parseFloat(balance.eq || balance.totalEquity || '0'),
  availableBalance: parseFloat(balance.availMgn || balance.availableBalance || '0'),
  marginBalance: parseFloat(balance.eq || balance.totalEquity || '0'),
  unrealizedPnL: parseFloat(balance.upl || balance.unrealizedPnL || '0'),
  currency: 'USDT'
};
```

### Issue 2: Field Name Mismatch ✅ FIXED
**Problem**: Backend used `totalEquity`, frontend expected `totalBalance`
- Backend returned: `totalEquity`, `availableBalance`, `unrealizedPnL`
- Frontend expected: `totalBalance`, `availableBalance`, `unrealizedPnL`

**Fix Applied**: Renamed `totalEquity` → `totalBalance` in backend response

### Issue 3: Mock Data Masking Real Errors ✅ FIXED
**Problem**: When Poloniex API failed, backend returned mock data instead of error
- User couldn't see actual API errors
- No way to debug authentication or permission issues

**Fix Applied**:
```typescript
// Now returns actual error instead of mock data
catch (apiError: any) {
  logger.error('Poloniex API call failed:', {
    error: apiError.message,
    status: apiError.response?.status,
    data: apiError.response?.data
  });
  return res.status(500).json({
    success: false,
    error: 'Failed to fetch balance from Poloniex',
    details: apiError.message,
    poloniexError: apiError.response?.data
  });
}
```

## Diagnostic Tools Added

### New Endpoint: `/api/diagnostic/credentials-status`
Check if user has credentials stored and their status:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://polytrade-be.up.railway.app/api/diagnostic/credentials-status
```

**Response**:
```json
{
  "success": true,
  "userId": "user-uuid",
  "hasCredentials": true,
  "credentialsCount": 1,
  "credentials": [{
    "id": "cred-uuid",
    "exchange": "poloniex",
    "isActive": true,
    "keyLength": 64,
    "secretLength": 128,
    "hasIv": true,
    "hasTag": true,
    "createdAt": "2025-11-12T...",
    "lastUsedAt": "2025-11-12T..."
  }]
}
```

### New Endpoint: `/api/diagnostic/test-balance`
Test balance fetch with detailed step-by-step logging:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://polytrade-be.up.railway.app/api/diagnostic/test-balance
```

**Success Response**:
```json
{
  "success": true,
  "step": "complete",
  "balance": { "eq": "1000.00", "availMgn": "500.00", "upl": "50.00" },
  "balanceKeys": ["eq", "availMgn", "upl", "im", "mm"],
  "transformed": {
    "totalBalance": 1000.00,
    "availableBalance": 500.00,
    "marginBalance": 1000.00,
    "unrealizedPnL": 50.00
  }
}
```

**Error Response** (shows exact Poloniex API error):
```json
{
  "success": false,
  "step": "poloniex_api",
  "error": "Request failed with status code 401",
  "status": 401,
  "statusText": "Unauthorized",
  "poloniexError": {
    "code": "401",
    "msg": "Invalid API key or signature"
  }
}
```

## Enhanced Logging

### Balance Endpoint Logging
```typescript
// Now logs:
logger.info('Balance request received', { userId });
logger.info('Credentials retrieved', { 
  userId, 
  hasCredentials: !!credentials,
  exchange: credentials?.exchange 
});
logger.info('Futures balance fetched successfully:', { 
  eq: balance.eq, 
  availMgn: balance.availMgn,
  rawBalance: JSON.stringify(balance)
});
```

### Poloniex API Request Logging
```typescript
// Now logs:
logger.info('Making Poloniex v3 futures request', {
  url: fullUrl,
  hasApiKey: !!credentials.apiKey,
  timestamp
});
logger.info('Poloniex API response received', {
  endpoint: requestPath,
  status: response.status,
  hasData: !!response.data,
  dataKeys: response.data ? Object.keys(response.data) : []
});
```

## Common Issues & Solutions

### Issue: "No credentials found"
**Symptoms**: Balance shows mock data ($10,000)
**Check**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://polytrade-be.up.railway.app/api/diagnostic/credentials-status
```
**Solution**: Go to Settings page and save Poloniex API credentials

### Issue: "Invalid API key or signature"
**Symptoms**: 401 error from Poloniex
**Possible Causes**:
1. API key is incorrect
2. API secret is incorrect
3. API key doesn't have required permissions
4. IP whitelist restriction on Poloniex

**Check Permissions Required**:
- ✅ Read account information
- ✅ Read positions
- ✅ Read orders
- ❌ Place orders (only if live trading)

**Solution**: 
1. Verify API key/secret in Poloniex dashboard
2. Check IP whitelist settings
3. Ensure key has "Read" permissions
4. Re-enter credentials in Settings page

### Issue: "IP not whitelisted"
**Symptoms**: 403 error from Poloniex
**Solution**: 
1. Get Railway backend IP: Check logs or use diagnostic endpoint
2. Add IP to Poloniex API whitelist
3. Or remove IP whitelist restriction (less secure)

### Issue: Balance shows $0 despite having funds
**Symptoms**: Balance API succeeds but shows 0
**Possible Causes**:
1. Using Spot API key for Futures account (or vice versa)
2. Account has no funds in Futures wallet
3. Funds are in Spot wallet, not Futures

**Check**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://polytrade-be.up.railway.app/api/diagnostic/test-balance
```

**Solution**:
1. Transfer funds from Spot to Futures wallet in Poloniex
2. Verify you're using Futures API credentials
3. Check the `balance` object in diagnostic response

## Testing Checklist

After deploying fixes, test in this order:

1. **Check Credentials Exist**:
   ```bash
   GET /api/diagnostic/credentials-status
   ```
   - Should show `hasCredentials: true`
   - Should show `hasTag: true` (encryption working)

2. **Test Balance Fetch**:
   ```bash
   GET /api/diagnostic/test-balance
   ```
   - Should show `success: true`
   - Should show actual balance values
   - If fails, shows exact Poloniex error

3. **Check Dashboard Balance**:
   - Open frontend Dashboard
   - Should show real balance (not $10,000 mock data)
   - Should show available, margin, and unrealized P&L

4. **Verify Data Types**:
   - Open browser DevTools → Network tab
   - Check `/api/dashboard/balance` response
   - Verify all values are numbers, not strings

## Files Modified

1. `backend/src/routes/dashboard.ts`
   - Fixed data type conversion (string → number)
   - Fixed field name (totalEquity → totalBalance)
   - Removed mock data fallback on API errors
   - Added detailed logging

2. `backend/src/services/poloniexFuturesService.js`
   - Enhanced error logging
   - Added request/response logging

3. `backend/src/routes/diagnostic.ts` (NEW)
   - Added credentials status endpoint
   - Added balance test endpoint

4. `backend/src/index.ts`
   - Registered diagnostic routes

## Next Steps

1. **Deploy to Railway**: Push changes to trigger deployment
2. **Test with Real User**: Login and check balance display
3. **Monitor Logs**: Check Railway logs for any Poloniex API errors
4. **Verify Credentials**: Use diagnostic endpoints to confirm setup

## Expected Behavior After Fix

### Scenario 1: User Has Valid Credentials
- Dashboard shows real balance from Poloniex
- All values are numbers (not strings)
- Field names match frontend expectations
- No mock data displayed

### Scenario 2: User Has No Credentials
- Dashboard shows error message
- User prompted to add credentials in Settings
- No silent fallback to mock data

### Scenario 3: Poloniex API Error
- Dashboard shows specific error message
- Error details logged to Railway
- User can use diagnostic endpoint to debug
- Clear indication of what went wrong (auth, permissions, IP, etc.)

## Monitoring

Check Railway logs for these patterns:

**Success**:
```
Balance request received { userId: '...' }
Credentials retrieved { userId: '...', hasCredentials: true }
Making Poloniex v3 futures GET request to /v3/account/balance
Poloniex API response received { status: 200, hasData: true }
Transformed balance: { totalBalance: 1000, availableBalance: 500, ... }
```

**Failure**:
```
Balance request received { userId: '...' }
No credentials found for user { userId: '...' }
```

Or:
```
Credentials retrieved { userId: '...', hasCredentials: true }
Poloniex v3 futures API request error: { status: 401, data: {...} }
```
