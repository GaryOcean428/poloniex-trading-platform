/**
 * Smoke Test: Full Paper Trade Cycle
 *
 * Run: npx tsx apps/api/src/scripts/test_paper_trade_cycle.ts
 *   or: yarn workspace @poloniex-platform/api test:paper-cycle
 *
 * Exercises the complete signal → order record → close lifecycle using the
 * fullyAutonomousTrader in paper-trading mode.  A temporary test-user record is
 * created and fully cleaned up on success **and** on failure.
 *
 * Steps:
 *  1. Create autonomous trading config with paperTrading: true
 *  2. Run one trading cycle via (fullyAutonomousTrader as any).tradingCycle()
 *  3. Query autonomous_trades for the paper trade record
 *  4. Verify: trade exists, entry_price > 0, valid symbol, valid side
 *  5. Close the trade via direct DB update (mirrors what closePosition() does)
 *  6. Verify: status = 'closed', has exit data
 *  7. Clean up all test records
 */

import 'dotenv/config';
import { pool } from '../db/connection.js';
import { fullyAutonomousTrader } from '../services/fullyAutonomousTrader.js';
import { apiCredentialsService } from '../services/apiCredentialsService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Print a section header. */
function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

/** Assert a condition; throws an AssertionError on failure (caller must clean up). */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓  ${message}`);
}

/** Clean up all test records for a test user, swallowing errors. */
async function cleanup(testUserId: string): Promise<void> {
  try {
    await pool.query(`DELETE FROM autonomous_trades WHERE user_id = $1`, [testUserId]);
    await pool.query(`DELETE FROM autonomous_trading_configs WHERE user_id = $1`, [testUserId]);
    await pool.query(`DELETE FROM api_credentials WHERE user_id = $1`, [testUserId]);
    // Users table may not exist in all environments – best-effort only
    await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]).catch(() => undefined);
    console.log('\n  ✓  Test records cleaned up');
  } catch (err) {
    console.warn('  ⚠  Cleanup warning (non-fatal):', err);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Paper Trade Cycle — Full Lifecycle Smoke Test');
  console.log(new Date().toISOString());

  const TEST_USER_ID = `smoke-test-user-${Date.now()}`;
  const TEST_SYMBOL = 'TRX_USDT_PERP';
  const API_KEY = process.env.POLONIEX_API_KEY ?? '';
  const API_SECRET = process.env.POLONIEX_API_SECRET ?? '';

  if (!API_KEY || !API_SECRET) {
    console.error(
      '❌  POLONIEX_API_KEY and/or POLONIEX_API_SECRET are not set.\n' +
        '    The paper trade cycle requires real market data even in paper mode.\n' +
        '    Copy .env.example to .env and fill in your credentials.'
    );
    process.exit(1);
  }

  // ── Step 1: Seed credentials and config ─────────────────────────────────
  section('Step 1 — Create test user credentials and trading config');

  try {
    // Ensure the user row exists when the schema has a users table with FK constraints.
    // This is best-effort: environments without a users table simply skip it.
    await pool.query(
      `INSERT INTO users (id, email, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `${TEST_USER_ID}@smoke.test`, 'not-a-real-hash']
    ).catch(() => undefined); // non-fatal if table doesn't exist or schema differs

    await apiCredentialsService.storeCredentials(TEST_USER_ID, API_KEY, API_SECRET);
    console.log(`  ✓  Credentials stored for test user ${TEST_USER_ID}`);

    // Inject the trading config directly into the trader's in-memory map,
    // bypassing enableAutonomousTrading (which would start an interval loop).
    const tradingConfig = {
      userId: TEST_USER_ID,
      initialCapital: 10000,
      maxRiskPerTrade: 2,
      maxDrawdown: 10,
      targetDailyReturn: 1,
      symbols: [TEST_SYMBOL],
      enabled: true,
      paperTrading: true,
      stopLossPercent: 2,
      takeProfitPercent: 4,
      leverage: 3,
      maxConcurrentPositions: 5,
      tradingCycleSeconds: 60,
      confidenceThreshold: 0,    // Zero so the cycle always executes a trade (smoke test only — not production)
      signalScoreThreshold: 0,   // Zero so any non-zero score triggers a signal (smoke test only — not production)
    };

    // Access the private `configs` map via type cast (valid in plain JS/TS at runtime)
    (fullyAutonomousTrader as unknown as { configs: Map<string, unknown> }).configs.set(
      TEST_USER_ID,
      tradingConfig
    );
    console.log('  ✓  Trading config injected (paperTrading=true, thresholds=0 to force a trade)');
  } catch (err) {
    console.error('  ❌  Setup failed:', err);
    await cleanup(TEST_USER_ID);
    process.exit(1);
  }

  // ── Step 2: Run one trading cycle ───────────────────────────────────────
  section('Step 2 — Run one trading cycle');

  try {
    console.log(`  Running tradingCycle for user ${TEST_USER_ID}…`);
    await (fullyAutonomousTrader as unknown as { tradingCycle(userId: string): Promise<void> })
      .tradingCycle(TEST_USER_ID);
    console.log('  ✓  Trading cycle completed');
  } catch (err) {
    console.error('  ❌  tradingCycle threw:', err);
    await cleanup(TEST_USER_ID);
    process.exit(1);
  }

  // ── Step 3 & 4: Verify trade was recorded ───────────────────────────────
  section('Step 3 & 4 — Verify paper trade record in autonomous_trades');

  let tradeId: string | undefined;
  let tradeSymbol: string | undefined;
  let tradeSide: string | undefined;
  let tradeEntryPrice: number | undefined;

  try {
    const result = await pool.query(
      `SELECT * FROM autonomous_trades
       WHERE user_id = $1 AND order_id LIKE 'paper_%'
       ORDER BY created_at DESC LIMIT 1`,
      [TEST_USER_ID]
    );

    if (result.rows.length === 0) {
      console.error(
        '\n  ❌  No paper trade was created.\n' +
          '      This usually means the market signal score was below the threshold\n' +
          '      or the API returned insufficient data for analysis.\n' +
          '      Check the logs above for details.'
      );
      await cleanup(TEST_USER_ID);
      process.exit(1);
    }

    const trade = result.rows[0] as Record<string, unknown>;
    tradeId = trade.id as string;
    tradeSymbol = trade.symbol as string;
    tradeSide = trade.side as string;
    tradeEntryPrice = parseFloat(trade.entry_price as string);

    console.log('\n  Trade record:');
    console.log(JSON.stringify(trade, null, 4));

    assert(!!tradeId, 'trade.id is present');
    assert(!!tradeSymbol, 'trade.symbol is present');
    assert(['long', 'short'].includes(tradeSide ?? ''), `trade.side is 'long' or 'short' (got '${tradeSide}')`);
    assert(
      typeof tradeEntryPrice === 'number' && tradeEntryPrice > 0,
      `trade.entry_price > 0 (got ${tradeEntryPrice})`
    );
    assert(trade.status === 'open', `trade.status is 'open' (got '${trade.status}')`);
  } catch (err) {
    console.error('  ❌  DB query or assertion failed:', err);
    await cleanup(TEST_USER_ID);
    process.exit(1);
  }

  // ── Step 5: Close the trade ─────────────────────────────────────────────
  section('Step 5 — Close the paper trade');

  const mockExitPrice = (tradeEntryPrice ?? 1) * 1.01; // Simulate 1% gain

  try {
    await pool.query(
      `UPDATE autonomous_trades
       SET status = 'closed',
           close_reason = 'smoke_test',
           closed_at = NOW(),
           exit_price = $2,
           pnl = ($2 - entry_price) * quantity
       WHERE id = $1`,
      [tradeId, mockExitPrice]
    );
    console.log(`  ✓  Trade ${tradeId} closed at exit_price=${mockExitPrice.toFixed(6)}`);
  } catch (_updateErr) {
    // Columns exit_price / pnl may not exist in all migration states — fall back
    try {
      await pool.query(
        `UPDATE autonomous_trades
         SET status = 'closed', close_reason = 'smoke_test', closed_at = NOW()
         WHERE id = $1`,
        [tradeId]
      );
      console.log('  ✓  Trade closed (basic update — exit_price/pnl columns not present)');
    } catch (fallbackErr) {
      console.error('  ❌  Could not close trade:', fallbackErr);
      await cleanup(TEST_USER_ID);
      process.exit(1);
    }
  }

  // ── Step 6: Verify closed state ─────────────────────────────────────────
  section('Step 6 — Verify closed trade record');

  try {
    const result = await pool.query(
      `SELECT * FROM autonomous_trades WHERE id = $1`,
      [tradeId]
    );

    assert(result.rows.length > 0, 'trade record still exists after close');

    const closed = result.rows[0] as Record<string, unknown>;
    console.log('\n  Closed trade record:');
    console.log(JSON.stringify(closed, null, 4));

    assert(closed.status === 'closed', `trade.status is 'closed' (got '${closed.status}')`);
    assert(!!closed.closed_at, 'trade.closed_at is set');
  } catch (err) {
    console.error('  ❌  Verification failed:', err);
    await cleanup(TEST_USER_ID);
    process.exit(1);
  }

  // ── Step 7: Clean up ────────────────────────────────────────────────────
  section('Step 7 — Clean up test records');
  await cleanup(TEST_USER_ID);

  // ── Done ────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  ✅  All steps passed — paper trade cycle verified');
  console.log(`      Symbol: ${tradeSymbol}  Side: ${tradeSide}  Entry: ${tradeEntryPrice}`);
  console.log('═'.repeat(60));

  await pool.end();
  process.exit(0);
}

main().catch(async err => {
  console.error('\n❌  Unhandled error:', err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
