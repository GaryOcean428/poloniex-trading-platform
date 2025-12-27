# Database Migration Guide

This guide explains how to run database migrations to fix the "trades table does not exist" error and set up the complete database schema.

## Quick Fix for Railway Deployment

### Run Migrations on Railway

1. **Access Railway CLI or Dashboard**:
   - Go to your Railway project: https://railway.app
   - Select the `polytrade-be` service
   - Open the terminal/shell

2. **Run the Migration Script**:
   ```bash
   node apps/api/run-migration.js
   ```

   This will:
   - Check and add `encryption_tag` column to `api_credentials` table
   - Create the `trades` table with all required columns
   - Display a summary of created tables

### Expected Output

```
🔄 Starting database migrations...

📝 Migration 1: Add encryption_tag column...
✅ encryption_tag column already exists

📝 Migration 2: Create trades table...
✅ Created trades table

📋 trades table columns:
   - id (uuid)
   - user_id (uuid)
   - strategy_id (character varying)
   - symbol (character varying)
   - side (character varying)
   - entry_price (numeric)
   - entry_time (timestamp with time zone)
   - quantity (numeric)
   - exit_price (numeric)
   - exit_time (timestamp with time zone)
   - pnl (numeric)
   - realized_pnl (numeric)
   - unrealized_pnl (numeric)
   - leverage (numeric)
   - stop_loss (numeric)
   - take_profit (numeric)
   - status (character varying)
   - entry_order_id (character varying)
   - exit_order_id (character varying)
   - notes (text)
   - trade_type (character varying)
   - created_at (timestamp with time zone)
   - updated_at (timestamp with time zone)

✨ All migrations completed successfully!
```

## What This Fixes

### 1. Missing "trades" Table Error
- **Error**: `ERROR: relation "trades" does not exist at character 346`
- **Fix**: Creates the trades table with proper schema
- **Impact**: Autonomous trading agent can now track trades properly

### 2. Backend Performance Metrics
- **Issue**: Backend couldn't query trade history
- **Fix**: Provides proper schema for storing trade records
- **Impact**: Performance dashboards and analytics will work

## Table Schema: trades

The `trades` table stores all trading activity with the following columns:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | References users table |
| `strategy_id` | VARCHAR(255) | Trading strategy identifier |
| `symbol` | VARCHAR(50) | Trading pair (e.g., BTC_USDT) |
| `side` | VARCHAR(10) | BUY, SELL, LONG, SHORT |
| `entry_price` | DECIMAL(30,18) | Entry price |
| `entry_time` | TIMESTAMP | Entry timestamp |
| `quantity` | DECIMAL(30,18) | Trade size |
| `exit_price` | DECIMAL(30,18) | Exit price |
| `exit_time` | TIMESTAMP | Exit timestamp |
| `pnl` | DECIMAL(30,18) | Total profit/loss |
| `realized_pnl` | DECIMAL(30,18) | Realized P&L (closed trades) |
| `unrealized_pnl` | DECIMAL(30,18) | Unrealized P&L (open trades) |
| `leverage` | DECIMAL(10,2) | Leverage multiplier |
| `stop_loss` | DECIMAL(30,18) | Stop loss price |
| `take_profit` | DECIMAL(30,18) | Take profit price |
| `status` | VARCHAR(20) | open, closed, cancelled, pending |
| `entry_order_id` | VARCHAR(255) | Entry order ID |
| `exit_order_id` | VARCHAR(255) | Exit order ID |
| `notes` | TEXT | Additional notes |
| `trade_type` | VARCHAR(50) | market, limit, stop, etc. |
| `created_at` | TIMESTAMP | Record creation time |
| `updated_at` | TIMESTAMP | Last update time |

### Indexes Created

For optimal query performance, the following indexes are created:

- `idx_trades_user_id` - Quick user lookup
- `idx_trades_strategy_id` - Strategy filtering
- `idx_trades_status` - Status filtering
- `idx_trades_created_at` - Time-based queries
- `idx_trades_user_status` - Combined user + status
- `idx_trades_symbol` - Symbol filtering

## Environment Variable Configuration

### Backend Environment Variables (Railway: polytrade-be)

Ensure these are set in Railway:

```bash
DATABASE_URL=<provided by Railway Postgres>
JWT_SECRET=<your-secure-jwt-secret>
API_ENCRYPTION_KEY=<generated with: openssl rand -base64 32>
NODE_ENV=production
POLONIEX_API_KEY=<your-poloniex-api-key>
POLONIEX_API_SECRET=<your-poloniex-api-secret>
FRONTEND_URL=https://poloniex-trading-platform-production.up.railway.app
```

### Frontend Environment Variables (Railway: polytrade-fe)

Ensure these are set in Railway:

```bash
VITE_BACKEND_URL=https://polytrade-be.up.railway.app
VITE_API_URL=https://polytrade-be.up.railway.app
VITE_WS_URL=wss://polytrade-be.up.railway.app
VITE_FORCE_MOCK_MODE=false
VITE_POLONIEX_API_KEY=<your-poloniex-api-key>
VITE_POLONIEX_API_SECRET=<your-poloniex-api-secret>
```

**IMPORTANT**: 
- Set `VITE_FORCE_MOCK_MODE=false` to enable live trading
- If `VITE_FORCE_MOCK_MODE=true`, the platform will use mock data instead of real API

## Troubleshooting

### Issue: Balance shows $0.00

**Possible Causes**:
1. VITE_FORCE_MOCK_MODE is set to `true`
2. API credentials are not configured
3. API keys don't have proper permissions

**Solution**:
1. Verify `VITE_FORCE_MOCK_MODE=false` in polytrade-fe Railway variables
2. Log into the platform and go to Settings > API Keys
3. Configure your Poloniex API credentials
4. Ensure API keys have "Read" and "Trade" permissions on Poloniex

### Issue: "trades table does not exist" error persists

**Solution**:
1. Run the migration again: `node apps/api/run-migration.js`
2. Check Railway logs for detailed error messages
3. Verify DATABASE_URL is properly set
4. Check PostgreSQL connection permissions

### Issue: Autonomous trading not executing

**Possible Causes**:
1. Mock mode is enabled
2. Live trading is disabled in configuration
3. API permissions are insufficient

**Solution**:
1. Set `VITE_FORCE_MOCK_MODE=false`
2. Ensure `liveTradingEnabled` resolves to `true` in EnvironmentManager
3. Verify API keys have "Trade" permissions (not just "Read")
4. Check autonomous agent configuration in the platform

## Local Development

To run migrations locally:

1. Ensure PostgreSQL is running
2. Set DATABASE_URL environment variable
3. Run migration:
   ```bash
   cd apps/api
   node run-migration.js
   ```

## Additional Resources

- [Poloniex API Documentation](https://docs.poloniex.com/)
- [Railway Deployment Guide](https://docs.railway.app/)
- [Setup Guide](./SETUP_GUIDE.md)

## Support

If you continue experiencing issues after running migrations:
1. Check Railway logs for both polytrade-fe and polytrade-be
2. Verify all environment variables are correctly set
3. Clear browser cache and localStorage
4. Try logging out and back in
