# Balance Display Data Flow - Visual Diagram

## Overview

This document provides visual representations of the balance display data flow, highlighting failure points and fixes.

---

## 1. Complete Data Flow (Happy Path)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                         USER INTERFACE (Frontend)                            │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                                                                     │    │
│  │  Settings Page                    Dashboard Page                   │    │
│  │  ┌──────────────┐                 ┌──────────────────────┐        │    │
│  │  │ Enter API    │                 │ AccountBalanceWidget │        │    │
│  │  │ Key & Secret │                 │                      │        │    │
│  │  │              │                 │  Shows: $10,234.56   │        │    │
│  │  │ [Save]       │                 │  Available: $8,123   │        │    │
│  │  └──────┬───────┘                 │  PnL: +$234.56       │        │    │
│  │         │                         └──────────┬───────────┘        │    │
│  │         │                                    │                     │    │
│  └─────────┼────────────────────────────────────┼─────────────────────┘    │
│            │                                    │                           │
│            │ POST /api/credentials              │ GET /api/dashboard/balance│
│            │                                    │                           │
└────────────┼────────────────────────────────────┼───────────────────────────┘
             │                                    │
             │                                    │
             ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                         BACKEND API (Express.js)                             │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                                                                     │    │
│  │  routes/credentials.ts            routes/dashboard.ts              │    │
│  │  ┌──────────────┐                 ┌──────────────────────┐        │    │
│  │  │ POST /       │                 │ GET /balance         │        │    │
│  │  │              │                 │                      │        │    │
│  │  │ Validate JWT │                 │ 1. Get credentials   │        │    │
│  │  │ Extract user │                 │ 2. Call Poloniex API │        │    │
│  │  │ Store creds  │                 │ 3. Transform data    │        │    │
│  │  └──────┬───────┘                 │ 4. Return balance    │        │    │
│  │         │                         └──────────┬───────────┘        │    │
│  │         │                                    │                     │    │
│  └─────────┼────────────────────────────────────┼─────────────────────┘    │
│            │                                    │                           │
│            │                                    │                           │
└────────────┼────────────────────────────────────┼───────────────────────────┘
             │                                    │
             │                                    │
             ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                    SERVICES LAYER (Business Logic)                           │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                                                                     │    │
│  │  apiCredentialsService.ts         poloniexFuturesService.js        │    │
│  │  ┌──────────────┐                 ┌──────────────────────┐        │    │
│  │  │ storeCredentials()             │ getAccountBalance()   │        │    │
│  │  │                                │                       │        │    │
│  │  │ 1. Encrypt with AES-256-GCM    │ 1. Generate signature │        │    │
│  │  │ 2. Store in database           │ 2. Make HTTP request  │        │    │
│  │  │                                │ 3. Parse response     │        │    │
│  │  └──────┬───────┘                 └──────────┬───────────┘        │    │
│  │         │                                    │                     │    │
│  │  ┌──────┴───────┐                           │                     │    │
│  │  │ getCredentials()                         │                     │    │
│  │  │                                          │                     │    │
│  │  │ 1. Query database                        │                     │    │
│  │  │ 2. Decrypt credentials                   │                     │    │
│  │  │ 3. Return to caller                      │                     │    │
│  │  └──────┬───────┘                           │                     │    │
│  │         │                                    │                     │    │
│  └─────────┼────────────────────────────────────┼─────────────────────┘    │
│            │                                    │                           │
│            │                                    │                           │
└────────────┼────────────────────────────────────┼───────────────────────────┘
             │                                    │
             │                                    │
             ▼                                    │
