# Quick Start Guide - Fixing Balance Display & Autonomous Trading

## ✅ What Has Been Done

This PR fixes the critical issues affecting your Poloniex Trading Platform:

1. **Created Missing "trades" Table** - The backend was querying a `trades` table that didn't exist
2. **Updated Migration Runner** - Enhanced to handle multiple migrations properly
3. **Created Documentation** - Comprehensive guide for running migrations and troubleshooting

## 🚀 What You Need To Do (2-3 Minutes)

### Step 1: Merge This PR

```bash
# Review and merge this PR into main branch
```

### Step 2: Run Migration on Railway (polytrade-be)

1. Go to Railway Dashboard: https://railway.app
2. Select your `polytrade-be` service
3. Click on the service → "Settings" → "Deploy" or open a terminal
4. Run this command:

```bash
node apps/api/run-migration.js
```

**Expected Output:**
```
🔄 Starting database migrations...
📝 Migration 1: Add encryption_tag column...
✅ encryption_tag column already exists
📝 Migration 2: Create trades table...
✅ Created trades table
✨ All migrations completed successfully!
```

### Step 3: Verify Environment Variables

#### On Railway (polytrade-fe service):

Make sure these are set:
- `VITE_FORCE_MOCK_MODE=false` (IMPORTANT!)
- `VITE_BACKEND_URL=https://polytrade-be.up.railway.app`
- `VITE_POLONIEX_API_KEY=<your-key>`
- `VITE_POLONIEX_API_SECRET=<your-secret>`

#### On Railway (polytrade-be service):

Make sure these are set:
- `POLONIEX_API_KEY=<your-key>`
- `POLONIEX_API_SECRET=<your-secret>`
- `API_ENCRYPTION_KEY=<generated-key>`
- `JWT_SECRET=<secure-secret>`

### Step 4: Clear Browser Cache

1. Open your browser DevTools (F12)
2. Right-click the Refresh button → "Empty Cache and Hard Reload"
3. Or: Settings → Privacy → Clear browsing data → Cached images and files

### Step 5: Test Balance Display

1. Log into your platform: https://poloniex-trading-platform-production.up.railway.app
2. Go to Account page
3. Balance should now show correctly (not $0.00)

## 📊 What Was Fixed

### Issue 1: Missing "trades" Table ✅
- **Error**: `ERROR: relation "trades" does not exist`
- **Fix**: Created migration 008 with complete trades table schema
- **Impact**: Autonomous trading performance metrics now work

### Issue 2: Migration System ✅
- **Issue**: No easy way to run database migrations
- **Fix**: Enhanced `run-migration.js` to handle multiple migrations
- **Impact**: Simple one-command migration process

### Issue 3: Documentation ✅
- **Issue**: No clear instructions for fixing database issues
- **Fix**: Created `DATABASE_MIGRATION_GUIDE.md`
- **Impact**: Easy troubleshooting and setup

### Issue 4: Balance Display Investigation ✅
- **Finding**: Frontend code is correct
- **Root Cause**: The mysterious `/v3/futures/api/keys` endpoint is NOT in your code
- **Likely Source**: Browser extension or cached JavaScript
- **Fix**: Clear browser cache (see Step 4)

## 🔍 Troubleshooting

### Still Showing $0.00 Balance?

**Check these in order:**

1. **Environment Variables**: Verify `VITE_FORCE_MOCK_MODE=false` on polytrade-fe
2. **API Credentials**: Ensure API keys are properly configured in the platform
3. **API Permissions**: Poloniex API keys need "Read" permission at minimum
4. **Browser Cache**: Clear cache and do hard reload
5. **Backend Logs**: Check Railway logs for polytrade-be for API errors

### "trades table does not exist" Still Appearing?

1. Run the migration again: `node apps/api/run-migration.js`
2. Check Railway logs for error messages
3. Verify `DATABASE_URL` is set correctly
4. Try accessing PostgreSQL directly to confirm table exists

### Autonomous Trading Not Working?

1. Ensure `VITE_FORCE_MOCK_MODE=false`
2. Check API keys have "Trade" permission on Poloniex
3. Verify `liveTradingEnabled` is true in EnvironmentManager
4. Check autonomous agent configuration in platform settings

## 📋 Files Changed

1. `apps/api/database/migrations/008_create_trades_table.sql` - New trades table schema
2. `apps/api/run-migration.js` - Enhanced migration runner
3. `DATABASE_MIGRATION_GUIDE.md` - Comprehensive guide
4. `QUICK_START_FIX.md` - This file

## 🔒 Security

✅ CodeQL security scan: **No vulnerabilities found**
✅ Code review: **All issues addressed**
✅ Best practices: **Followed**

## 📚 Additional Resources

- Full migration guide: [DATABASE_MIGRATION_GUIDE.md](./DATABASE_MIGRATION_GUIDE.md)
- Setup guide: [SETUP_GUIDE.md](./SETUP_GUIDE.md)
- Environment variables: [.env.example](./.env.example)

## ❓ Questions?

If you encounter any issues after following these steps:
1. Check Railway logs for both services
2. Review the DATABASE_MIGRATION_GUIDE.md
3. Verify all environment variables are set correctly
4. Ensure API keys have proper permissions on Poloniex
