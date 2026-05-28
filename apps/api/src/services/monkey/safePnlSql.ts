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
/**
 * The pnl value expression alone (no `pnl =` prefix). Use INSIDE other
 * SQL expressions where you need the computed value, not a SET clause.
 *
 * The 2026-05-28 production bug that motivated this: callers were
 * embedding SAFE_PNL_FROM_ROW inside COALESCE like
 *   `gross_pnl = COALESCE(gross_pnl, ${SAFE_PNL_FROM_ROW})`
 * which expands to `COALESCE(numeric, pnl = quantity * ...)` — the
 * inner part is an equality test returning BOOLEAN, so Postgres
 * rejects with "COALESCE types numeric and boolean cannot be matched".
 *
 * Use SAFE_PNL_EXPR when nesting; use SAFE_PNL_FROM_ROW only as the
 * last SET clause.
 */
export const SAFE_PNL_EXPR =
  `quantity * ($1::numeric - entry_price) * `
  + `CASE WHEN side IN ('buy', 'long') THEN 1::numeric ELSE -1::numeric END`;

export const SAFE_PNL_FROM_ROW = `pnl = ${SAFE_PNL_EXPR}`;

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
 * Net-of-fees PnL for the *chemistry / reward observer* (P1/P5/P25 critical).
 *
 * The gross SAFE_PNL_FROM_ROW / computeSafePnl value is correct for
 * row-level accounting and phantom detection. It is NOT the economic
 * reality the kernel actually experienced on Polo (taker fees on entry
 * + exit + funding rates).
 *
 * The reward gate (pnlFracHistory → median/MAD → z-deviation →
 * observerFibCoefficient → dopamine/serotonin tiers) MUST be driven by
 * the net outcome. Otherwise small-edge trades that are gross-positive
 * but net-negative (the exact 15:30:45 case: +0.148 gross / ≈ −0.02 net
 * after ~$0.17 fees) will fire positive chemistry, systematically
 * reinforcing structurally losing behavior.
 *
 * Conservative model (Polo USDT-M futures, typical VIP0 taker):
 *   roundTripFeePct ≈ 0.0008 (8 bp) + small funding buffer.
 * This is deliberately conservative so the kernel never over-rewards
 * marginal trades. A more precise per-symbol fee schedule can replace
 * the constant later; the structure (gross → net adjustment before
 * the observer) is the invariant.
 *
 * LIVED ONLY 5: every call site that feeds the reward observer must
 * pass through this (or an equivalent authoritative net source).
 * Gross is a violation.
 */
export function computeNetPnlForReward(
  grossPnlUsdt: number,
  notionalUsdt: number,
): number {
  // "Reward based on actual profit" doctrine (operator 2026-05-27):
  //   "dont suggest knobs jsut increase the telemetry and reward based on
  //    actual profit."
  //
  // The previous 9bp + 0.18 floor were knobs — fee estimates the operator
  // explicitly rejected. The canonical reward path is
  // applyPoloRealizedPnlAfterClose, which fetches Polo's real realizedPnl
  // (net of fees + funding) and pushes a `polo_authoritative_close` event
  // carrying the actual lived economic outcome. That path is the only one
  // that produces chemistry from now on.
  //
  // This function (called for the immediate synthetic-close path) now
  // returns 0 when an authoritative Polo notional context exists — the
  // chemistry waits for the Polo-authoritative event rather than
  // fabricating a fee estimate. The pre-Polo synthetic push therefore
  // produces no chemistry delta; it's a placeholder that the
  // authoritative event will replace within seconds.
  //
  // Cold-start / test fixtures (no notional → notionalUsdt ≤ 0) fall
  // open to gross so harness code that doesn't thread a notional keeps
  // working. Production paths always thread notional > 0.
  if (!Number.isFinite(grossPnlUsdt)) return 0;
  if (!Number.isFinite(notionalUsdt) || notionalUsdt <= 0) {
    return grossPnlUsdt;
  }
  return 0;
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

/**
 * Notional self-consistency assertion (Finding 1 / LIVED ONLY 5).
 *
 * Before any row enters `autonomous_trades`, the row's own data
 * (`entry_price * quantity`) must match the originating order's
 * declared notional within a small tolerance. Mismatch means the
 * `quantity` value is in the wrong unit (contracts vs base-asset) —
 * the root cause of the 100×/1000× phantom-PnL.
 *
 * Default tolerance 0.1% — wider than realistic slippage, tighter
 * than any unit-conversion mismatch could be.
 *
 * Fall-open when `expectedNotional ≤ 0` or non-finite: the caller
 * had no observable notional to assert against (e.g. legacy test
 * fixtures, paths that don't yet thread the order response).
 * Callers MUST thread an expected notional on the live INSERT paths
 * — the fall-open is only for boundary code.
 */
export interface NotionalCheck {
  consistent: boolean;
  rowNotional: number;
  expectedNotional: number;
  divergenceAbs: number;
  divergencePct: number;
  diagnostic: string;
}

export function checkNotionalConsistency(
  entryPrice: number,
  quantity: number,
  expectedNotional: number,
  tolerancePct = 0.001,
): NotionalCheck {
  const rowNotional = entryPrice * quantity;
  if (expectedNotional <= 0 || !Number.isFinite(expectedNotional)) {
    return {
      consistent: true,
      rowNotional, expectedNotional,
      divergenceAbs: 0, divergencePct: 0,
      diagnostic: 'no expected notional supplied — assertion bypassed (fall-open)',
    };
  }
  const divergenceAbs = Math.abs(rowNotional - expectedNotional);
  const divergencePct = divergenceAbs / expectedNotional;
  const consistent = divergencePct <= tolerancePct;
  return {
    consistent, rowNotional, expectedNotional, divergenceAbs, divergencePct,
    diagnostic: consistent
      ? `notional consistent (${(divergencePct * 100).toFixed(3)}% vs tolerance ${(tolerancePct * 100).toFixed(2)}%)`
      : `notional MISMATCH: row=$${rowNotional.toFixed(2)} vs expected=$${expectedNotional.toFixed(2)} `
        + `(${(divergencePct * 100).toFixed(3)}% > ${(tolerancePct * 100).toFixed(2)}% tolerance) — `
        + `likely unit mismatch (contracts vs base-asset)`,
  };
}