┌─────────────────────────────────────────────────┼───────────────────────────┐
│                                                 │                            │
│                    DATABASE (PostgreSQL)        │                            │
│                                                 │                            │
│  ┌────────────────────────────────────────────┐│                            │
│  │                                             ││                            │
│  │  api_credentials table                     ││                            │
│  │  ┌──────────────────────────────────────┐  ││                            │
│  │  │ id                    UUID            │  ││                            │
│  │  │ user_id               UUID            │  ││                            │
│  │  │ exchange              VARCHAR         │  ││                            │
│  │  │ api_key_encrypted     TEXT            │  ││                            │
│  │  │ api_secret_encrypted  TEXT            │  ││                            │
│  │  │ encryption_iv         TEXT            │  ││                            │
│  │  │ encryption_tag        TEXT  ← CRITICAL│  ││                            │
│  │  │ is_active             BOOLEAN         │  ││                            │
│  │  │ created_at            TIMESTAMP       │  ││                            │
│  │  │ updated_at            TIMESTAMP       │  ││                            │
│  │  └──────────────────────────────────────┘  ││                            │
│  │                                             ││                            │
│  └─────────────────────────────────────────────┘│                            │
│                                                 │                            │
└─────────────────────────────────────────────────┼────────────────────────────┘
                                                  │
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                    EXTERNAL API (Poloniex)                                   │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                                                                     │    │
│  │  GET https://api.poloniex.com/v3/account/balance                   │    │
│  │                                                                     │    │
│  │  Headers:                                                           │    │
│  │    key: YOUR_API_KEY                                                │    │
│  │    signature: HMAC-SHA256(message, secret)                          │    │
│  │    signTimestamp: 1234567890                                        │    │
│  │    signatureMethod: hmacSHA256                                      │    │
│  │    signatureVersion: 2                                              │    │
│  │                                                                     │    │
│  │  Response:                                                          │    │
│  │  {                                                                  │    │
│  │    "code": 200,                                                     │    │
│  │    "data": {                                                        │    │
│  │      "eq": "10234.56",        // Total equity                       │    │
│  │      "availMgn": "8123.00",   // Available margin                   │    │
│  │      "upl": "234.56"           // Unrealized PnL                    │    │
│  │    }                                                                │    │
│  │  }                                                                  │    │
│  │                                                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Failure Points and Error Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FAILURE POINT #1                                     │
│                    Database Connection (ECONNRESET)                          │
└─────────────────────────────────────────────────────────────────────────────┘

Frontend Request
      │
      ▼
Backend: GET /api/dashboard/balance
      │
      ▼
apiCredentialsService.getCredentials()
      │
      ▼
pool.query("SELECT * FROM api_credentials...")
      │
      ▼
   ❌ ERROR: read ECONNRESET
      │
      ├─ Current Behavior: Throws error → 500 response → Frontend shows error
      │
      └─ Fixed Behavior: Retry 3 times → If still fails, return null → Mock data


┌─────────────────────────────────────────────────────────────────────────────┐
│                         FAILURE POINT #2                                     │
│                    Missing Encryption Tag                                    │
└─────────────────────────────────────────────────────────────────────────────┘

Database Query Returns:
{
  api_key_encrypted: "abc123...",
  api_secret_encrypted: "def456...",
  encryption_iv: "789ghi...",
  encryption_tag: null  ← MISSING!
}
      │
      ▼
Check: if (!stored.encryption_tag)
      │
      ├─ Current Behavior: Returns null → Mock data shown
      │
      └─ Fixed Behavior: Deactivate credential → Return null with reason


┌─────────────────────────────────────────────────────────────────────────────┐
│                         FAILURE POINT #3                                     │
│                    Decryption Failure                                        │
└─────────────────────────────────────────────────────────────────────────────┘

encryptionService.decryptCredentials()
      │
      ▼
crypto.createDecipheriv()
      │
      ▼
decipher.setAuthTag(tagBuffer)
      │
      ▼
   ❌ ERROR: Unsupported state or unable to authenticate data
      │
      ├─ Current Behavior: Throws error → 500 response
      │
      └─ Fixed Behavior: Catch error → Deactivate credential → Return null


┌─────────────────────────────────────────────────────────────────────────────┐
│                         FAILURE POINT #4                                     │
│                    Poloniex API Authentication                               │
└─────────────────────────────────────────────────────────────────────────────┘

poloniexFuturesService.getAccountBalance()
      │
      ▼
axios.get("https://api.poloniex.com/v3/account/balance")
      │
      ▼
   ❌ ERROR: 401 Unauthorized
      │
      ├─ Possible Causes:
      │  - Invalid API key/secret
      │  - API key not enabled for Futures
      │  - IP not whitelisted
      │  - Signature mismatch
      │
      ├─ Current Behavior: Throws error → 500 response
      │
      └─ Fixed Behavior: Catch error → Return mock data with specific message


