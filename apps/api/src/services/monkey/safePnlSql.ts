/**
 * safePnlSql.ts — SQL fragments that compute pnl from the row's OWN
 * data, bypassing caller-provided aggregate values.
 *
 * Why this exists:
 *   Multiple close paths (closeHeldPosition, race_lost_to_sibling
 *   handler, exchange_position_vanished handler, db-recovery fallback)
 *   were writing `pnl = $caller_value` where the caller value was the
 *   AGGREGATE across all open rows for the kernel+symbol. When the
 *   aggregate landed on a single row, the row's recorded pnl could be
 *   wildly inflated (observed: +$315.21 on a row whose true pnl was
 *   −$1.03; +$374.12 on a row whose true pnl was +$0.0026).
 *
 *   Both phantoms had `exit_reason='scalp_exit'` and small qty BTC
 *   buys, but the bug is structural: any path that writes a caller-
 *   provided aggregate to a single row can produce a phantom.
 *
 *   The fix: compute pnl directly from the row's own entry_price,
 *   quantity, and side using SQL arithmetic. This guarantees per-row
 *   correctness regardless of what the caller intended. Fees are not
 *   subtracted (pre-existing gap; see #931 for the fee-accounting
 *   item). The 7-day audit showed ~$1.09/row systematic drift
 *   consistent with unsubtracted fees — strictly improves over
 *   phantom values without regressing fee accounting.
 *
 * Usage:
 *   `UPDATE autonomous_trades
 *       SET status='closed', exit_price=$1, exit_time=NOW(),
 *           exit_reason=$2, exit_order_id=$3,
 *           ${SAFE_PNL_FROM_ROW} `  // expands to: pnl = qty * (...)
 *     WHERE id=$4`
 *
 * The fragment references `$1` (markPrice / exit_price), so callers
 * MUST keep markPrice as the first parameter for it to work.
 */

/**
 * SQL fragment that sets `pnl` from the row's own entry_price + qty +
 * side, using the bound parameter $1 as the exit price. Use as the
 * LAST clause in the SET list (no trailing comma).
 *
 * Embeds in the UPDATE like:
 *   `SET status='closed', exit_price=$1, exit_time=NOW(),
 *        exit_reason=$2, exit_order_id=$3, ${SAFE_PNL_FROM_ROW}`
 *
 * `side` column stores 'buy' or 'long' for long-side and 'sell' or
 * 'short' for short-side. Both legacy spellings are handled.
 */
export const SAFE_PNL_FROM_ROW =
  `pnl = quantity * ($1::numeric - entry_price) * `
  + `CASE WHEN side IN ('buy', 'long') THEN 1::numeric ELSE -1::numeric END`;

/**
 * Compute the same pnl in TypeScript for callers that need the value
 * BEFORE the UPDATE (e.g. to feed pushReward chemistry). Mirrors
 * SAFE_PNL_FROM_ROW exactly so the TS and SQL values agree.
 */
export function computeSafePnl(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  side: 'buy' | 'sell' | 'long' | 'short',
): number {
  const sideSign = side === 'buy' || side === 'long' ? 1 : -1;
  return quantity * (exitPrice - entryPrice) * sideSign;
}

/**
 * Verify a caller-provided pnl against the row's own data. Returns a
 * structured object describing any divergence > threshold so callers
 * can log/alert without depending on the divergence to occur.
 *
 * The `provided` value usually comes from the aggregate-pnl path
 * (closeHeldPosition's pnlAtDecision arg). The `calculated` value is
 * the SAFE_PNL_FROM_ROW formula. Divergence > $5 is the threshold for
 * "phantom-class" anomaly per the #931 audit (smallest observed
 * phantom was ~$23; smallest legitimate divergence from slippage is
 * typically < $3).
 *
 * Returned shape is compatible with structured logging — use
 * `if (result.diverged) logger.error('pnl_divergence', result)`.
 */
export interface PnlVerification {
  diverged: boolean;
  provided: number;
  calculated: number;
  divergenceAbs: number;
  /** True if the divergence is large enough to be a phantom risk. */
  isPhantomCandidate: boolean;
}

export function verifyPnl(
  provided: number,
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  side: 'buy' | 'sell' | 'long' | 'short',
  phantomThresholdUsd = 5.0,
): PnlVerification {
  const calculated = computeSafePnl(entryPrice, exitPrice, quantity, side);
  const divergenceAbs = Math.abs(provided - calculated);
  return {
    diverged: divergenceAbs > 0.5,           // any meaningful drift
    isPhantomCandidate: divergenceAbs > phantomThresholdUsd,
    provided,
    calculated,
    divergenceAbs,
  };
}
