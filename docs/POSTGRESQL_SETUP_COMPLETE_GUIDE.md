# PostgreSQL Setup Complete Guide

## Current Status: ⚠️ **CONNECTIVITY ISSUES DETECTED**

### Connection Information Available
- **Public URL**: polygres.up.railway.app:5432
- **Internal URL**: postgres.railway.internal:5432
- **Database**: railway
- **Admin User**: postgres
- **Password**: [Use Railway environment variables]
- **Railway Token**: [Set via environment variable]

### Issues Encountered
1. **Direct psql connection hangs**: Connection attempts to public URL timeout
2. **Railway CLI internal connection fails**: Railway tries to use internal domain which doesn't resolve locally
3. **Name resolution issues**: Internal domain not accessible from local environment

## Database Setup Script Ready

I've created a complete database setup script (`complete_database_setup.sql`) that includes:

### Users to Create
- **GaryOcean** (username: GaryOcean, password: via environment variable)
- **braden_lang77** (username: braden_lang77, password: via environment variable)

### Application User Entry
- **Username**: GaryOcean
- **Email**: [Set via DB_ADMIN_EMAIL environment variable]
- **Password**: [Set via DB_USER_PASSWORD environment variable]
- **Role**: admin
- **Country**: AU (Australia)
- **Timezone**: Australia/Perth

### Database Features
- PostgreSQL with PostGIS and UUID extensions
- Complete user management system
- Geospatial location tracking
- Security audit logging
- Trading account management

## Environment Variables Required

Before running the setup script, set these environment variables:

```bash
export DB_USER_PASSWORD="your_secure_password"
export DB_ADMIN_EMAIL="your_admin_email@domain.com"
export RAILWAY_TOKEN="your_railway_token"
```

## Recommended Resolution Steps

### Option 1: Use Railway Dashboard (Recommended)
1. Go to https://railway.app/dashboard
2. Open your `polytrade-be` project
3. Click on the `Postgres` service
4. Use the **Query** tab in the Railway dashboard
5. Set the required environment variables in the Railway interface
6. Copy and paste the contents of `complete_database_setup.sql`
7. Execute the script directly in the Railway interface

### Option 2: Debug Connection Issues
1. Check if the PostgreSQL service is fully started in Railway dashboard
2. Verify the public domain is properly configured
3. Try connecting from a different network/location
4. Check Railway service logs for any errors

### Option 3: Use Railway Connect
```bash
export RAILWAY_TOKEN="your_railway_token"
railway connect Postgres
# Then run the SQL commands interactively
```

## Database Setup Script Usage

The `complete_database_setup.sql` script requires environment variables:

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users (using environment variables)
CREATE USER GaryOcean WITH PASSWORD :'DB_USER_PASSWORD' CREATEDB CREATEROLE LOGIN;
CREATE USER braden_lang77 WITH PASSWORD :'DB_USER_PASSWORD' CREATEDB CREATEROLE LOGIN;

-- Grant full privileges
GRANT ALL PRIVILEGES ON DATABASE railway TO GaryOcean;
GRANT ALL PRIVILEGES ON DATABASE railway TO braden_lang77;

-- Create users table with geospatial support
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'trader',
    registered_location GEOGRAPHY(POINT, 4326),
    country_code VARCHAR(2),
    timezone VARCHAR(50),
    -- ... (complete table structure)
);

-- Insert application user (using environment variables)
INSERT INTO users (username, email, password_hash, role, country_code, timezone, kyc_status, trading_enabled)
VALUES (
    'GaryOcean',
    :'DB_ADMIN_EMAIL',
    '$2b$10$RCUYLGMFvkS6jmki5Q3duOqATZEOAS5je/FQu9vATYBfb3MMGEyUG',
    'admin',
    'AU',
    'Australia/Perth',
    'approved',
    true
);
```

## Next Steps

1. **Set environment variables** with your actual values
2. **Execute the database setup script** using Railway dashboard or fixed connection
3. **Verify user creation** with:
   ```sql
   SELECT usename FROM pg_user WHERE usename IN ('GaryOcean', 'braden_lang77');
   SELECT username, email, role FROM users WHERE username = 'GaryOcean';
   ```
4. **Test application user login** with your configured credentials
5. **Update application connection strings** to use the public URL

## Connection Strings After Setup

### For Application Use
```
postgresql://GaryOcean:${DB_USER_PASSWORD}@polygres.up.railway.app:5432/railway
```

### For Admin Use
```
postgresql://postgres:${POSTGRES_PASSWORD}@polygres.up.railway.app:5432/railway
```

## Files Created
- `complete_database_setup.sql` - Complete database setup script (uses environment variables)
- `docs/RAILWAY_POSTGRES_SETUP_GUIDE.md` - Detailed setup guide
- `docs/POSTGRESQL_SETUP_COMPLETE_GUIDE.md` - This comprehensive guide

## Security Notes
- All sensitive information is now parameterized via environment variables
- No passwords, tokens, or email addresses are hard-coded
- Database user passwords must be set via environment variables
- Railway tokens should be managed through secure environment configuration

## Troubleshooting

If connection issues persist:
1. Check Railway service status and logs
2. Verify PostgreSQL service is running
3. Ensure public domain is properly configured
4. Try connecting from Railway web interface
5. Verify environment variables are correctly set
6. Contact Railway support if infrastructure issues exist

---
*Last Updated: January 16, 2025*
*Status: Ready for execution with environment variables configured*
