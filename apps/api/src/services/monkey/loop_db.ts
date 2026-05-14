/**
 * loop_db.ts — Monkey kernel DB-read helpers.
 * Extracted verbatim from loop.ts (2026-05-14 modularization). These
 * were MonkeyKernel methods whose only `this` dependency was
 * `this.instanceId` — moved to free functions taking `instanceId` as a
 * parameter. Read-only queries against autonomous_trades; no kernel
 * state, no side effects. Behaviour is identical to the former methods.
 */
import { pool } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

/**
 * Look up Monkey's most recent open trade row for a symbol. Used by
 * the scalp-exit gate (v0.4) to compute unrealized P&L.
 *
 * Aggregate over ALL open lanes (back-compat: callers that don't
 * know about lanes still need a single open-row view). Returns the
 * OLDEST lane's pseudo-row when multiple lanes hold positions; the
 * proper lane-aware path uses ``findOpenMonkeyTradesByLane`` below.
 */
export async function findOpenMonkeyTrade(
  instanceId: string,
  symbol: string,
): Promise<
  | { id: string; entry_price: string; quantity: string; leverage: number; order_id: string | null; side: 'long' | 'short'; lane: 'scalp' | 'swing' | 'trend' }
  | null
> {
  try {
    const reasonPattern = `monkey|kernel=${instanceId}|%`;
    const result = await pool.query(
      `SELECT id, entry_price, quantity, leverage, order_id, side, lane
         FROM autonomous_trades
        WHERE reason LIKE $2 AND status = 'open' AND symbol = $1
        ORDER BY entry_time ASC`,
      [symbol, reasonPattern],
    );
    const rows = result.rows as Array<{
      id: string; entry_price: string; quantity: string; leverage: number;
      order_id: string | null; side: string; lane: string;
    }>;
    const normSide = (s: string): 'long' | 'short' =>
      s === 'buy' || s === 'long' ? 'long' : 'short';
    const normLane = (l: string | null | undefined): 'scalp' | 'swing' | 'trend' =>
      (l === 'scalp' || l === 'trend') ? l : 'swing';
    if (rows.length === 0) return null;
    if (rows.length === 1) {
      return { ...rows[0], side: normSide(rows[0].side), lane: normLane(rows[0].lane) };
    }
    // Multi-row: aggregate by quantity-weighted entry price across
    // ALL rows for legacy callers. The lane-aware path operates per
    // (lane) inside findOpenMonkeyTradesByLane and is the source of
    // truth post-#10.
    const totalQty = rows.reduce((s, r) => s + Math.abs(Number(r.quantity) || 0), 0);
    const weightedPrice = rows.reduce(
      (s, r) => s + Number(r.entry_price) * Math.abs(Number(r.quantity) || 0),
      0,
    ) / totalQty;
    return {
      id: rows[0].id,
      entry_price: String(weightedPrice),
      quantity: String(totalQty),
      leverage: rows[0].leverage,
      order_id: rows[0].order_id,
      side: normSide(rows[0].side),
      lane: normLane(rows[0].lane),
    };
  } catch (err) {
    logger.debug('[Monkey] findOpenMonkeyTrade failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Proposal #10 — per-lane open-position lookup. Returns one entry per
 * lane that currently has an open Monkey row on this symbol; rows
 * within a lane are aggregated (DCA adds collapse into a single
 * pseudo-row per lane the same way the symbol-wide aggregation worked
 * pre-#10).
 *
 * Used by processSymbol to thread lane-positions into TickInputs and
 * by the entry path to gate "is THIS lane flat?" rather than the
 * symbol-wide held-side question.
 */
export async function findOpenMonkeyTradesByLane(
  instanceId: string,
  symbol: string,
): Promise<
  Array<{
    lane: 'scalp' | 'swing' | 'trend';
    side: 'long' | 'short';
    entry_price: number;
    quantity: number;
    trade_id: string;
    order_id: string | null;
    leverage: number;
  }>
> {
  try {
    const reasonPattern = `monkey|kernel=${instanceId}|%`;
    const result = await pool.query(
      `SELECT id, entry_price, quantity, leverage, order_id, side, lane
         FROM autonomous_trades
        WHERE reason LIKE $2 AND status = 'open' AND symbol = $1
        ORDER BY entry_time ASC`,
      [symbol, reasonPattern],
    );
    const rows = result.rows as Array<{
      id: string; entry_price: string; quantity: string; leverage: number;
      order_id: string | null; side: string; lane: string;
    }>;
    const normSide = (s: string): 'long' | 'short' =>
      s === 'buy' || s === 'long' ? 'long' : 'short';
    const normLane = (l: string | null | undefined): 'scalp' | 'swing' | 'trend' =>
      (l === 'scalp' || l === 'trend') ? l : 'swing';
    // Group by lane, weighted-average within each lane (DCA roll-up).
    const byLane: Map<string, typeof rows> = new Map();
    for (const r of rows) {
      const lane = normLane(r.lane);
      if (!byLane.has(lane)) byLane.set(lane, []);
      byLane.get(lane)!.push(r);
    }
    const out: Array<{
      lane: 'scalp' | 'swing' | 'trend';
      side: 'long' | 'short';
      entry_price: number;
      quantity: number;
      trade_id: string;
      order_id: string | null;
      leverage: number;
    }> = [];
    for (const [laneStr, laneRows] of byLane) {
      const lane = laneStr as 'scalp' | 'swing' | 'trend';
      if (laneRows.length === 0) continue;
      const totalQty = laneRows.reduce(
        (s, r) => s + Math.abs(Number(r.quantity) || 0), 0);
      if (totalQty === 0) continue;
      const weightedPrice = laneRows.reduce(
        (s, r) => s + Number(r.entry_price) * Math.abs(Number(r.quantity) || 0),
        0,
      ) / totalQty;
      out.push({
        lane,
        side: normSide(laneRows[0].side),
        entry_price: weightedPrice,
        quantity: totalQty,
        trade_id: laneRows[0].id,
        order_id: laneRows[0].order_id,
        leverage: laneRows[0].leverage,
      });
    }
    return out;
  } catch (err) {
    logger.debug('[Monkey] findOpenMonkeyTradesByLane failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function sumOpenContractsForPosition(
  instanceId: string,
  symbol: string,
  agent: 'K' | 'M' | 'T',
  side: 'long' | 'short',
  lane: 'scalp' | 'swing' | 'trend',
  lotSize: number,
): Promise<number> {
  if (!Number.isFinite(lotSize) || lotSize <= 0) return 0;
  try {
    const reasonPattern = `monkey|kernel=${instanceId}|%`;
    // DB stores 'buy'|'sell' historically AND 'long'|'short' on newer
    // rows — match either to be safe.
    const sideAlternates =
      side === 'long' ? ['buy', 'long'] : ['sell', 'short'];
    const result = await pool.query(
      `SELECT COALESCE(SUM(ABS(quantity)), 0) AS sum_qty
         FROM autonomous_trades
        WHERE status = 'open'
          AND symbol = $1
          AND agent = $2
          AND lane = $3
          AND side = ANY($4)
          AND reason LIKE $5`,
      [symbol, agent, lane, sideAlternates, reasonPattern],
    );
    const row = result.rows[0] as { sum_qty: string | number } | undefined;
    const sumBaseAsset = Number(row?.sum_qty ?? 0);
    // Convert base-asset quantity to contracts.
    return Math.floor(sumBaseAsset / lotSize);
  } catch (err) {
    logger.debug('[Monkey] sumOpenContractsForPosition failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/**
 * Sum of currently-open margin (USDT) for a given agent on a symbol.
 * Margin = quantity × entry_price ÷ leverage (legacy rows without
 * leverage fall back to notional).
 *
 * Used by the per-agent equity bound (#10): the kernel checks this
 * against the Arbiter's per-tick allocation before letting an agent
 * stack a fresh entry. Fail-soft returns 0 — the exchange-side
 * margin enforcement (Poloniex 21005) is the hard ceiling, this
 * guard is the soft preventative.
 */
export async function sumOpenAgentMargin(
  instanceId: string,
  symbol: string,
  agent: 'K' | 'M' | 'T' | 'L',
): Promise<number> {
  try {
    const reasonPattern = `monkey|kernel=${instanceId}|%`;
    const result = await pool.query(
      `SELECT COALESCE(SUM(
          CASE
            WHEN leverage > 0 THEN (quantity * entry_price / leverage)
            ELSE quantity * entry_price
          END
        ), 0) AS sum_margin
         FROM autonomous_trades
        WHERE status = 'open'
          AND symbol = $1
          AND agent = $2
          AND reason LIKE $3`,
      [symbol, agent, reasonPattern],
    );
    const row = result.rows[0] as { sum_margin: string | number } | undefined;
    return Number(row?.sum_margin ?? 0);
  } catch (err) {
    logger.debug('[Monkey] sumOpenAgentMargin failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/**
 * 2026-05-10 — sum cumulative open notional (quantity × entry_price)
 * for an agent on a symbol. Distinct from sumOpenAgentMargin which
 * divides by leverage. Used by the per-agent cumulative notional cap
 * to bound stacked-row exposure (L stacked 39 rows on a $200 account
 * → 17.7× equity in cumulative notional, each row individually
 * within margin limits).
 */
export async function sumOpenAgentNotional(
  instanceId: string,
  symbol: string,
  agent: 'K' | 'M' | 'T' | 'L',
): Promise<number> {
  try {
    const reasonPattern = `monkey|kernel=${instanceId}|%`;
    const result = await pool.query(
      `SELECT COALESCE(SUM(quantity * entry_price), 0) AS sum_notional
         FROM autonomous_trades
        WHERE status = 'open'
          AND symbol = $1
          AND agent = $2
          AND reason LIKE $3`,
      [symbol, agent, reasonPattern],
    );
    const row = result.rows[0] as { sum_notional: string | number } | undefined;
    return Number(row?.sum_notional ?? 0);
  } catch (err) {
    logger.debug('[Monkey] sumOpenAgentNotional failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
