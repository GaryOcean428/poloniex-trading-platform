import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

async function checkDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔄 Connecting to database...');
    const client = await pool.connect();
    console.log('✅ Database connection established');

    // Check existing tables
    console.log('📊 Checking existing tables...');
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('📋 Existing tables:');
    tablesResult.rows.forEach(row => console.log(`  - ${row.table_name}`));

    // Check if users table exists and has demo users
    console.log('\n👥 Checking for demo users...');
    try {
      const usersResult = await client.query('SELECT username, email, role FROM users ORDER BY username');

      if (usersResult.rows.length === 0) {
        console.log('❌ No users found in database');
      } else {
        console.log('✅ Found users:');
        usersResult.rows.forEach(user => {
          console.log(`  - ${user.username} (${user.email}) - ${user.role}`);
        });
      }
    } catch (error) {
      console.log('❌ Error checking users:', error.message);
    }

    // Check if login_sessions table exists
    console.log('\n🔐 Checking login_sessions table...');
    try {
      const sessionsResult = await client.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'login_sessions'
        ORDER BY ordinal_position
      `);

      if (sessionsResult.rows.length === 0) {
        console.log('❌ login_sessions table not found');
      } else {
        console.log('✅ login_sessions table structure:');
        sessionsResult.rows.forEach(col => {
          console.log(`  - ${col.column_name}: ${col.data_type}`);
        });
      }
    } catch (error) {
      console.log('❌ Error checking login_sessions:', error.message);
    }

    client.release();
    console.log('\n🎉 Database check completed!');

  } catch (error) {
    console.error('❌ Database check failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkDatabase();
