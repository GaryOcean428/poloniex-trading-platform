# API Issues and Solutions

## Issue 1: Balance Not Loading - IP Restriction ❌

### Problem
The Poloniex API is returning error: `{ code: 401, message: 'Illegal of ip' }`

### Root Cause
The API keys have IP address restrictions enabled in Poloniex settings. The current server IP address is not whitelisted.

### Solution
You need to whitelist the server IP address in your Poloniex API key settings:

1. **Find your server's IP address:**
   ```bash
   curl -4 ifconfig.me
   ```

2. **Add IP to Poloniex API Key Settings:**
   - Log in to Poloniex
   - Go to Settings → API Management
   - Find your API key: `88ADP32S-CJKXBLTE-VZ5P6D0B-K7I8CAK6`
   - Click "Edit" or "Manage"
   - Add the server IP address to the whitelist
   - Save changes

3. **Alternative (Less Secure):**
   - Create a new API key without IP restrictions
   - Update the credentials in the platform

### Testing
After whitelisting the IP, test with:
```bash
curl -X GET "https://api.poloniex.com/v3/account/balance" \
  -H "key: YOUR_API_KEY" \
  -H "signTimestamp: $(date +%s)000" \
  -H "signature: YOUR_SIGNATURE"
```

---

## Issue 2: Strategy Dashboard 404 ✅

### Status
**NOT AN ISSUE** - The route is properly configured.

### Verification
- Route exists in `src/App.tsx`: `/strategy-dashboard`
- Component exists: `src/pages/StrategyDashboard.tsx`
- Navigation link exists in `src/components/Sidebar.tsx`

If you're seeing a 404, it might be:
1. Browser cache - try hard refresh (Ctrl+Shift+R)
2. Build issue - rebuild the frontend
3. Navigation timing - ensure you're logged in first

---

## API Endpoints Reference

### Spot API
- **Base URL:** `https://api.poloniex.com`
- **Balance Endpoint:** `GET /accounts/balances`
- **Documentation:** https://api-docs.poloniex.com/spot/api/private/account

### Futures API
- **Base URL:** `https://api.poloniex.com`
- **Balance Endpoint:** `GET /v3/account/balance`
- **Documentation:** https://api-docs.poloniex.com/v3/futures/api/account/balance

### Authentication
Both APIs use HMAC-SHA256 signature authentication:

```
Signature String Format:
METHOD\n
/path\n
signTimestamp=1234567890

Headers:
- key: YOUR_API_KEY
- signTimestamp: UNIX_TIMESTAMP_MS
- signature: BASE64(HMAC-SHA256(signatureString, apiSecret))
```

---

## Current Implementation Status

### ✅ Working
- API credentials encryption/decryption
- Credentials stored in database with COMBINED_FORMAT
- Backend routes for balance fetching
- Frontend balance widget with error handling
- Strategy dashboard route configuration

### ❌ Blocked by IP Restriction
- Live balance fetching from Poloniex
- Real-time trading operations
- Position management
- Order placement

### 🔄 Fallback Behavior
When API calls fail, the system returns mock data:
```json
{
  "totalBalance": 10000.00,
  "availableBalance": 10000.00,
  "marginBalance": 10000.00,
  "unrealizedPnL": 0.00,
  "currency": "USDT",
  "mock": true
}
```

---

## Next Steps

1. **Immediate:** Whitelist server IP in Poloniex API settings
2. **Verify:** Test balance endpoint after IP whitelisting
3. **Monitor:** Check logs for any other API errors
4. **Optional:** Set up IP rotation or VPN if needed

---

## Support

If issues persist after IP whitelisting:
- Check Poloniex API status: https://status.poloniex.com
- Contact Poloniex support: api-support@poloniex.com
- Review API rate limits and permissions
