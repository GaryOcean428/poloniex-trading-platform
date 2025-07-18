import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

async function createDemoUsers() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔄 Connecting to database...');
    const client = await pool.connect();
    console.log('✅ Database connection established');

    // Hash the password 'password' for demo users
    const passwordHash = await bcrypt.hash('password', 12);
    console.log('🔐 Password hash generated');

    // Create demo users
    const demoUsers = [
      {
        username: 'demo',
        email: 'demo@polytrade.com',
        role: 'trader'
      },
      {
        username: 'trader',
        email: 'trader@polytrade.com',
        role: 'trader'
      },
      {
        username: 'admin',
        email: 'admin@polytrade.com',
        role: 'admin'
      }
    ];

    console.log('👥 Creating demo users...');

    for (const user of demoUsers) {
      try {
        // Check if user already exists
        const existingUser = await client.query('SELECT username FROM users WHERE username = $1', [user.username]);

        if (existingUser.rows.length > 0) {
          console.log(`⚠️  User ${user.username} already exists, skipping...`);
          continue;
        }

        // Insert the user
        await client.query(`
          INSERT INTO users (username, email, password_hash, role, country_code, timezone, is_active, is_verified, kyc_status, trading_enabled)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          user.username,
          user.email,
          passwordHash,
          user.role,
          'US',
          'America/New_York',
          true,
          true,
          'approved',
          true
        ]);

        console.log(`✅ Created user: ${user.username} (${user.email}) - ${user.role}`);
      } catch (userError) {
        console.error(`❌ Error creating user ${user.username}:`, userError.message);
      }
    }

    // Verify all users were created
    console.log('\n🔍 Verifying all users...');
    const allUsers = await client.query('SELECT username, email, role FROM users ORDER BY username');

    console.log('👥 All users in database:');
    allUsers.rows.forEach(user => {
      console.log(`  - ${user.username} (${user.email}) - ${user.role}`);
    });

    client.release();
    console.log('\n🎉 Demo users setup completed!');
    console.log('📝 Demo login credentials:');
    console.log('  - Username: demo, Password: password');
    console.log('  - Username: trader, Password: password');
    console.log('  - Username: admin, Password: password');

  } catch (error) {
    console.error('❌ Demo users creation failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createDemoUsers();
