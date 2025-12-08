import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

async function checkUserSchema() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔄 Connecting to database...');
    const client = await pool.connect();
    console.log('✅ Database connection established');

    // Check users table structure
    console.log('\n👤 Checking users table structure...');
    const usersResult = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    console.log('📋 Users table columns:');
    usersResult.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? '(nullable)' : '(not null)'}`);
    });

    // Check geo_restrictions table structure
    console.log('\n🌍 Checking geo_restrictions table structure...');
    const geoResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'geo_restrictions'
      ORDER BY ordinal_position
    `);

    if (geoResult.rows.length > 0) {
      console.log('📋 Geo_restrictions table columns:');
      geoResult.rows.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? '(nullable)' : '(not null)'}`);
      });
    } else {
      console.log('❌ geo_restrictions table not found');
    }

    // Test the exact query that UserService.findUser uses
    console.log('\n🔍 Testing UserService.findUser query...');
    try {
      const testQuery = `
        SELECT
          u.id, u.username, u.email, u.password_hash, u.role,
          u.country_code, u.timezone, u.is_active, u.is_verified,
          u.kyc_status, u.trading_enabled, u.risk_level,
          u.created_at, u.updated_at, u.last_login_at,
          u.latitude, u.longitude,
          gr.trading_allowed as jurisdiction_trading_allowed,
          gr.kyc_required as jurisdiction_kyc_required,
          gr.futures_allowed as jurisdiction_futures_allowed
        FROM users u
        LEFT JOIN geo_restrictions gr ON u.country_code = gr.country_code
        WHERE u.username = $1 AND u.is_active = true
        LIMIT 1
      `;

      const testResult = await client.query(testQuery, ['demo']);
      console.log('✅ UserService query works! Found user:', testResult.rows[0]?.username);
    } catch (error) {
      console.log('❌ UserService query failed:', error.message);
      console.log('❌ This explains why login is failing!');
    }

    client.release();
    console.log('\n🎉 Schema check completed!');

  } catch (error) {
    console.error('❌ Schema check failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkUserSchema();