┌─────────────────────────────────────────────────────────────────────────────┐
│                         FAILURE POINT #5                                     │
│                    Poloniex API Rate Limit                                   │
└─────────────────────────────────────────────────────────────────────────────┘

axios.get("https://api.poloniex.com/v3/account/balance")
      │
      ▼
   ❌ ERROR: 429 Too Many Requests
      │
      ├─ Current Behavior: Throws error → 500 response
      │
      └─ Fixed Behavior: Retry with exponential backoff → If still fails, cache
```

---

## 3. Error Handling Flow (Improved)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    IMPROVED ERROR HANDLING FLOW                              │
└─────────────────────────────────────────────────────────────────────────────┘

GET /api/dashboard/balance
      │
      ├─ Step 1: Check if credentials exist
      │           │
      │           ├─ No → Return mock data with reason: "no_credentials"
      │           │       Message: "Please add API credentials in Settings"
      │           │
      │           └─ Yes → Continue
      │
      ├─ Step 2: Try to retrieve credentials
      │           │
      │           ├─ Database Error → Retry 3 times
      │           │                   │
      │           │                   ├─ Success → Continue
      │           │                   │
      │           │                   └─ Fail → Return mock data with reason: "database_error"
      │           │                             Message: "Temporary database issue, showing cached data"
      │           │
      │           ├─ Missing Tag → Return mock data with reason: "credentials_invalid"
      │           │                Message: "Please re-enter API credentials"
      │           │
      │           └─ Decryption Error → Return mock data with reason: "credentials_invalid"
      │                                  Message: "Please re-enter API credentials"
      │
      ├─ Step 3: Try Poloniex Futures API
      │           │
      │           ├─ Success → Return real balance
      │           │
      │           ├─ 401 Error → Return mock data with reason: "api_auth_failed"
      │           │              Message: "Invalid API credentials or IP not whitelisted"
      │           │
      │           ├─ 429 Error → Retry with backoff
      │           │              │
      │           │              ├─ Success → Return real balance
      │           │              │
      │           │              └─ Fail → Return mock data with reason: "rate_limit"
      │           │                        Message: "Too many requests, try again later"
      │           │
      │           └─ Other Error → Try Spot API as fallback
      │                            │
      │                            ├─ Success → Return real balance
      │                            │
      │                            └─ Fail → Return mock data with reason: "api_error"
      │                                      Message: "Unable to connect to Poloniex"
      │
      └─ Step 4: Return response
                  │
                  ├─ Real Balance:
                  │  {
                  │    success: true,
                  │    data: { totalBalance: 10234.56, ... }
                  │  }
                  │
                  └─ Mock Balance:
                     {
                       success: true,
                       data: { totalBalance: 10000.00, ... },
                       mock: true,
                       reason: "no_credentials",
                       message: "Please add API credentials in Settings",
                       action: { text: "Go to Settings", link: "/settings" }
                     }
```

---

## 4. Frontend Error Display Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FRONTEND ERROR DISPLAY                                    │
└─────────────────────────────────────────────────────────────────────────────┘

AccountBalanceWidget.fetchBalance()
      │
      ▼
dashboardService.getBalance()
      │
      ▼
