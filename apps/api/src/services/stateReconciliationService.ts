/**
 * StateReconciliationService
 *
 * Compares exchange state (source of truth) against DB records on startup
 * and every 60 seconds to detect and repair drift caused by container
 * restarts, crashes, or missed fills.
 */

import { pool } from '../db/connection.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import { apiCredentialsService } from './apiCredentialsService.js';
import { monitoringService } from './monitoringService.js';
import { getEngineVersion } from '../utils/engineVersion.js';
import { logger } from '../utils/logger.js';

export interface OrphanedPosition {
  symbol: string;
  side: string;
  size: number;
  entryPrice: number;
  exchangePositionId?: string;
}

export interface GhostRecord {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
}

export interface ReconciliationResult {
  userId: string;
  timestamp: string;
  orphans: OrphanedPosition[];
  ghosts: GhostRecord[];
  balanceDrift: number | null;
  exchangeBalance: number | null;
  dbBalance: number | null;
  error?: string;
}

class StateReconciliationService {
  /** Cache of the most recent result per userId */
  private latestResults: Map<string, ReconciliationResult> = new Map();

  /**
   * Run reconciliation for a single user.
   *
   * 1. Fetch real balance and open positions from Poloniex (source of truth).
   * 2. Fetch open trades from autonomous_trades.
   * 3. Detect orphaned exchange positions (on exchange but not in DB) → insert.
   * 4. Detect ghost DB records (in DB but not on exchange) → close.
   * 5. Detect balance drift > 1% → log STATE_DRIFT_WARNING.
   */
  async reconcile(userId: string): Promise<ReconciliationResult> {
    const timestamp = new Date().toISOString();
    const result: ReconciliationResult = {
      userId,
      timestamp,
      orphans: [],
      ghosts: [],
      balanceDrift: null,
      exchangeBalance: null,
      dbBalance: null
    };

    try {
      // ── 1. Credentials ──────────────────────────────────────────────────────
      const credentials = await apiCredentialsService.getCredentials(userId);
      if (!credentials) {
        logger.warn(`[RECONCILE] No API credentials for user ${userId} – skipping`);
        result.error = 'no_credentials';
        this.latestResults.set(userId, result);
        return result;
      }

      // ── 2. Fetch real balance ────────────────────────────────────────────────
      let exchangeBalance: number | null = null;
      try {
        const balanceData = await poloniexFuturesService.getAccountBalance(credentials);
        exchangeBalance =
          parseFloat(balanceData?.eq ?? balanceData?.totalEquity ?? '0') || 0;
        result.exchangeBalance = exchangeBalance;
      } catch (err) {
        logger.warn(`[RECONCILE] Could not fetch balance for user ${userId}:`, err);
      }

      // ── 3. Fetch real open positions ─────────────────────────────────────────
      let exchangePositions: any[] = [];
      try {
        const raw = await poloniexFuturesService.getPositions(credentials);
        exchangePositions = Array.isArray(raw) ? raw : [];
      } catch (err) {
        logger.warn(`[RECONCILE] Could not fetch positions for user ${userId}:`, err);
        result.error = 'exchange_unavailable';
        this.latestResults.set(userId, result);
        return result;
      }

      // ── 4. Fetch DB-recorded open trades ────────────────────────────────────
      const dbResult = await pool.query(
        `SELECT id, symbol, side, entry_price, quantity, order_id
         FROM autonomous_trades
         WHERE user_id = $1 AND status = 'open'`,
        [userId]
      );
      const dbTrades: {
        id: string;
        symbol: string;
        side: string;
        entry_price: string;
        quantity: string;
        order_id: string | null;
      }[] = dbResult.rows;

      // Use the last recorded equity from autonomous_performance as DB balance.
      // This is more meaningful than a heuristic notional sum.
      let dbBalance: number | null = null;
      try {
        const perfResult = await pool.query(
          `SELECT current_equity FROM autonomous_performance
           WHERE user_id = $1
           ORDER BY timestamp DESC
           LIMIT 1`,
          [userId]
        );
        if (perfResult.rows.length > 0 && perfResult.rows[0].current_equity != null) {
          dbBalance = parseFloat(perfResult.rows[0].current_equity);
        }
      } catch (_perfErr) {
        // autonomous_performance may not exist yet; skip
      }
      result.dbBalance = dbBalance;

      // ── 5. Orphan detection: on exchange but not in DB ───────────────────────
      for (const exPos of exchangePositions) {
        const symbol: string = exPos.symbol ?? exPos.instId ?? '';
        const size: number = Math.abs(parseFloat(exPos.qty ?? exPos.availQty ?? '0'));
        if (!symbol || size === 0) continue;

        const side: string =
          parseFloat(exPos.qty ?? '0') > 0 ? 'long' : 'short';

        // Check if this exchange symbol+side is already in the DB
        const matched = dbTrades.some(
          t => t.symbol === symbol && t.side === side
        );

        if (!matched) {
          const entryPrice = parseFloat(exPos.avgPrice ?? exPos.entryPrice ?? '0');
          const orphan: OrphanedPosition = {
            symbol,
            side,
            size,
            entryPrice,
            exchangePositionId: exPos.positionId ?? exPos.id ?? undefined
          };
          result.orphans.push(orphan);

          // Insert reconciled record into autonomous_trades
          try {
            await pool.query(
              `INSERT INTO autonomous_trades
               (user_id, symbol, side, entry_price, quantity, reason, status, engine_version)
               VALUES ($1, $2, $3, $4, $5, $6, 'open', $7)`,
              [
                userId,
                symbol,
                side,
                entryPrice,
                size,
                'reconciled',
                getEngineVersion(),
              ]
            );
            logger.info(
              `[RECONCILE] Inserted orphaned position for user ${userId}: ${symbol} ${side}`
            );
          } catch (insertErr) {
            logger.error(
              `[RECONCILE] Failed to insert orphaned position for user ${userId}:`,
              insertErr
            );
          }
        }
      }

      // ── 6. Ghost detection: in DB but not on exchange ────────────────────────
      for (const dbTrade of dbTrades) {
        const matched = exchangePositions.some(exPos => {
          const exSymbol: string = exPos.symbol ?? exPos.instId ?? '';
          const exQty = parseFloat(exPos.qty ?? exPos.availQty ?? '0');
          const exSide = exQty > 0 ? 'long' : 'short';
          return exSymbol === dbTrade.symbol && exSide === dbTrade.side;
        });

        if (!matched) {
          const ghost: GhostRecord = {
            id: dbTrade.id,
            symbol: dbTrade.symbol,
            side: dbTrade.side,
            entryPrice: parseFloat(dbTrade.entry_price)
          };
          result.ghosts.push(ghost);

          // Close the ghost record
          try {
            await pool.query(
              `UPDATE autonomous_trades
               SET status = 'closed',
                   close_reason = 'reconciled_not_on_exchange',
                   closed_at = NOW()
               WHERE id = $1`,
              [dbTrade.id]
            );
            logger.info(
              `[RECONCILE] Closed ghost DB record ${dbTrade.id} for user ${userId}: ${dbTrade.symbol} ${dbTrade.side}`
            );
          } catch (updateErr) {
            logger.error(
              `[RECONCILE] Failed to close ghost record ${dbTrade.id} for user ${userId}:`,
              updateErr
            );
          }
        }
      }

      // ── 7. Balance drift check ───────────────────────────────────────────────
      if (exchangeBalance !== null && dbBalance !== null && exchangeBalance > 0) {
        const drift = Math.abs(exchangeBalance - dbBalance) / exchangeBalance;
        result.balanceDrift = drift;

        if (drift > 0.01) {
          logger.warn(`[STATE_DRIFT_WARNING] Balance drift detected for user ${userId}`, {
            exchangeBalance,
            dbBalance,
            driftPercent: (drift * 100).toFixed(2)
          });
        }
      }

    } catch (err) {
      logger.error(`[RECONCILE] Unexpected error for user ${userId}:`, err);
      result.error = 'unexpected_error';
    }

    this.latestResults.set(userId, result);
    return result;
  }

  /**
   * Return the most recent reconciliation result for a user, or null if none.
   */
  getLatestResult(userId: string): ReconciliationResult | null {
    return this.latestResults.get(userId) ?? null;
  }

  /**
   * Run reconciliation for all users with an active autonomous trading config.
   */
  async reconcileAllActive(): Promise<void> {
    monitoringService.recordPipelineHeartbeat('reconciliation');
    try {
      const activeConfigs = await pool.query(
        `SELECT DISTINCT user_id FROM autonomous_trading_configs WHERE enabled = true`
      );

      for (const row of activeConfigs.rows) {
        const result = await this.reconcile(String(row.user_id));
        if (result.orphans.length > 0 || result.ghosts.length > 0) {
          logger.warn(
            `[RECONCILE] State drift detected for user ${row.user_id}`,
            {
              orphans: result.orphans.length,
              ghosts: result.ghosts.length,
              balanceDrift: result.balanceDrift
            }
          );
        }
      }
    } catch (err) {
      logger.error('[RECONCILE] Error running reconcileAllActive:', err);
    }
  }
}

export const stateReconciliationService = new StateReconciliationService();
export default stateReconciliationService;
