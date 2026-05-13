import express from 'express';
import { pool } from '../db/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../../database/migrations');

// All admin routes require authentication
router.use(authenticateToken);

// Require admin role for all admin routes
router.use(async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    const result = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [userId]
    );
    const role = result.rows[0]?.role;
    if (role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
  } catch (_err) {
    logger.error('Admin auth check failed:', _err instanceof Error ? _err.message : String(_err));
    return res.status(500).json({ success: false, error: 'Authorization check failed' });
  }
});

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
    logger.info('🚀 Starting database migrations...');
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
        logger.warn('⚠️ DEMO_USER_PASSWORD is not set — skipping demo user creation. Set the env var to create the demo account.');
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
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migrationSql);
        await client.query(
          'INSERT INTO schema_migrations (migration_name) VALUES ($1) ON CONFLICT (migration_name) DO NOTHING',
          [migrationFile]
        );
        await client.query('COMMIT');
      } catch (migrationError) {
        await client.query('ROLLBACK');
        throw migrationError;
      } finally {
        client.release();
      }
      results.migrationsApplied.push(migrationFile);
    }

    // Get list of all tables
    const tablesResult = await pool.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
    `);
    results.tables = tablesResult.rows.map(r => r.tablename);

    logger.info('🎉 Migrations completed successfully');
    
    res.json({
      success: true,
      message: 'Migrations completed successfully',
      results
    });

  } catch (error) {
    logger.error('❌ Migration failed:', error);
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
  } catch (_error) {
    logger.error('DB status check failed:', _error instanceof Error ? _error.message : String(_error));
    res.status(500).json({
      success: false,
      error: 'Failed to get database status'
    });
  }
});

/**
 * POST /api/admin/backfill-stacked-ghost-pnl
 *
 * One-off backfill for the reconciler PnL over-attribution bug
 * (live 2026-05-13 01:32Z–05:40Z, between PR #658 and PR #660).
 *
 * Detects groups of ghost-closed rows in the corruption window that
 * share the same (symbol, side, exit_time-truncated-to-second) and
 * the same pnl value. The bug applied the aggregate position PnL to
 * each stacked row instead of distributing pro-rata. This endpoint
 * rewrites each row's pnl as its qty share of the aggregate.
 *
 * Body:
 *   { apply?: boolean = false, startTs?: ISO string, endTs?: ISO string }
 *
 * Default is dry-run (apply=false). Returns the groups + proposed
 * changes so an operator can verify before re-running with apply=true.
 *
 * Idempotent against itself: re-running with the same window on
 * already-corrected data is a no-op (rows no longer share the same
 * pnl value, so the detection skips them).
 */
router.post('/backfill-stacked-ghost-pnl', async (req, res) => {
  try {
    const apply = req.body?.apply === true;
    const startTs = String(req.body?.startTs || '2026-05-13T01:32:00Z');
    const endTs = String(req.body?.endTs || '2026-05-13T05:50:00Z');
    if (!Number.isFinite(Date.parse(startTs)) || !Number.isFinite(Date.parse(endTs))) {
      return res.status(400).json({ success: false, error: 'invalid startTs/endTs' });
    }

    // Find candidate groups: ghost-closed rows in the window, grouped
    // by (symbol, side, second-truncated exit_time), where two or more
    // rows share an identical non-null pnl. That signature is the bug
    // — pre-PR-#660 reconciler attributed the aggregate to every row.
    const groups = await pool.query(
      `SELECT symbol,
              side,
              date_trunc('second', exit_time) AS ts_sec,
              COUNT(*) AS n_rows,
              COUNT(DISTINCT pnl) FILTER (WHERE pnl IS NOT NULL) AS n_distinct_pnl,
              MAX(pnl) FILTER (WHERE pnl IS NOT NULL) AS aggregate_pnl,
              array_agg(id ORDER BY entry_time) AS row_ids,
              array_agg(quantity ORDER BY entry_time) AS quantities,
              array_agg(pnl ORDER BY entry_time) AS pnls,
              array_agg(agent ORDER BY entry_time) AS agents,
              array_agg(exit_reason ORDER BY entry_time) AS exit_reasons
         FROM autonomous_trades
        WHERE status = 'closed'
          AND exit_time BETWEEN $1::timestamptz AND $2::timestamptz
          AND exit_reason IN ('manual_close_user', 'reconciled_post_close_race', 'reconciled_not_on_exchange')
        GROUP BY symbol, side, date_trunc('second', exit_time)
        HAVING COUNT(*) > 1
           AND COUNT(DISTINCT pnl) FILTER (WHERE pnl IS NOT NULL) = 1
        ORDER BY date_trunc('second', exit_time) ASC`,
      [startTs, endTs],
    );

    type GroupRow = {
      symbol: string;
      side: string;
      ts_sec: string;
      n_rows: string;
      n_distinct_pnl: string;
      aggregate_pnl: string;
      row_ids: string[];
      quantities: string[];
      pnls: (string | null)[];
      agents: (string | null)[];
      exit_reasons: (string | null)[];
    };

    const summary: Array<{
      symbol: string;
      side: string;
      ts: string;
      nRows: number;
      aggregatePnl: number;
      totalQty: number;
      updates: Array<{ id: string; agent: string | null; qty: number; oldPnl: number | null; newPnl: number; share: number }>;
    }> = [];

    let totalRowsUpdated = 0;
    let totalCorrectionUsdt = 0;

    for (const g of groups.rows as GroupRow[]) {
      const aggregatePnl = parseFloat(g.aggregate_pnl) || 0;
      const qtys = g.quantities.map((q) => Math.abs(parseFloat(q)) || 0);
      const totalQty = qtys.reduce((s, q) => s + q, 0);
      if (totalQty <= 0) continue;

      const updates = g.row_ids.map((id, i) => {
        const rowQty = qtys[i] ?? 0;
        const share = rowQty / totalQty;
        const oldPnl = g.pnls[i] !== null ? parseFloat(g.pnls[i] as string) : null;
        const newPnl = aggregatePnl * share;
        return {
          id,
          agent: g.agents[i] ?? null,
          qty: rowQty,
          oldPnl,
          newPnl,
          share,
        };
      });

      summary.push({
        symbol: g.symbol,
        side: g.side,
        ts: g.ts_sec,
        nRows: updates.length,
        aggregatePnl,
        totalQty,
        updates,
      });

      // Correction magnitude: each over-attributed row currently
      // contributes (oldPnl - newPnl) of fake P&L to the ledger.
      for (const u of updates) {
        if (u.oldPnl !== null) totalCorrectionUsdt += u.oldPnl - u.newPnl;
      }

      if (apply) {
        for (const u of updates) {
          try {
            await pool.query(
              `UPDATE autonomous_trades SET pnl = $1 WHERE id = $2`,
              [u.newPnl, u.id],
            );
            totalRowsUpdated++;
          } catch (updErr) {
            logger.error('[BACKFILL] row update failed', {
              id: u.id, err: updErr instanceof Error ? updErr.message : String(updErr),
            });
          }
        }
      }
    }

    logger.info(
      `[BACKFILL] stacked-ghost PnL ${apply ? 'APPLIED' : 'DRY-RUN'}: ` +
      `${summary.length} groups, ` +
      `${apply ? totalRowsUpdated : summary.reduce((s, g) => s + g.nRows, 0)} rows, ` +
      `net ledger correction ${totalCorrectionUsdt.toFixed(4)} USDT`,
    );

    res.json({
      success: true,
      apply,
      window: { startTs, endTs },
      groupsFound: summary.length,
      rowsAffected: summary.reduce((s, g) => s + g.nRows, 0),
      rowsUpdated: apply ? totalRowsUpdated : 0,
      netLedgerCorrectionUsdt: parseFloat(totalCorrectionUsdt.toFixed(4)),
      summary,
    });
  } catch (err) {
    logger.error('[BACKFILL] stacked-ghost PnL failed', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Backfill failed',
    });
  }
});

export default router;

// Endpoint to reset demo user password
router.post('/reset-demo-password', async (req, res) => {
  try {
    logger.info('🔐 Resetting demo user password...');
    
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
    
    logger.info('✅ Demo user password reset successfully');
    
    res.json({
      success: true,
      message: 'Demo user password reset successfully',
      user: { id: result.rows[0].id, username: result.rows[0].username }
    });
    
  } catch (error) {
    logger.error('❌ Password reset failed:', error);
    res.status(500).json({
      success: false,
      error: 'Password reset failed'
    });
  }
});

// Endpoint to reset GaryOcean user password
router.post('/reset-gary-password', async (req, res) => {
  try {
    logger.info('🔐 Resetting GaryOcean user password...');
    
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
    
    logger.info('✅ GaryOcean user password reset successfully');
    
    res.json({
      success: true,
      message: 'GaryOcean password reset successfully',
      user: { id: result.rows[0].id, username: result.rows[0].username }
    });
    
  } catch (error) {
    logger.error('❌ Password reset failed:', error);
    res.status(500).json({
      success: false,
      error: 'Password reset failed'
    });
  }
});