Response received
      │
      ├─ response.mock === false
      │  │
      │  └─ Display real balance
      │     ┌────────────────────────────────┐
      │     │ Account Balance                │
      │     │ Total: $10,234.56              │
      │     │ Available: $8,123.00           │
      │     │ PnL: +$234.56 ↑                │
      │     └────────────────────────────────┘
      │
      └─ response.mock === true
         │
         ├─ reason: "no_credentials"
         │  │
         │  └─ Display warning with action
         │     ┌────────────────────────────────┐
         │     │ ⚠️ API Credentials Required    │
         │     │                                │
         │     │ Add your Poloniex API          │
         │     │ credentials to see real        │
         │     │ balance.                       │
         │     │                                │
         │     │ [Go to Settings]               │
         │     └────────────────────────────────┘
         │
         ├─ reason: "credentials_invalid"
         │  │
         │  └─ Display warning with action
         │     ┌────────────────────────────────┐
         │     │ ⚠️ Credentials Need Update     │
         │     │                                │
         │     │ Your API credentials need to   │
         │     │ be re-entered due to a         │
         │     │ security update.               │
         │     │                                │
         │     │ [Update Credentials]           │
         │     └────────────────────────────────┘
         │
         ├─ reason: "api_auth_failed"
         │  │
         │  └─ Display error with help
         │     ┌────────────────────────────────┐
         │     │ ❌ API Authentication Failed   │
         │     │                                │
         │     │ Possible issues:               │
         │     │ • Invalid API key/secret       │
         │     │ • Futures trading not enabled  │
         │     │ • IP not whitelisted           │
         │     │                                │
         │     │ [Check Poloniex Settings]      │
         │     │ [Retry]                        │
         │     └────────────────────────────────┘
         │
         └─ reason: "api_error"
            │
            └─ Display error with retry
               ┌────────────────────────────────┐
               │ ⚠️ Connection Issue            │
               │                                │
               │ Unable to fetch balance from   │
               │ Poloniex. This may be          │
               │ temporary.                     │
               │                                │
               │ [Retry Now]                    │
               │                                │
               │ Showing demo balance: $10,000  │
               └────────────────────────────────┘
```

---

## 5. Database Connection Resilience

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    RESILIENT DATABASE CONNECTION                             │
└─────────────────────────────────────────────────────────────────────────────┘

Application starts
      │
      ▼
Initialize connection pool
      │
      ├─ Configuration:
      │  • max: 10 connections
      │  • min: 2 connections
      │  • keepAlive: true
      │  • connectionTimeout: 10s
      │  • idleTimeout: 30s
      │
      ▼
Start health check interval (every 30s)
      │
      ▼
Query requested
      │
      ├─ Check circuit breaker
      │  │
      │  ├─ Open → Reject immediately
      │  │         "Database unavailable, retry in Xs"
      │  │
      │  └─ Closed → Continue
      │
      ├─ Attempt 1
      │  │
      │  ├─ Success → Return result
      │  │
      │  └─ Error (ECONNRESET)
      │     │
      │     ├─ Is retryable? → Yes
      │     │
      │     └─ Wait 1s → Attempt 2
      │                  │
      │                  ├─ Success → Return result
      │                  │
      │                  └─ Error
      │                     │
      │                     └─ Wait 2s → Attempt 3
      │                                  │
      │                                  ├─ Success → Return result
      │                                  │
      │                                  └─ Error
      │                                     │
      │                                     ├─ Open circuit breaker
      │                                     │  (Reset after 60s)
      │                                     │
      │                                     └─ Throw error
      │
      └─ Health check (every 30s)
         │
         ├─ Query: SELECT 1
         │  │
         │  ├─ Success → Mark healthy
         │  │
         │  └─ Fail → Mark unhealthy
         │            Log warning
         │
         └─ Monitor pool status
            • Total connections
            • Idle connections
            • Waiting requests
```

---

## 6. Complete Fix Implementation Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    IMPLEMENTATION ROADMAP                                    │
└─────────────────────────────────────────────────────────────────────────────┘

Phase 1: Critical Fixes (Day 1)
├─ Database Layer
│  ├─ ✅ Create resilient-connection.js
│  ├─ ✅ Add retry logic with exponential backoff
│  ├─ ✅ Add circuit breaker pattern
│  ├─ ✅ Add health check mechanism
│  └─ ✅ Add connection pool monitoring
│
├─ API Credentials Service
│  ├─ ✅ Create apiCredentialsService-improved.ts
│  ├─ ✅ Add graceful error handling
│  ├─ ✅ Return null instead of throwing
│  ├─ ✅ Add credential validation
│  └─ ✅ Add status checking
│
└─ Database Migration
   ├─ ✅ Verify 006_add_encryption_tag.sql exists
   ├─ ⏳ Run migration on production
   └─ ⏳ Verify encryption_tag column added

