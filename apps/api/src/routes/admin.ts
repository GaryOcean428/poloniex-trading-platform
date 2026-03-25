import express from 'express';
import { pool } from '../db/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../../database/migrations');

// All admin routes require authentication
router.use(authenticateToken);

function getMigrationFiles(): string[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  return fs
    .readdirSync(migrationsDir)
    .filter(file => /^\d+_.*\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// Admin endpoint to run migrations
router.post('/migrate', async (req, res) => {
  try {
    console.log('🚀 Starting database migrations...');
    const migrationFiles = getMigrationFiles();
    const checkUsersTable = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);

    const results = {
      usersTableExists: checkUsersTable.rows[0].exists,
      usersTableCreated: false,
      demoUserCreated: false,
      migrationFiles,
      migrationsApplied: [] as string[],
      migrationsSkipped: [] as string[],
      tables: [] as string[]
    };

    if (!checkUsersTable.rows[0].exists) {
      const schemaPath = path.join(__dirname, '../db/schema-no-postgis.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schema);
      results.usersTableCreated = true;
    }

    const checkDemoUser = await pool.query(`
      SELECT * FROM users WHERE username = 'demo' LIMIT 1;
    `);

    if (checkDemoUser.rows.length === 0) {
      const demoPassword = process.env.DEMO_USER_PASSWORD;
      if (!demoPassword) {
        console.warn('⚠️ DEMO_USER_PASSWORD is not set — skipping demo user creation. Set the env var to create the demo account.');
      } else {
        const bcrypt = await import('bcryptjs');
        const passwordHash = await bcrypt.hash(demoPassword, 12);
        await pool.query(
          `
            INSERT INTO users (username, email, password_hash, role, is_active, is_verified, trading_enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (username) DO NOTHING;
          `,
          ['demo', 'demo@example.com', passwordHash, 'trader', true, true, true]
        );
        results.demoUserCreated = true;
      }
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const appliedMigrationsResult = await pool.query<{ migration_name: string }>(
      'SELECT migration_name FROM schema_migrations'
    );
    const appliedMigrations = new Set(
      appliedMigrationsResult.rows.map(row => row.migration_name)
    );

    for (const migrationFile of migrationFiles) {
      if (appliedMigrations.has(migrationFile)) {
        results.migrationsSkipped.push(migrationFile);
        continue;
      }

      const migrationPath = path.join(migrationsDir, migrationFile);
      const migrationSql = fs.readFileSync(migrationPath, 'utf8');
      await pool.query(migrationSql);
      await pool.query(
        'INSERT INTO schema_migrations (migration_name) VALUES ($1) ON CONFLICT (migration_name) DO NOTHING',
        [migrationFile]
      );
      results.migrationsApplied.push(migrationFile);
    }

    // Get list of all tables
    const tablesResult = await pool.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
    `);
    results.tables = tablesResult.rows.map(r => r.tablename);

    console.log('🎉 Migrations completed successfully');
    
    res.json({
      success: true,
      message: 'Migrations completed successfully',
      results
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed'
    });
  }
});

// Endpoint to check database status
router.get('/db-status', async (req, res) => {
  try {
    const tables = await pool.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
    `);

    const userCount = await pool.query(`
      SELECT COUNT(*) as count FROM users;
    `).catch(() => ({ rows: [{ count: 'N/A - table does not exist' }] }));

    const agentSessionCount = await pool.query(`
      SELECT COUNT(*) as count FROM agent_sessions;
    `).catch(() => ({ rows: [{ count: 'N/A - table does not exist' }] }));

    res.json({
      success: true,
      tables: tables.rows.map(r => r.tablename),
      userCount: userCount.rows[0].count,
      agentSessionCount: agentSessionCount.rows[0].count
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get database status'
    });
  }
});

export default router;

// Endpoint to reset demo user password
router.post('/reset-demo-password', async (req, res) => {
  try {
    console.log('🔐 Resetting demo user password...');
    
    const { password } = req.body;
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }
    
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Update demo user password
    const result = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE username = 'demo' OR email = 'demo@polytrade.com'
      RETURNING id, username, email;
    `, [passwordHash]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Demo user not found'
      });
    }
    
    console.log('✅ Demo user password reset successfully');
    
    res.json({
      success: true,
      message: 'Demo user password reset successfully',
      user: { id: result.rows[0].id, username: result.rows[0].username }
    });
    
  } catch (error) {
    console.error('❌ Password reset failed:', error);
    res.status(500).json({
      success: false,
      error: 'Password reset failed'
    });
  }
});

// Endpoint to reset GaryOcean user password
router.post('/reset-gary-password', async (req, res) => {
  try {
    console.log('🔐 Resetting GaryOcean user password...');
    
    const { password } = req.body;
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }
    
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Update GaryOcean user password
    const result = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE username = 'GaryOcean'
      RETURNING id, username, email;
    `, [passwordHash]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'GaryOcean user not found'
      });
    }
    
    console.log('✅ GaryOcean user password reset successfully');
    
    res.json({
      success: true,
      message: 'GaryOcean password reset successfully',
      user: { id: result.rows[0].id, username: result.rows[0].username }
    });
    
  } catch (error) {
    console.error('❌ Password reset failed:', error);
    res.status(500).json({
      success: false,
      error: 'Password reset failed'
    });
  }
});
