import express from 'express';
import { pool } from '../db/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Admin endpoint to run migrations
router.post('/migrate', async (req, res) => {
  try {
    console.log('🚀 Starting database migrations...');
    
    // Check if users table exists
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
      agentTablesCreated: false,
      tables: []
    };

    if (!checkUsersTable.rows[0].exists) {
      console.log('📝 Creating users table...');
      
      // Read schema file
      const schemaPath = path.join(__dirname, '../db/schema-no-postgis.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      // Execute schema
      await pool.query(schema);
      results.usersTableCreated = true;
      console.log('✅ Users table created');
    }

    // Check if demo user exists
    const checkDemoUser = await pool.query(`
      SELECT * FROM users WHERE username = 'demo' LIMIT 1;
    `);

    if (checkDemoUser.rows.length === 0) {
      console.log('📝 Creating demo user...');
      
      // Create demo user (password: "password")
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash('password', 10);
      
      await pool.query(`
        INSERT INTO users (username, email, password_hash, role, is_active, is_verified, trading_enabled)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (username) DO NOTHING;
      `, ['demo', 'demo@example.com', passwordHash, 'trader', true, true, true]);
      
      results.demoUserCreated = true;
      console.log('✅ Demo user created');
    }

    // Check if agent tables exist
    const checkAgentTables = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'agent_sessions'
      );
    `);

    if (!checkAgentTables.rows[0].exists) {
      console.log('📝 Creating agent tables...');
      
      const agentMigrationPath = path.join(__dirname, '../../migrations/004_add_autonomous_agent_tables.sql');
      const agentSchema = fs.readFileSync(agentMigrationPath, 'utf8');
      
      await pool.query(agentSchema);
      results.agentTablesCreated = true;
      console.log('✅ Agent tables created');
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
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
      error: error.message
    });
  }
});

export default router;

// Endpoint to reset demo user password
router.post('/reset-demo-password', async (req, res) => {
  try {
    console.log('🔐 Resetting demo user password...');
    
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('password', 12);
    
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
      message: 'Demo user password reset to "password"',
      user: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Password reset failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint to reset GaryOcean user password
router.post('/reset-gary-password', async (req, res) => {
  try {
    console.log('🔐 Resetting GaryOcean user password...');
    
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('I.Am.Dev.1', 12);
    
    // Update GaryOcean user password
    const result = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE username = 'GaryOcean' OR email = 'braden.lang77@gmail.com'
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
      message: 'GaryOcean user password reset to "I.Am.Dev.1"',
      user: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Password reset failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