Phase 2: Enhanced Error Handling (Day 2)
├─ Dashboard Balance Endpoint
│  ├─ ⏳ Add detailed error responses
│  ├─ ⏳ Add reason codes for mock data
│  ├─ ⏳ Add retry logic for API calls
│  └─ ⏳ Add fallback to Spot API
│
├─ Frontend Balance Widget
│  ├─ ⏳ Add specific error messages
│  ├─ ⏳ Add actionable buttons
│  ├─ ⏳ Add automatic retry
│  └─ ⏳ Add loading states
│
└─ Poloniex Service
   ├─ ⏳ Add retry logic
   ├─ ⏳ Add rate limit handling
   └─ ⏳ Add better error messages

Phase 3: Monitoring & Testing (Day 3)
├─ Diagnostic Tools
│  ├─ ✅ Create diagnose-balance-flow.js
│  ├─ ✅ Create quick-fix-balance.sh
│  └─ ⏳ Add automated tests
│
├─ Monitoring
│  ├─ ⏳ Add health check endpoints
│  ├─ ⏳ Add metrics collection
│  └─ ⏳ Add alerting
│
└─ Documentation
   ├─ ✅ Create BALANCE_DISPLAY_ANALYSIS.md
   ├─ ✅ Create BALANCE_FLOW_DIAGRAM.md
   └─ ⏳ Update user documentation

Legend:
✅ Complete
⏳ Pending
❌ Blocked
```

---

## 7. User Journey - Before and After

### BEFORE (Current State)

```
User adds API credentials
      │
      ▼
Credentials stored in database
      │
      ▼
User goes to Dashboard
      │
      ▼
Balance widget loads
      │
      ▼
Backend tries to get credentials
      │
      ▼
❌ Database connection fails (ECONNRESET)
      │
      ▼
500 Internal Server Error
      │
      ▼
Frontend shows: "Unable to load balance"
      │
      ▼
User sees: $0.00 or error message
      │
      ▼
😞 User frustrated, tries again
      │
      ▼
Same error repeats
      │
      ▼
😡 User gives up
```

### AFTER (Fixed State)

```
User adds API credentials
      │
      ▼
Credentials stored with encryption_tag
      │
      ▼
User goes to Dashboard
      │
      ▼
Balance widget loads
      │
      ▼
Backend tries to get credentials
      │
      ├─ Database connection fails
      │  │
      │  ▼
      │  Retry 3 times with backoff
      │  │
      │  ├─ Success → Continue
      │  │
      │  └─ Still fails → Return null
      │
      ▼
Check if credentials exist
      │
      ├─ No credentials
      │  │
      │  ▼
      │  Show: "⚠️ API Credentials Required"
      │  │     "Add your Poloniex API credentials"
      │  │     [Go to Settings]
      │  │
      │  └─ User clicks button → Goes to Settings
      │
      ├─ Credentials invalid (no tag)
      │  │
      │  ▼
      │  Show: "⚠️ Credentials Need Update"
      │  │     "Please re-enter your API credentials"
      │  │     [Update Credentials]
      │  │
      │  └─ User clicks button → Goes to Settings
      │
      └─ Credentials valid
         │
         ▼
         Call Poloniex API
         │
         ├─ Success
         │  │
         │  ▼
         │  Show real balance: $10,234.56
         │  │
         │  └─ 😊 User happy
         │
         └─ API error
            │
            ▼
            Show: "⚠️ Connection Issue"
            │     "Unable to fetch from Poloniex"
            │     [Retry Now]
            │     "Showing demo balance: $10,000"
            │
            └─ User clicks Retry → Try again
```

---

## Summary

This visual diagram shows:

1. **Complete data flow** from user input to balance display
2. **All failure points** with specific error scenarios
3. **Improved error handling** with graceful degradation
4. **Frontend error display** with actionable messages
5. **Database resilience** with retry and circuit breaker
6. **Implementation roadmap** with phases and tasks
7. **User journey** comparison before and after fixes

The key improvements are:
- ✅ Retry logic for transient failures
- ✅ Graceful degradation instead of crashes
- ✅ Specific error messages with actions
- ✅ Circuit breaker for database protection
- ✅ Health monitoring and diagnostics
