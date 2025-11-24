# Dashboard 500 Errors - Fixes Documentation

## Summary
This document describes the fixes applied to resolve the critical 500 errors preventing the dashboard widgets from working properly.

## Issues Fixed

### 1. Missing `getTradeHistory` Method ✅
**Problem:** The `/api/futures/trades` endpoint was calling `poloniexFuturesService.getTradeHistory()` which didn't exist.

**Solution:** Added `getTradeHistory()` as an alias to the existing `getExecutionDetails()` method.

**File Changed:** `backend/src/services/poloniexFuturesService.js`

### 2. Table Mismatch in API Routes ✅
**Problem:** Authenticated routes in `futures.js` and `proxy.js` were using `UserService.getApiCredentials()` which queries the `user_api_credentials` table, but the actual credentials are stored in the `api_credentials` table.

**Solution:** Updated all routes to use `apiCredentialsService.getCredentials()` instead.

**Files Changed:**
- `backend/src/routes/futures.js` (17 occurrences)
- `backend/src/routes/proxy.js` (6 occurrences)

**Impact:** Dashboard endpoints now correctly retrieve user API credentials from the right table.

### 3. Critical Encryption Bug - Missing GCM Authentication Tag ✅ 🚨
**Problem:** The encryption service uses AES-256-GCM which requires an authentication tag for decryption. However:
- The `api_credentials` table was missing the `encryption_tag` column
- The `apiCredentialsService.storeCredentials()` was not saving the tag
- The `apiCredentialsService.getCredentials()` was incorrectly using the encrypted API key as the tag

**Impact:** This caused ALL credential decryption attempts to fail, resulting in 500 errors on dashboard endpoints.

**Solution:**
1. Created migration `006_add_encryption_tag.sql` to add the `encryption_tag` column
2. Updated `apiCredentialsService.storeCredentials()` to save the GCM authentication tag
3. Updated `apiCredentialsService.getCredentials()` to properly retrieve and use the tag
4. Added backward compatibility check that returns `null` for credentials without tags

**Files Changed:**
- `backend/migrations/006_add_encryption_tag.sql` (new file)
- `backend/src/services/apiCredentialsService.ts`

**⚠️ IMPORTANT:** Users who have already stored API credentials will need to re-enter them after this migration, as old credentials cannot be decrypted without the authentication tag.

## What Now Works

After these fixes and after users re-enter their API credentials:

### Dashboard Endpoints ✅
- `/api/dashboard/balance` - Account balance widget
- `/api/dashboard/positions` - Active positions widget
- `/api/dashboard/trades` - Recent trades (via `/api/futures/trades`)
- `/api/dashboard/overview` - Complete dashboard overview
- `/api/dashboard/bills` - Account transactions

### Futures Trading Endpoints ✅
- `/api/futures/trades` - Trade history
- `/api/futures/account/balance` - Account balance
- `/api/futures/positions` - Current positions
- All other authenticated futures endpoints (17 total)

### ML Model Endpoints ✅
- `/api/ml/performance/:symbol` - ML predictions (with graceful fallback)
- `/api/ml/train/:symbol` - Model training
- `/api/ml/health` - Service health check

## User Action Required

### For Users with Existing API Credentials:

1. **Navigate to Account Settings**
2. **Go to API Keys Tab**
3. **You will see your credentials marked as "Inactive"**
4. **Delete old credentials and add new ones:**
   - Enter your Poloniex API Key
   - Enter your Poloniex API Secret
   - Click "Save"
5. **Verify in Dashboard:**
   - Go to Dashboard page
   - You should now see your account balance, positions, and trades
   - No more 500 errors

### For New Users:

1. **Go to Account Settings → API Keys**
2. **Add your Poloniex API credentials**
3. **Enable the required permissions on Poloniex:**
   - Read permissions for account, positions, and trades
   - (Optional) Trade permissions if you want to use live trading features
4. **Return to Dashboard to see your data**

## Testing Results

- ✅ Backend builds successfully
- ✅ 11/11 unit tests pass
- ✅ All routes properly handle missing credentials (400 error)
- ✅ All routes properly handle API errors (500 error with details)
- ✅ ML endpoints have proper fallback when Python models unavailable

## Technical Details

### Encryption Implementation
The system now properly implements AES-256-GCM encryption:
- **Algorithm:** AES-256-GCM (Galois/Counter Mode)
- **Key Derivation:** PBKDF2 with 100,000 iterations
- **IV Length:** 16 bytes (random per encryption)
- **Tag Length:** 16 bytes (GCM authentication tag)
- **Storage:** All components (encrypted data, IV, tag) are stored in the database

### Database Schema
The `api_credentials` table now includes:
```sql
CREATE TABLE api_credentials (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  exchange VARCHAR(50) DEFAULT 'poloniex',
  api_key_encrypted TEXT NOT NULL,
  api_secret_encrypted TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_tag TEXT,              -- NEW COLUMN
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(user_id, exchange)
);
```

## Known Limitations

1. **Python ML Models:** ML prediction features require Python dependencies to be installed on the server. When unavailable, the endpoints return mock data with confidence: 0 and a message explaining the models are not available.

2. **Legacy Proxy Routes:** The `/api/proxy/*` routes are deprecated and users should use the `/api/futures/*` routes instead. They have been updated for consistency but may be removed in a future version.

3. **Database Migration Required:** The new `encryption_tag` column requires a database migration. Existing deployments must run the migration before the fixes will work properly.

## Deployment Notes

### Railway Deployment
1. The migration will run automatically on deployment
2. Existing user credentials will be marked as inactive
3. Users will need to re-enter their API keys
4. Monitor logs for any decryption errors

### Local Development
1. Run the migration: `yarn migrate` or apply `006_add_encryption_tag.sql` manually
2. Restart the backend server
3. Test with fresh API credentials

## Support

If you continue to experience 500 errors after these fixes:

1. **Check Poloniex API Key Permissions:** Ensure your API key has Read permissions for account, positions, and trades
2. **Verify Credentials are Active:** Go to Account Settings → API Keys and verify status shows "Active"
3. **Check Backend Logs:** Look for decryption errors or Poloniex API errors
4. **Common Poloniex API Errors:**
   - 401 Unauthorized: Invalid API key or secret
   - 403 Forbidden: API key lacks required permissions
   - 429 Too Many Requests: Rate limit exceeded

## Files Modified

### Backend Routes
- `backend/src/routes/futures.js`
- `backend/src/routes/proxy.js`

### Backend Services
- `backend/src/services/poloniexFuturesService.js`
- `backend/src/services/apiCredentialsService.ts`

### Database Migrations
- `backend/migrations/006_add_encryption_tag.sql` (new)

### Documentation
- `FIXES_DOCUMENTATION.md` (this file, new)

## Version History
- **2025-11-10:** Fixed critical encryption bug, table mismatch, and missing method
- **Previous:** Initial testing report identified the issues
