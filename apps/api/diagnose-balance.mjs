import pkg from 'pg';
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:poloniex_db_pass_2024@autorack.proxy.rlwy.net:28165/railway';

async function diagnose() {
  console.log('🔍 Diagnosing Balance Display Issue...\n');
  
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 5
  });

  try {
    // Test 1: Database Connection
    console.log('1️⃣ Testing database connection...');
    const dbTest = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', dbTest.rows[0].now);

    // Test 2: Check if api_credentials table exists
    console.log('\n2️⃣ Checking api_credentials table...');
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'api_credentials'
      );
    `);
    console.log('✅ Table exists:', tableCheck.rows[0].exists);

    // Test 3: Check table structure
    console.log('\n3️⃣ Checking table structure...');
    const columns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'api_credentials'
      ORDER BY ordinal_position;
    `);
    console.log('Columns:', columns.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));

    // Test 4: Check for credentials
    console.log('\n4️⃣ Checking for stored credentials...');
    const credCount = await pool.query(`
      SELECT COUNT(*) as count, 
             COUNT(CASE WHEN is_active THEN 1 END) as active_count,
             COUNT(CASE WHEN encryption_tag IS NOT NULL THEN 1 END) as with_tag
      FROM api_credentials;
    `);
    console.log('Total credentials:', credCount.rows[0].count);
    console.log('Active credentials:', credCount.rows[0].active_count);
    console.log('With encryption_tag:', credCount.rows[0].with_tag);

    // Test 5: Check specific user
    console.log('\n5️⃣ Checking user credentials...');
    const userCreds = await pool.query(`
      SELECT id, user_id, exchange, is_active, 
             encryption_tag IS NOT NULL as has_tag,
             created_at
      FROM api_credentials
      WHERE user_id = '7e989bb1-9bbf-442d-a778-2086cd27d6ab'
      ORDER BY created_at DESC;
    `);
    
    if (userCreds.rows.length > 0) {
      console.log('✅ Found credentials for user:');
      userCreds.rows.forEach(row => {
        console.log(`  - ID: ${row.id}`);
        console.log(`    Exchange: ${row.exchange}`);
        console.log(`    Active: ${row.is_active}`);
        console.log(`    Has Tag: ${row.has_tag}`);
        console.log(`    Created: ${row.created_at}`);
      });
    } else {
      console.log('❌ No credentials found for user');
    }

    // Test 6: Check users table
    console.log('\n6️⃣ Checking users table...');
    const userCheck = await pool.query(`
      SELECT id, email, created_at 
      FROM users 
      WHERE id = '7e989bb1-9bbf-442d-a778-2086cd27d6ab';
    `);
    
    if (userCheck.rows.length > 0) {
      console.log('✅ User exists:', userCheck.rows[0].email);
    } else {
      console.log('❌ User not found');
    }

    console.log('\n✅ Diagnosis complete!');
    
  } catch (error) {
    console.error('\n❌ Error during diagnosis:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

diagnose();
