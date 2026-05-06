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

      // Normalize buy/sell (DB convention for liveSignal rows) to
      // long/short (exchange convention). Used in both orphan and
      // ghost paths. The ghost path got this in PR #501; the orphan
      // path missed it — caught 2026-04-19 when a duplicate orphan
      // row appeared ~1min after the first live trade opened
      // (DB row side='buy', exchange side='long' → no match → orphan
      // inserted with quantity=1 contract, entry_price=0).
      const normalizeDbSide = (s: string): 'long' | 'short' =>
        s === 'buy' || s === 'long' ? 'long' : 'short';

      // ── 5. Orphan detection: on exchange but not in DB ───────────────────────
      for (const exPos of exchangePositions) {
        const symbol: string = exPos.symbol ?? exPos.instId ?? '';
        const size: number = Math.abs(parseFloat(exPos.qty ?? exPos.availQty ?? '0'));
        if (!symbol || size === 0) continue;

        const side: string =
          parseFloat(exPos.qty ?? '0') > 0 ? 'long' : 'short';

        // Check if this exchange symbol+side is already in the DB.
        // DB side may be 'buy'/'sell' (liveSignal) or 'long'/'short'
        // (fullyAutonomousTrader) — normalize both sides to long/short
        // before comparing.
        const matched = dbTrades.some(
          t => t.symbol === symbol && normalizeDbSide(t.side) === side,
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

          // Insert reconciled record into autonomous_trades, tagged as
          // user-originated (agent='USER', lane='manual'). This lets the
          // kernel's own queries — which filter by reason LIKE 'monkey|%' —
          // continue to ignore manual positions, while dashboards and PnL
          // accounting can identify them as user-placed. The reason field
          // also embeds the source so historic queries can distinguish
          // user opens from system retries.
          try {
            const userReason = `manual_open_user|exchange_pid=${
              exPos.positionId ?? exPos.id ?? 'na'
            }|src=reconciler`;
            await pool.query(
              `INSERT INTO autonomous_trades
               (user_id, symbol, side, entry_price, quantity, reason, status,
                engine_version, agent, lane)
               VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, 'USER', 'manual')`,
              [
                userId,
                symbol,
                side,
                entryPrice,
                size,
                userReason,
                getEngineVersion(),
              ]
            );
            logger.info(
              `[RECONCILE] Tracked user-opened position for user ${userId}: ${symbol} ${side} qty=${size} @${entryPrice}`
            );
            // Emit an agent_events row so the audit trail captures the
            // user action explicitly. metadata column was added in
            // migration 044 (2026-05-02 incident).
            await pool.query(
              `INSERT INTO agent_events
                 (user_id, event_type, execution_mode, description, market, metadata, created_at)
               VALUES ($1, 'manual_position_detected', 'auto', $2, $3, $4, NOW())`,
              [
                userId,
                `User-opened ${symbol} ${side} qty=${size} @${entryPrice} detected and tracked by reconciler`,
                symbol,
                JSON.stringify({
                  source: 'reconciler',
                  side, size, entryPrice,
                  exchange_position_id: exPos.positionId ?? exPos.id ?? null,
                }),
              ]
            ).catch(() => { /* fail-soft; main insert above is the source of truth */ });
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
        const dbSide = normalizeDbSide(dbTrade.side);
        const matched = exchangePositions.some(exPos => {
          const exSymbol: string = exPos.symbol ?? exPos.instId ?? '';
          const exQty = parseFloat(exPos.qty ?? exPos.availQty ?? '0');
          const exSide = exQty > 0 ? 'long' : 'short';
          return exSymbol === dbTrade.symbol && exSide === dbSide;
        });

        if (!matched) {
          const ghost: GhostRecord = {
            id: dbTrade.id,
            symbol: dbTrade.symbol,
            side: dbTrade.side,
            entryPrice: parseFloat(dbTrade.entry_price)
          };
          result.ghosts.push(ghost);

          // Close the ghost record. Classification heuristic:
          //   - If exit_order_id is set, our system tried to close (close
          //     went through after the row was queried but before this
          //     reconcile, OR a partial close came through). Tag as
          //     'reconciled_post_close_race' for audit clarity.
          //   - If exit_order_id is NULL and the DB row was kernel-issued
          //     (reason LIKE 'monkey|%' or 'live_signal|%'): the user
          //     likely closed the position manually on Poloniex UI. Tag
          //     as 'manual_close_user' so audit trails distinguish user
          //     interventions from infra issues.
          //   - Otherwise (orphan/legacy/unknown): keep the original
          //     'reconciled_not_on_exchange' tag for back-compat.
          let ghostReason = 'reconciled_not_on_exchange';
          try {
            const ctxRow = await pool.query(
              `SELECT exit_order_id, reason, agent FROM autonomous_trades WHERE id = $1`,
              [dbTrade.id]
            );
            const ctx = ctxRow.rows[0] as
              | { exit_order_id: string | null; reason: string | null; agent: string | null }
              | undefined;
            if (ctx?.exit_order_id) {
              ghostReason = 'reconciled_post_close_race';
            } else if (
              // Any of these signal a kernel/user-tracked row whose
              // disappearance from the exchange means the user closed
              // it manually (or some out-of-band actor did):
              //   - kernel/livesignal/autotrader-issued rows (reason
              //     prefixes monkey|, live_signal|, autoTrader|)
              //   - reconciler-inserted user-tracking rows (reason
              //     'reconciled' from pre-PR #641 code, or
              //     'manual_open_user|...' from post-#641 code, or
              //     agent='USER' for any reason format)
              (
                ctx?.agent === 'USER' ||
                (ctx?.reason && (
                  ctx.reason.startsWith('monkey|') ||
                  ctx.reason.startsWith('live_signal|') ||
                  ctx.reason.startsWith('autoTrader|') ||
                  ctx.reason.startsWith('manual_open_user') ||
                  ctx.reason === 'reconciled'
                ))
              )
            ) {
              ghostReason = 'manual_close_user';
            }
          } catch {
            /* fail-soft: keep generic reason */
          }
          try {
            await pool.query(
              `UPDATE autonomous_trades
               SET status = 'closed',
                   exit_reason = $1,
                   exit_time = NOW()
               WHERE id = $2`,
              [ghostReason, dbTrade.id]
            );
            logger.info(
              `[RECONCILE] Closed ghost DB record ${dbTrade.id} for user ${userId}: ${dbTrade.symbol} ${dbTrade.side} (reason=${ghostReason})`
            );
          } catch (updateErr) {
            logger.error(
              `[RECONCILE] Failed to close ghost record ${dbTrade.id} for user ${userId}:`,
              updateErr
            );
          }
        }
      }

      // ── 7. Balance drift check + auto-sync ───────────────────────────────────
      //
      // The exchange is the source of truth for equity. Drift between
      // DB-recorded equity (latest autonomous_performance row) and
      // exchange-reported equity has two sources:
      //   (a) manual cash flows — user deposits/withdrawals on Poloniex UI
      //   (b) trade closes the DB writer missed (FAT disabled, FAT crash,
      //       or close-time race)
      //
      // Both should be papered over by an authoritative sync from the
      // exchange. The drift WARN log is preserved as the audit trail —
      // operator sees the magnitude/direction and can correlate it to
      // their own deposit/withdrawal activity. The auto-INSERT below
      // ensures downstream consumers (Arbiter sizing, dashboards,
      // notional ceilings) see correct equity within one reconciler tick.
      //
      // 2026-05-05 incident: FAT was disabled but was the sole writer of
      // autonomous_performance. DB equity stayed frozen at $113.27 for
      // hours while exchange balance grew to $369.10 from manual
      // deposits — Arbiter was sizing against the stale $113.
      if (exchangeBalance !== null && dbBalance !== null && exchangeBalance > 0) {
        const drift = Math.abs(exchangeBalance - dbBalance) / exchangeBalance;
        result.balanceDrift = drift;

        if (drift > 0.01) {
          logger.warn(`[STATE_DRIFT_WARNING] Balance drift detected for user ${userId}`, {
            exchangeBalance,
            dbBalance,
            driftPercent: (drift * 100).toFixed(2)
          });

          // Auto-sync: write a fresh autonomous_performance row with the
          // exchange balance. Recompute total_return/drawdown when we have
          // initial_capital from the config; else NULL them out (operator
          // sees drift in logs and historical rows preserve old values).
          try {
            const cfgRow = await pool.query(
              `SELECT initial_capital FROM autonomous_trading_configs WHERE user_id = $1 LIMIT 1`,
              [userId]
            );
            const initialCapital =
              cfgRow.rows[0]?.initial_capital != null
                ? parseFloat(cfgRow.rows[0].initial_capital)
                : null;
            const totalReturn =
              initialCapital && initialCapital > 0
                ? ((exchangeBalance - initialCapital) / initialCapital) * 100
                : null;
            const drawdown =
              initialCapital && initialCapital > 0
                ? Math.max(0, (initialCapital - exchangeBalance) / initialCapital) * 100
                : null;
            await pool.query(
              `INSERT INTO autonomous_performance
                 (user_id, current_equity, total_return, drawdown, timestamp)
               VALUES ($1, $2, $3, $4, NOW())`,
              [userId, exchangeBalance, totalReturn, drawdown]
            );
            logger.info(
              `[RECONCILE] Synced DB equity to exchange for user ${userId}: ${dbBalance.toFixed(2)} -> ${exchangeBalance.toFixed(2)}`
            );
          } catch (syncErr) {
            logger.error(
              `[RECONCILE] Failed to sync DB equity for user ${userId}:`,
              syncErr
            );
          }
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
   * Run reconciliation for every user who is currently "live" in some sense:
   *
   *   1. Users with an active autonomous_trading_configs row (legacy path).
   *   2. Users with any open live_signal trade in autonomous_trades (the
   *      liveSignalEngine path, which doesn't require autonomous_trading_configs).
   *
   * Without (2) we get the exact bug from 2026-04-18: 6 DB rows stuck in
   * status='open' for 12h with no exchange position, and the 60s reconciler
   * never touched them because autonomous_trading_configs was empty.
   *
   * Dedupe across both sets so a user with both an active config AND open
   * live-signal trades only reconciles once per tick.
   */
  async reconcileAllActive(): Promise<void> {
    monitoringService.recordPipelineHeartbeat('reconciliation');
    try {
      const userIds = new Set<string>();

      // Source 1: active autonomous_trading_configs
      try {
        const activeConfigs = await pool.query(
          `SELECT DISTINCT user_id FROM autonomous_trading_configs WHERE enabled = true`,
        );
        for (const row of activeConfigs.rows as Array<{ user_id: string }>) {
          userIds.add(String(row.user_id));
        }
      } catch (err) {
        logger.warn('[RECONCILE] autonomous_trading_configs lookup failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }

      // Source 2: users with an open auto-trader row. This is the
      // liveSignalEngine's + Monkey's footprint — if phantom rows
      // accumulate on either, the stacking guard freezes all future
      // entries until reconciler catches them. Covering this surface is
      // the whole point of P2. Post-v0.3 Monkey is also a producer of
      // open rows (reason LIKE 'monkey|%'); omitting her hides any
      // phantoms she leaves behind (observed 2026-04-20 — state-of-bot
      // read 1 DB open vs 2 exchange open because this query excluded
      // Monkey's ETH row).
      try {
        const traderUsers = await pool.query(
          `SELECT DISTINCT user_id FROM autonomous_trades
            WHERE status = 'open'
              AND (reason LIKE 'live_signal|%' OR reason LIKE 'monkey|%')`,
        );
        for (const row of traderUsers.rows as Array<{ user_id: string }>) {
          userIds.add(String(row.user_id));
        }
      } catch (err) {
        logger.warn('[RECONCILE] auto-trader users lookup failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }

      for (const userId of userIds) {
        const result = await this.reconcile(userId);
        if (result.orphans.length > 0 || result.ghosts.length > 0) {
          logger.warn(
            `[RECONCILE] State drift detected for user ${userId}`,
            {
              orphans: result.orphans.length,
              ghosts: result.ghosts.length,
              balanceDrift: result.balanceDrift,
            },
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
