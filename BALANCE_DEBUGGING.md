# Balance API Debugging Guide

## Current Status

The balance is not loading despite:
- ✅ API keys being whitelisted (both your IP and server IP)
- ✅ Credentials properly encrypted and stored in database
- ✅ Authentication working (you can log in)
- ✅ Other endpoints working (ticker data loading)

## What I've Added

### 1. Test Endpoint
**URL:** `https://polytrade-be.up.railway.app/api/test-balance`

This endpoint provides step-by-step debugging:
- Checks if credentials exist
- Shows API key/secret lengths
- Attempts balance fetch
- Returns detailed error information

**How to test:**
```bash
# Get your auth token from browser localStorage
# Then:
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://polytrade-be.up.railway.app/api/test-balance
```

### 2. Enhanced Logging
Added detailed logging to `poloniexFuturesService.js`:
- Logs API key prefix
- Logs timestamp
- Logs signature preview
- Logs all authentication headers

**Check logs:**
```bash
railway logs --service backend | grep -i "poloniex\|balance"
```

## What to Check

### 1. Check Test Endpoint Response
After deployment completes, visit:
```
https://polytrade-be.up.railway.app/api/test-balance
```

Look for:
- `success: true` or `false`
- `step`: which step failed
- `details`: error details from Poloniex

### 2. Check Backend Logs
Look for these log entries:
```
Making Poloniex v3 futures GET request to /v3/account/balance
```

Check if there's an error response from Poloniex.

### 3. Verify API Key Permissions
In Poloniex settings, ensure your API key has:
- ✅ Read permissions
- ✅ Futures trading enabled
- ✅ IP whitelist includes server IP

### 4. Check API Key Format
The API key should be:
- Format: `XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX`
- Length: ~35 characters
- No spaces or special characters

The API secret should be:
- Format: Hexadecimal string
- Length: ~128 characters

## Common Issues

### Issue 1: Wrong API Key Type
**Problem:** Using Spot API keys for Futures endpoints
**Solution:** Create new API keys specifically for Futures trading

### Issue 2: Insufficient Permissions
**Problem:** API key doesn't have Futures trading permission
**Solution:** Edit API key in Poloniex and enable Futures trading

### Issue 3: IP Whitelist Timing
**Problem:** IP was just added and hasn't propagated
**Solution:** Wait 5-10 minutes after adding IP to whitelist

### Issue 4: Signature Mismatch
**Problem:** Timestamp or signature generation issue
**Solution:** Check logs for signature details, compare with official docs

## Next Steps

1. **Wait for deployment** (usually 2-3 minutes)
2. **Check test endpoint** - Visit `/api/test-balance` with auth token
3. **Review logs** - Check Railway logs for detailed error messages
4. **Report findings** - Share the test endpoint response

## Official Documentation

- **Futures API:** https://api-docs.poloniex.com/v3/futures/api/
- **Authentication:** https://api-docs.poloniex.com/v3/futures/api/#authentication
- **Balance Endpoint:** https://api-docs.poloniex.com/v3/futures/api/account/balance

## Signature Format (for reference)

For GET `/v3/account/balance` with no parameters:
```
GET\n
/v3/account/balance\n
signTimestamp=1631018760000
```

HMAC-SHA256 with API secret, then Base64 encode.

## Contact

If issue persists after checking above:
- Email: api-support@poloniex.com
- Include: API key (first 8 chars only), timestamp, error message
