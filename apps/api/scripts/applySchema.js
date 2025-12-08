import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applySchema() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔄 Connecting to database...');
    console.log('Database URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');

    // Test connection
    const client = await pool.connect();
    console.log('✅ Database connection established');

    // Read the schema file (use non-PostGIS version for Railway)
    const schemaPath = path.join(__dirname, '../src/db/schema-no-postgis.sql');
    console.log('📄 Reading schema from:', schemaPath);

    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at: ${schemaPath}`);
    }

    const schema = fs.readFileSync(schemaPath, 'utf8');
    console.log('📋 Schema file loaded successfully');

    // Apply the schema
    console.log('🔄 Applying database schema...');
    await client.query(schema);
    console.log('✅ Database schema applied successfully');

    // Verify tables were created
    console.log('🔍 Verifying table creation...');
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('📊 Created tables:');
    result.rows.forEach(row => console.log(`  - ${row.table_name}`));

    // Verify demo users were created
    console.log('👥 Verifying demo users...');
    const usersResult = await client.query('SELECT username, email, role FROM users ORDER BY username');

    console.log('🎭 Demo users created:');
    usersResult.rows.forEach(user => {
      console.log(`  - ${user.username} (${user.email}) - ${user.role}`);
    });

    client.release();
    console.log('🎉 Database setup completed successfully!');

  } catch (error) {
    console.error('❌ Database setup failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  process.exit(0);
});

applySchema();
