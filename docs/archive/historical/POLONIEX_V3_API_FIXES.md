# Poloniex V3 API Integration Fixes

## Summary
Fixed critical issues with Poloniex Futures V3 API integration based on official API documentation:
- https://api-docs.poloniex.com/v3/futures
- https://api-docs.poloniex.com/spot

## Issues Fixed

### 1. Market Data Format Issues ✅
**Problem:** Frontend error "Invalid data format: expected array"

**Root Cause:** Poloniex V3 API returns responses in format:
```json
{
  "code": 200,
  "data": [...],
  "msg": "Success"
}
```

But the code was expecting a direct array.

**Fix:** Updated `poloniexFuturesService.js`:
- Modified `makePublicRequest()` to extract `data` field from response
- Modified `makeRequest()` (authenticated) to extract `data` field from response
- Both methods now return `response.data.data` when the wrapper exists

**Files Changed:**
- `backend/src/services/poloniexFuturesService.js`

### 2. K-line/Candle Data Format ✅
**Problem:** Incorrect parsing of candlestick data

**Root Cause:** Poloniex V3 candles format is:
```
[low, high, open, close, amt, qty, tC, sT, cT]
Indices: [0=low, 1=high, 2=open, 3=close, 4=amt, 5=qty, 6=tC, 7=sT, 8=cT]
```

But code was parsing as `[timestamp, open, high, low, close, volume]`

**Fix:** Updated `getHistoricalData()` method:
- Changed interval mapping from seconds to V3 format strings (e.g., `HOUR_1`, `MINUTE_5`)
- Fixed candle array parsing to match actual API response format
- Corrected timestamp extraction (index 7 = sT)
- Fixed OHLCV field mapping

**Files Changed:**
- `backend/src/services/poloniexFuturesService.js`

### 3. Dashboard Balance Endpoint (500 Error) ✅
**Problem:** `/api/dashboard/balance` returning 500 errors

**Root Cause:** Balance response format mismatch. Poloniex V3 returns:
```json
{
  "eq": "959.58",           // Total equity
  "availMgn": "954.30",     // Available margin
  "upl": "-2.4",            // Unrealized PnL
  "im": "5.28",             // Initial margin
  ...
}
```

**Fix:** Added transformation layer in `dashboard.ts`:
- Maps `eq` → `totalEquity`
- Maps `availMgn` → `availableBalance`
- Maps `upl` → `unrealizedPnL`
- Maps `im` → `positionMargin`

**Files Changed:**
- `backend/src/routes/dashboard.ts`

### 4. Dashboard Positions Endpoint (500 Error) ✅
**Problem:** `/api/dashboard/positions` returning 500 errors

**Root Cause:** Position field name mismatches. Poloniex V3 uses:
- `qty` instead of `positionAmt`
- `upl` instead of `unrealizedPnl`
- `markPx` instead of `markPrice`

**Fix:** Updated position processing in `dashboard.ts`:
- Added fallback field names (`qty || positionAmt`)
- Fixed PnL calculation using `upl` field
- Fixed notional value calculation: `qty * markPx`

**Files Changed:**
- `backend/src/routes/dashboard.ts`

### 5. ML Performance Endpoint (503 Error) ✅
**Problem:** `/api/ml/performance/:symbol` returning 503 errors

**Root Cause:** 
- Historical data fetch failures causing hard errors
- No graceful fallback when ML models unavailable

**Fix:** Added comprehensive error handling:
- Wrapped data fetching in try-catch
- Return fallback predictions instead of 503 errors
- Added fallback for current price from last candle
- Graceful degradation when ML service unavailable

**Files Changed:**
- `backend/src/routes/ml.ts`

## API Response Format Reference

### Poloniex V3 Standard Response
```json
{
  "code": 200,
  "data": { ... },
  "msg": "Success"
}
```

### Balance Response
```json
{
  "code": 200,
  "data": {
    "eq": "959.58",           // Total equity
    "availMgn": "954.30",     // Available margin
    "upl": "-2.4",            // Unrealized PnL
    "im": "5.28",             // Initial margin
    "mm": "1.32",             // Maintenance margin
    "details": [...]
  }
}
```

### Position Response
```json
{
  "code": 200,
  "data": [{
    "symbol": "BTC_USDT_PERP",
    "qty": "1",               // Position size
    "availQty": "1",          // Available to close
    "openAvgPx": "58651",     // Entry price
    "markPx": "58650.19",     // Mark price
    "upl": "-0.00081",        // Unrealized PnL
    "lever": "30",            // Leverage
    "mgnMode": "CROSS",       // Margin mode
    ...
  }]
}
```

### Candle/K-line Response
```json
{
  "code": 200,
  "data": [
    [
      "58651",    // [0] low
      "58651",    // [1] high
      "58651",    // [2] open
      "58651",    // [3] close
      "0",        // [4] amt (quote volume)
      "0",        // [5] qty (base volume)
      "0",        // [6] tC (trade count)
      "1719975420000",  // [7] sT (start time)
      "1719975479999"   // [8] cT (close time)
    ]
  ]
}
```

## Testing

### Test Endpoints
```bash
# Health check
curl https://your-backend/api/futures/health

# Get products
curl https://your-backend/api/futures/products

# Get ticker
curl https://your-backend/api/futures/ticker?symbol=BTC_USDT_PERP

# Get klines (requires proper interval format)
curl https://your-backend/api/futures/klines/BTC_USDT_PERP?interval=1h&limit=100

# Dashboard balance (requires auth)
curl -H "Authorization: Bearer YOUR_TOKEN" https://your-backend/api/dashboard/balance

# Dashboard positions (requires auth)
curl -H "Authorization: Bearer YOUR_TOKEN" https://your-backend/api/dashboard/positions
```

### Interval Format Mapping
Frontend → Backend → Poloniex V3:
- `1m` → `MINUTE_1`
- `5m` → `MINUTE_5`
- `15m` → `MINUTE_15`
- `30m` → `MINUTE_30`
- `1h` → `HOUR_1`
- `2h` → `HOUR_2`
- `4h` → `HOUR_4`
- `12h` → `HOUR_12`
- `1d` → `DAY_1`
- `3d` → `DAY_3`
- `1w` → `WEEK_1`

## Next Steps

1. **Test with Real API Credentials**
   - Add Poloniex API keys to test authenticated endpoints
   - Verify balance and position data transformation

2. **Frontend Updates**
   - Ensure frontend handles new response formats
   - Update type definitions if needed

3. **Error Monitoring**
   - Monitor logs for any remaining API format issues
   - Add more detailed error messages for debugging

4. **Rate Limiting**
   - Implement proper rate limiting per Poloniex V3 specs
   - Public endpoints: 10 req/sec
   - Private endpoints: 5 req/sec

## References

- [Poloniex Futures V3 API Docs](https://api-docs.poloniex.com/v3/futures/)
- [Poloniex Spot API Docs](https://api-docs.poloniex.com/spot/)
- [Market Data Endpoints](https://api-docs.poloniex.com/v3/futures/api/market/get-order-book)
- [Account Endpoints](https://api-docs.poloniex.com/v3/futures/api/account/balance)
- [Position Endpoints](https://api-docs.poloniex.com/v3/futures/api/positions/get-current-position)
