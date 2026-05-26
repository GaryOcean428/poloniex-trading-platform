/**
 * pnlReconciliation.ts — row-level pnl divergence detection (#932).
 *
 * Sits as a post-UPDATE check on every close-path write to
 * autonomous_trades.pnl. Compares the just-written value against what
 * the row's own data computes to. Emits structured telemetry on any
 * material divergence so a phantom (or new bug introducing a phantom)
 * is caught within one tick rather than waiting for a nightly cron.
 *
 * #931 ships SAFE_PNL_FROM_ROW which makes the pnl computation use
 * row-own arithmetic everywhere — but that doesn't stop a future bug
 * from regressing this guarantee. This file is the safety net.
 *
 * Two thresholds:
 *   - $0.50 → `diverged` (drift; logged at warn, not actioned)
 *   - $5.00 → `phantom` (kernel-aggregate-class anomaly; logged at error,
 *             chemistry feed gets the calculated value, telemetry counter
 *             increments so paging can wire on >0 over short windows)
 *
 * Nightly cron (separate; this file is the row-level layer):
 *   Operator can pull `funding-history` CSVs from Poloniex and diff
 *   against `autonomous_trades.pnl` over a 24h window. A scheduled
 *   reconciliation job is a future ship; the immediate value is the
 *   row-level alert that catches phantoms within minutes, not hours.
 *
 * See #932 for the issue.
 */

import { logger } from '../../utils/logger.js';
import { computeSafePnl } from './safePnlSql.js';

export interface PnlReconciliationInput {
  /** The pnl value just written to (or about to be written to) the DB. */
  writtenPnl: number;
  /** Row's own entry price. */
  entryPrice: number;
  /** Row's exit price (markPrice at the time of close). */
  exitPrice: number;
  /** Row's quantity (positive magnitude). */
  quantity: number;
  /** Row's side. Both legacy ('buy'/'sell') and modern ('long'/'short') accepted. */
  side: 'buy' | 'sell' | 'long' | 'short';
  /** Row id for log context. */
  rowId: string;
  /** Symbol for log context. */
  symbol: string;
  /** Exit reason for log context — helps spot which close-path produced the drift. */
  exitReason: string;
}

export interface PnlReconciliationResult {
  /** True if |written - calc| > driftThreshold ($0.50 default). */
  diverged: boolean;
  /** True if |written - calc| > phantomThreshold ($5.00 default). */
  isPhantomCandidate: boolean;
  /** Row's own pnl computation. */
  calculatedPnl: number;
  /** Absolute divergence in USD. */
  divergenceAbs: number;
}

/**
 * Thresholds tuned from the #931 audit:
 *   - $0.50: lowest legitimate drift level observed in clean data
 *     (slippage between exit_order placement and fill on small orders).
 *   - $5.00: largest legitimate drift was ~$3 (slippage on large fills);
 *     smallest observed phantom was $23. $5 is comfortably between.
 */
const DRIFT_THRESHOLD_USD = 0.5;
const PHANTOM_THRESHOLD_USD = 5.0;

/**
 * Post-write reconciliation. Call this AFTER every UPDATE that writes
 * pnl to autonomous_trades — passing the value that was written and the
 * row's own fields. Logs structured telemetry on divergence so paging
 * can wire on `pnl_divergence` events.
 *
 * Returns the calculated pnl so the caller can substitute it for the
 * written value when feeding chemistry (defense in depth: even if the
 * UPDATE wrote a phantom, the chemistry queue gets the safe value).
 */
export function reconcilePnl(input: PnlReconciliationInput): PnlReconciliationResult {
  const calculatedPnl = computeSafePnl(
    input.entryPrice,
    input.exitPrice,
    input.quantity,
    input.side,
  );
  const divergenceAbs = Math.abs(input.writtenPnl - calculatedPnl);
  const diverged = divergenceAbs > DRIFT_THRESHOLD_USD;
  const isPhantomCandidate = divergenceAbs > PHANTOM_THRESHOLD_USD;

  if (isPhantomCandidate) {
    logger.error('[pnl_reconciliation] PHANTOM detected', {
      rowId: input.rowId,
      symbol: input.symbol,
      exitReason: input.exitReason,
      writtenPnl: input.writtenPnl,
      calculatedPnl,
      divergenceAbs,
      entryPrice: input.entryPrice,
      exitPrice: input.exitPrice,
      quantity: input.quantity,
      side: input.side,
    });
  } else if (diverged) {
    logger.warn('[pnl_reconciliation] drift detected', {
      rowId: input.rowId,
      symbol: input.symbol,
      exitReason: input.exitReason,
      writtenPnl: input.writtenPnl,
      calculatedPnl,
      divergenceAbs,
    });
  }

  return {
    diverged,
    isPhantomCandidate,
    calculatedPnl,
    divergenceAbs,
  };
}

/**
 * Convenience: returns the pnl value to feed into chemistry. Uses the
 * calculated (safe) value when the divergence is phantom-class —
 * defense in depth against any future regression where SAFE_PNL_FROM_ROW
 * is bypassed or fails.
 */
export function safePnlForChemistry(input: PnlReconciliationInput): number {
  const result = reconcilePnl(input);
  return result.isPhantomCandidate ? result.calculatedPnl : input.writtenPnl;
}
