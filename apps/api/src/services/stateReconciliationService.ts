/**
 * StateReconciliationService
 *
 * Compares exchange state (source of truth) against DB records on startup
 * and every 60 seconds to detect and repair drift caused by container
 * restarts, crashes, or missed fills.
 */

import { pool } from '../db/connection.js';
import { verifyPnl, checkNotionalConsistency } from './monkey/safePnlSql.js';
import poloniexFuturesService from './poloniexFuturesService.js';
import { apiCredentialsService } from './apiCredentialsService.js';
import { getCurrentExecutionMode } from './executionModeService.js';
import { monitoringService } from './monitoringService.js';
import { getEngineVersion } from '../utils/engineVersion.js';
import { logger } from '../utils/logger.js';
import { BusEventType, getKernelBus } from './monkey/kernel_bus.js';
import { extractKernelInstanceIdFromReason } from './monkey/recovered_outcome_routing.js';
import {
  composePoloBillsReward,
  decideExternalCloseReward,
  type PoloBillRow,
} from './monkey/polo_reward_ledger.js';
import { inferLaneFromLeverage, kernelAdoptLive } from './laneFromLeverage.js';
import { getPrecisions } from './marketCatalog.js';

// Re-export so callers continue to import these from
// stateReconciliationService for backward compat. Definitions live in
// the dep-free laneFromLeverage module so they're unit-testable.
export { inferLaneFromLeverage };

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
      // ── 0. Operator paper MANDATE ───────────────────────────────────────────
      // When execution mode is not 'auto', the kernel is fully disengaged from
      // the live exchange — the operator has taken over live positions. The
      // reconciler MUST NOT adopt orphaned exchange positions (the operator's
      // manual trades) or close ghost rows against the live account. Skip
      // entirely; resume only in 'auto'.
      const execMode = await getCurrentExecutionMode();
      if (execMode !== 'auto') {
        result.error = 'skipped_execution_mode_not_auto';
        this.latestResults.set(userId, result);
        return result;
      }

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
        // `leverage` (nullable INTEGER, migration 048) is needed to compute the
        // real position margin for the external-close reward (#1033 refine):
        // margin = entry_price × quantity / leverage. Without it the chemistry
        // scale would fall back to a synthetic constant (the retired
        // marginUsdt=5 knob). quantity is base-asset (migration 060) so
        // entry_price × quantity is the USDT notional directly.
        `SELECT id, symbol, side, entry_price, quantity, leverage, order_id, entry_time
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
        leverage: number | string | null;
        order_id: string | null;
        entry_time: Date | string;
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

      // Resolve an EXCHANGE position's side. 2026-05-14 fix: HEDGE-mode
      // Poloniex v3 positions carry a POSITIVE ``qty`` magnitude and the
      // real side in ``posSide`` — so the legacy ``parseFloat(qty) > 0``
      // test mislabels every HEDGE short as 'long'. After the side-aware
      // FAT reconciler (PR #677) started closing side-mismatched rows,
      // this mislabel produced a 1-minute create/close churn loop:
      // orphan-detection inserted a 'long' row for a SHORT exchange
      // position, the FAT reconciler closed it as a side mismatch, and
      // the next reconciler tick re-inserted it. posSide-first resolution
      // (same order as the #676/#677 fixes), Math.sign(qty) fallback for
      // ONE_WAY accounts.
      const resolveExchangeSide = (exPos: Record<string, unknown>): 'long' | 'short' => {
        const posSide = String(exPos.posSide ?? '').toUpperCase();
        const qtyNum = parseFloat(String(exPos.qty ?? exPos.availQty ?? '0'));
        return posSide === 'SHORT' || (posSide !== 'LONG' && qtyNum < 0)
          ? 'short'
          : 'long';
      };

      // ── 5. Orphan detection: on exchange but not in DB ───────────────────────
      for (const exPos of exchangePositions) {
        const symbol: string = exPos.symbol ?? exPos.instId ?? '';
        // PHANTOM-PNL FIX (2026-05-26): exPos.qty is in CONTRACTS (the
        // Poloniex v3 API unit), but autonomous_trades.quantity stores
        // base-asset units when kernel-direct INSERTs land at loop.ts:7871
        // (formattedSize is base-asset per the BASE_ASSET comment at
        // loop.ts:6940-6945). Storing contracts here mixed the units and
        // SAFE_PNL_FROM_ROW (which assumes base-asset) inflated reconciler-
        // adopted rows' pnl by 1/lotSize:
        //   BTC: 1000× (lotSize 0.001 BTC/contract)
        //   ETH: 100× (lotSize 0.01 ETH/contract)
        // Result: chemistry trained on phantom wins for ~9h on 2026-05-26.
        // Convert to base-asset at the storage boundary so all
        // autonomous_trades rows are in one canonical unit.
        const rawContracts: number = Math.abs(parseFloat(exPos.qty ?? exPos.availQty ?? '0'));
        if (!symbol || rawContracts === 0) continue;
        const precisions = await getPrecisions(symbol);
        const lotSize = precisions.lotSize ?? null;
        if (lotSize === null || lotSize <= 0) {
          logger.warn('[RECONCILE] lotSize unavailable — skipping adoption to avoid mixed-unit row', {
            symbol, rawContracts,
          });
          continue;
        }
        const size: number = rawContracts * lotSize;

        const side: 'long' | 'short' = resolveExchangeSide(exPos);

        // Check if this exchange symbol+side is already in the DB.
        // Legacy autonomous_trades rows store side as 'buy'/'sell';
        // current rows use 'long'/'short' — normalize both sides to
        // long/short before comparing.
        const matched = dbTrades.some(
          t => t.symbol === symbol && normalizeDbSide(t.side) === side,
        );

        if (!matched) {
          // Poloniex v3 /trade/position/opens emits `openAvgPx`
          // (camelCase) or `avg_open_price` (snake-case) for the
          // position's average entry price. Earlier versions of this
          // file used `avgPrice ?? entryPrice` — neither field exists
          // on v3 responses, so orphans were always inserted with
          // entry_price=0, which broke every downstream check that
          // gates on entry_price > 0 (ROI %, TP/SL calc, exit logic).
          // Same un-normalized-v3-response bug class as
          // exchangePositionSide.ts. Field order matches the v3
          // canonical preference; legacy aliases at the tail are
          // defensive in case the response shape changes again.
          const entryPrice = parseFloat(
            exPos.openAvgPx
            ?? exPos.avg_open_price
            ?? exPos.avgEntryPrice
            ?? exPos.avgPrice
            ?? exPos.entryPrice
            ?? '0',
          );
          const leverFromExchange = parseInt(
            String(exPos.lever ?? exPos.leverage ?? '1'),
            10,
          );
          const orphan: OrphanedPosition = {
            symbol,
            side,
            size,
            entryPrice,
            exchangePositionId: exPos.positionId ?? exPos.id ?? undefined
          };
          result.orphans.push(orphan);

          // Insert reconciled record into autonomous_trades.
          //
          // Adoption mode (MONKEY_RECONCILER_KERNEL_ADOPT_LIVE, default ON):
          //   agent='K', lane=inferLaneFromLeverage(lev). The kernel
          //   picks up exit management on the next tick — scalp_exit,
          //   regime_change, slow_bleed_exit, stop_loss all fire on
          //   the adopted row. The operator's chosen leverage encodes
          //   their conviction signal (high lev → trend lane with
          //   wider retreat tolerance).
          //
          // Legacy mode (env=false):
          //   agent='USER', lane='manual'. Row exists for accounting
          //   only; no kernel exit logic fires.
          try {
            const adoptLive = kernelAdoptLive();
            const effectiveLever = leverFromExchange > 0 ? leverFromExchange : 1;
            const inferredLane = inferLaneFromLeverage(effectiveLever);
            const adoptAgent = adoptLive ? 'K' : 'USER';
            const adoptLane = adoptLive ? inferredLane : 'manual';
            const reasonPrefix = adoptLive
              ? 'kernel_adopted'
              : 'manual_open_user';
            const userReason =
              `${reasonPrefix}|exchange_pid=${
                exPos.positionId ?? exPos.id ?? 'na'
              }|lev=${effectiveLever}|inferred_lane=${inferredLane}|src=reconciler`;

            // Finding 1 — notional self-consistency assertion for the
            // reconciler/adopted-position INSERT. Expected notional comes
            // from the exchange's own position report (exPos.notional);
            // when that field is absent (older exchange clients), the
            // helper falls open per its contract — the live + paper INSERT
            // paths are the load-bearing ones for new rows.
            const reconNotionalCheck = checkNotionalConsistency(
              entryPrice,
              size,
              exPos.notional ?? 0,
            );
            if (!reconNotionalCheck.consistent) {
              logger.error('[LIVED ONLY] reconciler INSERT — skipping row', {
                symbol, entryPrice, size,
                diagnostic: reconNotionalCheck.diagnostic,
              });
              continue;
            }

            await pool.query(
              `INSERT INTO autonomous_trades
               (user_id, symbol, side, entry_price, quantity, leverage, reason,
                status, engine_version, agent, lane)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, $10)`,
              [
                userId,
                symbol,
                side,
                entryPrice,
                size,
                effectiveLever,
                userReason,
                getEngineVersion(),
                adoptAgent,
                adoptLane,
              ]
            );
            logger.info(
              `[RECONCILE] ${adoptLive ? 'Kernel-adopted' : 'Tracked USER'} position for ${userId}: ` +
              `${symbol} ${side} qty=${size} @${entryPrice} lev=${effectiveLever}x ` +
              `→ agent=${adoptAgent} lane=${adoptLane}`
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
      //
      // 2026-05-13 — aggregate-qty check.
      //
      // Original (symbol, side) match handled the simple case (1 DB row
      // per position). With Agent K/M/T/L stacking, a single exchange
      // position can correspond to many DB rows. When the exchange has
      // a partial close (force-harvest of half the stack, or user
      // closes some manually), the simple match marked ALL stacked
      // rows as still-valid because the (symbol, side) tuple still
      // matches one exchange position — even when DB qty sum vastly
      // exceeds exchange qty.
      //
      // Result observed 2026-05-13: dashboard reported DB=12 vs
      // exchange=2 ("phantom state likely") because 10 of 12 rows were
      // dead but unghosted.
      //
      // Per-key exchange qty map: aggregate exchange position qty by
      // (symbol, side). We treat DB rows as ghosts in FIFO order
      // (oldest first) until aggregate matches exchange qty on that
      // key. Floor-only — never expand exchange qty by adding "phantom
      // longs" of our own.
      const exchangeQtyByKey = new Map<string, number>();
      for (const exPos of exchangePositions) {
        const exSymbol: string = exPos.symbol ?? exPos.instId ?? '';
        if (!exSymbol) continue;
        const exQty = Math.abs(parseFloat(exPos.qty ?? exPos.availQty ?? '0')) || 0;
        if (exQty === 0) continue;
        const exSide = resolveExchangeSide(exPos);
        const key = `${exSymbol}|${exSide}`;
        exchangeQtyByKey.set(key, (exchangeQtyByKey.get(key) ?? 0) + exQty);
      }
      // Track running DB-attributed qty per key. Once we've "consumed"
      // the exchange qty on a key, additional DB rows on that key are
      // phantoms even though the (symbol, side) match succeeds.
      const consumedQtyByKey = new Map<string, number>();
      const sortedDbTrades = [...dbTrades].sort((a, b) => {
        // Oldest-first — keep the freshest rows aligned to the
        // current exchange position; older rows are the phantoms.
        const ta = new Date(a.entry_time).getTime() || 0;
        const tb = new Date(b.entry_time).getTime() || 0;
        return ta - tb;
      });

      // 2026-05-13 — two-phase ghost handling to fix PnL over-attribution.
      //
      // Phase 1 IDENTIFY: walk DB rows FIFO, mark anything past the
      // exchange-qty boundary as a ghost. Collect into an array; do
      // not write yet.
      //
      // Phase 2 RECOVER + WRITE: group ghosts by (symbol, side). For
      // each group, fetch Poloniex position-history ONCE and find the
      // single close record. The aggregate realizedPnl on that record
      // is the position's total PnL; distribute pro-rata across rows
      // by qty share. Prior single-pass logic applied the aggregate
      // PnL to EACH stacked row, multiplying realized PnL by N (5×
      // observed in production 2026-05-13 03:51 / 04:38 / 05:17).
      type PendingGhost = {
        dbTrade: typeof sortedDbTrades[0];
        ghostReason: string;
        agent: 'K' | 'M' | 'T' | 'L' | null;
        instanceId: string | null;
      };
      const pendingGhosts: PendingGhost[] = [];

      for (const dbTrade of sortedDbTrades) {
        const dbSide = normalizeDbSide(dbTrade.side);
        const key = `${dbTrade.symbol}|${dbSide}`;
        const exchangeQty = exchangeQtyByKey.get(key) ?? 0;
        const consumedQty = consumedQtyByKey.get(key) ?? 0;
        const remainingExchangeQty = exchangeQty - consumedQty;
        const rowQty = Math.abs(parseFloat(dbTrade.quantity)) || 0;
        const QTY_TOLERANCE = 1e-9;
        const matched = remainingExchangeQty > QTY_TOLERANCE;
        if (matched) {
          consumedQtyByKey.set(key, consumedQty + rowQty);
          continue;
        }

        // Ghost — classify reason + agent (no DB write yet).
        const ghost: GhostRecord = {
          id: dbTrade.id,
          symbol: dbTrade.symbol,
          side: dbTrade.side,
          entryPrice: parseFloat(dbTrade.entry_price),
        };
        result.ghosts.push(ghost);

        let ghostReason = 'reconciled_not_on_exchange';
        let agent: 'K' | 'M' | 'T' | 'L' | null = null;
        let instanceId: string | null = null;
        try {
          const ctxRow = await pool.query(
            `SELECT exit_order_id, reason, agent FROM autonomous_trades WHERE id = $1`,
            [dbTrade.id],
          );
          const ctx = ctxRow.rows[0] as
            | { exit_order_id: string | null; reason: string | null; agent: string | null }
            | undefined;
          instanceId = extractKernelInstanceIdFromReason(ctx?.reason);
          if (ctx?.exit_order_id) {
            ghostReason = 'reconciled_post_close_race';
          } else if (
            ctx?.agent === 'USER' ||
            (ctx?.reason && (
              ctx.reason.startsWith('monkey|') ||
              ctx.reason.startsWith('live_signal|') ||
              ctx.reason.startsWith('autoTrader|') ||
              ctx.reason.startsWith('manual_open_user') ||
              ctx.reason.startsWith('kernel_adopted') ||
              ctx.reason === 'reconciled'
            ))
          ) {
            // Operator-closed (manual close in exchange UI) — applies to
            // both legacy USER/manual rows and kernel-adopted rows that
            // originated from operator action.
            ghostReason = 'manual_close_user';
          }
          const a = ctx?.agent;
          if (a === 'K' || a === 'M' || a === 'T' || a === 'L') agent = a;
        } catch {
          /* fail-soft: keep generic reason */
        }
        pendingGhosts.push({ dbTrade, ghostReason, agent, instanceId });
      }

      // Phase 2: group + recover + write.
      const ghostsByKey = new Map<string, PendingGhost[]>();
      for (const g of pendingGhosts) {
        const k = `${g.dbTrade.symbol}|${normalizeDbSide(g.dbTrade.side)}`;
        const list = ghostsByKey.get(k) ?? [];
        list.push(g);
        ghostsByKey.set(k, list);
      }

      for (const [groupKey, groupGhosts] of ghostsByKey) {
        const [symbol, sideStr] = groupKey.split('|');
        const groupSide: 'long' | 'short' = sideStr === 'long' ? 'long' : 'short';

        // Aggregate qty across the group's ghost rows.
        const groupQty = groupGhosts.reduce(
          (s, g) => s + (Math.abs(parseFloat(g.dbTrade.quantity)) || 0),
          0,
        );

        // Fetch Poloniex position history ONCE for this group. We look
        // for a single close record whose openTime is within ±90s of
        // the OLDEST ghost's entry_time and whose side matches.
        //
        // 2026-05-14: recover PnL for EVERY ghost group — kernel-agent
        // AND orphan/USER alike. The prior `groupHasKernelAgent` gate
        // left orphan/USER rows ghost-closed with pnl=NULL, so the bot's
        // own ledger was blind to real realized losses on them (the
        // 2026-05-14 bleed was largely invisible in autonomous_trades
        // for exactly this reason). Recording a row's realized pnl is
        // bookkeeping — it does NOT feed the kernel's learning ledger
        // (that is witnessExit → resonanceBank, gated independently).
        let aggregateRealizedPnl: number | null = null;
        if (credentials && symbol) {
          try {
            const polHistory = await poloniexFuturesService.getPositionHistory(
              credentials,
              { symbol, limit: 20 },
            );
            const histRows: any[] = Array.isArray(polHistory)
              ? polHistory
              : (polHistory?.data ?? []);
            const oldestEntryMs = Math.min(
              ...groupGhosts.map((g) => new Date(g.dbTrade.entry_time).getTime() || Infinity),
            );
            const wantSide = groupSide === 'long' ? 'LONG' : 'SHORT';
            // Pick the closest-by-openTime match to the oldest ghost's
            // entry; ±90s tolerance. Avoids picking a much-older stale
            // record when the position was re-opened recently.
            let bestMatch: any = null;
            let bestDelta = Infinity;
            for (const p of histRows) {
              const polEntryMs = Number(p.openTime ?? p.cTime ?? p.openTimestamp ?? 0);
              const polSide = String(p.posSide ?? p.side ?? '').toUpperCase();
              if (polEntryMs <= 0 || polSide !== wantSide) continue;
              const delta = Math.abs(polEntryMs - oldestEntryMs);
              if (delta < 90_000 && delta < bestDelta) {
                bestDelta = delta;
                bestMatch = p;
              }
            }
            if (bestMatch) {
              const rawPnl = parseFloat(
                bestMatch.realisedPnl ?? bestMatch.realizedPnl ?? bestMatch.pnl ?? '0',
              );
              if (Number.isFinite(rawPnl)) aggregateRealizedPnl = rawPnl;
            }
          } catch (recErr) {
            logger.debug('[RECONCILE] PnL recovery query failed (non-fatal)', {
              symbol,
              err: recErr instanceof Error ? recErr.message : String(recErr),
            });
          }
        }

        if (aggregateRealizedPnl !== null && groupGhosts.length > 1) {
          logger.info(
            `[RECONCILE] PnL recovery split across ${groupGhosts.length} stacked rows for ${symbol} ${groupSide}: aggregate=${aggregateRealizedPnl.toFixed(4)} groupQty=${groupQty.toFixed(6)}`,
          );
        }

        // ── External-close reward: bills-authoritative realized PnL ──────────
        //
        // The "operator-close hole" (#1033): externally/operator-closed
        // positions (closed in the exchange UI, or by a CC/operator exemplar
        // trade — NOT by a kernel-issued close) feed realized PnL into
        // bookkeeping above but DO NOT feed the kernel's reward chemistry. The
        // existing loop.ts subscriber for `reconciler_recovered:*` OUTCOME
        // events is starved because the conservative LIVED ONLY guard nulls
        // `pnlForLedger` and gates the publish on it being non-null.
        //
        // CANONICAL: for external (`manual_close_user`) closes we recover the
        // authoritative realized PnL from /v3/account/bills (type=PNL sum,
        // #1028 — the SAME surface the kernel's own close path consumes) and
        // publish the OUTCOME event so the kernel learns from these exemplar
        // closes. The lossy ±90s position-history match above is NOT used for
        // the reward magnitude. No env gate — always on.
        //
        // Best-effort: any failure here is swallowed and never blocks
        // reconciliation. CANONICAL — external (CC/operator) closes always feed
        // the kernel's reward chemistry. Not a knob; built to be used. (Was
        // gated behind MONKEY_REWARD_EXTERNAL_CLOSES_LIVE; gate removed
        // 2026-05-30 — operator/CC exemplar trades must teach the kernel.)
        const groupHasExternalGhost = groupGhosts.some(
          (g) => g.ghostReason === 'manual_close_user' && g.agent !== null,
        );
        let externalBillsRealizedPnl = 0;
        let externalBillsPnlRowCount = 0;
        if (groupHasExternalGhost && credentials && symbol) {
          try {
            // Tight close window around the time the reconciler is finalizing
            // these ghosts (NOW); funding hold window back to the oldest
            // ghost's entry_time. Bills carry no ordId — PNL rows are matched
            // by symbol + this window (PNL bill cTime == close fill cTime).
            const nowMs = Date.now();
            const oldestEntryMs = Math.min(
              ...groupGhosts.map(
                (g) => new Date(g.dbTrade.entry_time).getTime() || nowMs,
              ),
            );
            const holdStartMs = Number.isFinite(oldestEntryMs)
              ? oldestEntryMs
              : nowMs - 24 * 60 * 60 * 1000;
            const normSymbol = poloniexFuturesService.normalizeSymbol(symbol);
            const billRows: PoloBillRow[] = [];
            const seenBillIds = new Set<string>();
            let cursor: string | null = null;
            for (let page = 0; page < 8; page += 1) {
              const billsResp = await poloniexFuturesService.getAccountBills(
                credentials,
                { limit: 100, ...(cursor ? { from: cursor } : {}) },
              );
              const rows: any[] = Array.isArray(billsResp)
                ? billsResp
                : (billsResp?.data ?? []);
              if (rows.length === 0) break;
              for (const r of rows) {
                // Dedup by bill id so a non-advancing cursor (or a repeated
                // page) can never double-count a PNL row into the reward
                // magnitude. Bills without an id fall back to a composite key.
                const billId = String(
                  r?.id ?? `${r?.type ?? ''}|${r?.cTime ?? ''}|${r?.sz ?? ''}`,
                );
                if (seenBillIds.has(billId)) continue;
                seenBillIds.add(billId);
                billRows.push({
                  type: String(r?.type ?? ''),
                  sz: parseFloat(String(r?.sz ?? 'NaN')),
                  symbol: String(r?.symbol ?? ''),
                  cTimeMs: Number(r?.cTime),
                });
              }
              const nextCursor = String(rows[rows.length - 1]?.id ?? '') || null;
              if (rows.every((r) => Number(r?.cTime) < holdStartMs)) break;
              // Stop if the cursor did not advance (defensive against an API
              // that echoes the same page — otherwise we'd spin the 8 pages).
              if (!nextCursor || nextCursor === cursor) break;
              cursor = nextCursor;
            }
            // Close window: the reconciler discovers the close AFTER the fact,
            // so the exchange-side close cTime is somewhere between the oldest
            // entry and now. Use a generous [holdStart, now+5s] window for PNL
            // matching — these are external closes the kernel never timed, so
            // a tight cTime window (used on kernel-own closes) is unavailable.
            //
            // KNOWN LIMITATION (#1033 refine): bills carry no ordId/side, so
            // the PNL sum is matched by symbol + this time window only. If two
            // DISTINCT close events of the SAME symbol+side land inside one
            // reconciler interval, their PNL bills aggregate. For the
            // external-close group this is actually CORRECT — every K-owned row
            // in the group is attributed the aggregate, pro-rated by qty. The
            // residual unhandled case is a same-symbol+side PNL bill from a
            // DIFFERENT lifecycle (e.g. a kernel-own close that landed in the
            // same window) being folded into the external reward magnitude.
            // Tightening this reliably needs an ordId-tagged or per-fill bills
            // surface (tracked as the polo per-row-vs-per-position follow-up);
            // a time-only heuristic would mis-split legitimately-aggregated
            // closes, so we keep the symbol+window match and accept the rare
            // cross-lifecycle overlap rather than ship a fragile narrower
            // window. The flag default-OFF keeps this inert until the surface
            // improves.
            const billsComp = composePoloBillsReward(billRows, {
              symbol: normSymbol,
              closeStartMs: holdStartMs,
              closeEndMs: nowMs + 5_000,
              holdStartMs,
              holdEndMs: nowMs + 5_000,
            });
            externalBillsRealizedPnl = billsComp.realizedPnl;
            externalBillsPnlRowCount = billsComp.pnlRowCount;
            logger.info('[RECONCILE] External-close bills realized recovered', {
              symbol: normSymbol,
              realizedPnl: billsComp.realizedPnl.toFixed(4),
              pnlRows: billsComp.pnlRowCount,
              fundingRows: billsComp.fundingRowCount,
            });
          } catch (billsErr) {
            logger.warn('[RECONCILE] External-close bills fetch failed (non-fatal)', {
              symbol,
              err: billsErr instanceof Error ? billsErr.message : String(billsErr),
            });
          }
        }

        // ── Real position margin for the external-close reward (#1033 refine) ──
        //
        // The reward chemistry scales by `pnl_fraction = pnl / marginUsdt`, so
        // marginUsdt IS the lesson's scale. The original PR passed a hardcoded
        // `marginUsdt = 5` into the loop.ts reward subscriber — a synthetic
        // scale knob (P1 violation). Replace it with the position's REAL margin
        // derived from the autonomous_trades row(s):
        //   margin = entry_price × quantity / leverage
        // (quantity is base-asset post migration 060, so entry_price × quantity
        // is the USDT notional directly — no contract-size multiplier; this is
        // the SAME formula the kernel's own close path uses, #992 loop.ts).
        //
        // Computed per-row (leverage can differ across DCA-stacked rows) so each
        // pro-rata reward carries its OWN real scale, and summed for the
        // group-level eligibility decision. A row whose entry/qty/leverage is
        // missing or non-positive contributes null → decline over guess.
        const rowMarginUsdt = (t: typeof groupGhosts[number]['dbTrade']): number | null => {
          const entry = parseFloat(t.entry_price);
          const qty = Math.abs(parseFloat(t.quantity));
          const levRaw = t.leverage === null || t.leverage === undefined
            ? NaN
            : Number(t.leverage);
          const lev = Number.isFinite(levRaw) ? levRaw : NaN;
          if (!Number.isFinite(entry) || entry <= 0) return null;
          if (!Number.isFinite(qty) || qty <= 0) return null;
          if (!Number.isFinite(lev) || lev <= 0) return null;
          const margin = (entry * qty) / lev;
          return Number.isFinite(margin) && margin > 0 ? margin : null;
        };
        // Group margin: present only if EVERY external ghost row has a real
        // margin. Any null → the group's real scale is incomplete → decline
        // (rather than reward part of the group at a guessed scale).
        let groupExternalMargin: number | null = 0;
        for (const g of groupGhosts) {
          if (g.ghostReason !== 'manual_close_user' || g.agent === null) continue;
          const m = rowMarginUsdt(g.dbTrade);
          if (m === null) { groupExternalMargin = null; break; }
          groupExternalMargin = (groupExternalMargin ?? 0) + m;
        }

        // Write each ghost row with pro-rata PnL share.
        for (const g of groupGhosts) {
          const rowQty = Math.abs(parseFloat(g.dbTrade.quantity)) || 0;
          const rowShare = groupQty > 0 ? rowQty / groupQty : 0;
          // Record the recovered realized PnL on every ghost-closed row
          // (see the comment on the history fetch above) — kernel-agent
          // and orphan/USER alike — so autonomous_trades.pnl is an
          // accurate ledger. This is bookkeeping, separate from what
          // feeds the kernel's learning (witnessExit → resonanceBank).
          const recoveredPnl: number | null =
            aggregateRealizedPnl !== null
              ? aggregateRealizedPnl * rowShare
              : null;

          try {
            // LIVED ONLY 5 guard on ghost recovery (Finding 1).
            // Be conservative: do not write or publish aggregate-derived
            // recoveredPnl on ghost rows unless we can fully verify it. Do
            // still close the ghost row; otherwise the same already-closed
            // exchange position is rediscovered every reconciler tick.
            let pnlForLedger: number | null = recoveredPnl;
            if (recoveredPnl !== null) {
              logger.warn('[LIVED ONLY] skipping aggregate recoveredPnl write during ghost recovery (conservative LIVED ONLY)', {
                tradeId: g.dbTrade.id,
              });
              pnlForLedger = null;
            }

            // Dedup: gate the close transition on status='open' so the reward
            // publish below fires AT MOST ONCE per row (the row is only
            // transitioned to 'closed' by exactly one reconciler tick). This
            // prevents a re-reward if a later tick re-examines an
            // already-closed row.
            const closeRes = await pool.query(
              `UPDATE autonomous_trades
               SET status = 'closed',
                   exit_reason = $1,
                   exit_time = NOW(),
                   pnl = COALESCE($3, pnl)
               WHERE id = $2 AND status = 'open'`,
              [g.ghostReason, g.dbTrade.id, pnlForLedger],
            );
            const transitioned = (closeRes.rowCount ?? 0) === 1;
            logger.info(
              `[RECONCILE] Closed ghost DB record ${g.dbTrade.id} for user ${userId}: ${g.dbTrade.symbol} ${g.dbTrade.side} (reason=${g.ghostReason}${
                pnlForLedger !== null ? `, share=${(rowShare * 100).toFixed(1)}%, recovered_pnl=${pnlForLedger.toFixed(4)}` : ''
              })`,
            );

            // ── External-close reward publish (#1033, flag-gated) ─────────────
            //
            // The pure helper encodes every guard: flag ON, ghostReason ===
            // 'manual_close_user' (excludes the kernel's own late-landing
            // 'reconciled_post_close_race' close so it can NEVER be
            // double-rewarded), agent attributed, and a bills-authoritative
            // magnitude (declines on no PNL rows rather than guess). When the
            // flag is OFF the decision is `flag_off` → no publish → behaviour
            // is byte-identical to the bookkeeping-only path above.
            //
            // We only publish when THIS tick transitioned the row (dedup) so
            // the chemistry sees each external close exactly once.
            // Per-row REAL margin (entry_price × quantity / leverage). This is
            // THIS row's own scale — passed in the OUTCOME payload so the
            // loop.ts subscriber feeds `pnl_fraction = pnl / marginUsdt` with
            // the real position margin, NOT the retired synthetic `5`.
            const rowMargin = rowMarginUsdt(g.dbTrade);
            const rewardDecision = decideExternalCloseReward({
              ghostReason: g.ghostReason,
              agent: g.agent,
              billsRealizedPnl: externalBillsRealizedPnl,
              pnlBillRowCount: externalBillsPnlRowCount,
              // Group-level real margin gates eligibility (decline if any row
              // in the group lacks a real margin); the per-row margin below
              // sets the published scale.
              marginUsdt: groupExternalMargin,
            });
            if (rewardDecision.eligible && transitioned && rowMargin !== null) {
              // Pro-rata the group's authoritative realized PnL by this row's
              // qty share so a DCA-stacked external close attributes each row
              // its proportional slice (mirrors the bookkeeping rowShare).
              const rowRewardPnl = rewardDecision.realizedPnl * rowShare;
              if (Number.isFinite(rowRewardPnl)) {
                try {
                  const bus = getKernelBus();
                  bus.publish({
                    type: BusEventType.OUTCOME,
                    source: 'reconciler',
                    symbol: g.dbTrade.symbol,
                    payload: {
                      agent: g.agent,
                      instanceId: g.instanceId,
                      side: normalizeDbSide(g.dbTrade.side),
                      pnl: rowRewardPnl,
                      // REAL per-row margin → the loop.ts subscriber uses this
                      // for pnl_fraction instead of the synthetic marginUsdt=5.
                      marginUsdt: rowMargin,
                      // The loop.ts subscriber keys on
                      // `source.startsWith('reconciler_recovered')` →
                      // applyOutcomeToAgent + pushReward + callAutonomicReward.
                      source: `reconciler_recovered:${g.ghostReason}`,
                      ghostReason: g.ghostReason,
                      tradeId: g.dbTrade.id,
                      pnlSource: rewardDecision.pnlSource,
                    },
                  });
                  logger.info('[RECONCILE] External-close reward published to chemistry', {
                    tradeId: g.dbTrade.id,
                    symbol: g.dbTrade.symbol,
                    agent: g.agent,
                    rowRewardPnl: rowRewardPnl.toFixed(4),
                    rowMarginUsdt: rowMargin.toFixed(4),
                    pnlSource: rewardDecision.pnlSource,
                  });
                } catch (busErr) {
                  // Best-effort: a reward-firing failure NEVER blocks
                  // reconciliation or trading.
                  logger.debug('[RECONCILE] External-close OUTCOME publish failed (non-fatal)', {
                    err: busErr instanceof Error ? busErr.message : String(busErr),
                  });
                }
              }
            }
          } catch (updateErr) {
            logger.error(
              `[RECONCILE] Failed to close ghost record ${g.dbTrade.id} for user ${userId}:`,
              updateErr,
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
   *   2. Users with any open live_signal or monkey trade in
   *      autonomous_trades (does not require autonomous_trading_configs).
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

      // Source 2: users with an open auto-trader row. This covers
      // Monkey's footprint (and any residual legacy live_signal rows) —
      // if phantom rows accumulate, the stacking guard freezes all
      // future entries until the reconciler catches them. Covering this
      // surface is the whole point of P2. Monkey is the producer of
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
