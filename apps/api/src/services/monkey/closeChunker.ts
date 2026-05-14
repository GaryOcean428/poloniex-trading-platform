/**
 * closeChunker.ts — split a position close into per-order-cap chunks.
 *
 * Poloniex v3 rejects single orders > 10,000 contracts with code 21010
 * ("The size per order cannot exceed 10000 Conts."). Before this helper,
 * any oversized position was permanently uncloseable by the kernel —
 * scalp_exit / stale_bleed / harvest would all fire correctly but the
 * close order itself was rejected, leaving the position stranded on
 * the exchange.
 *
 * Live tape 2026-05-05 02:08-02:10: BTC stale_bleed retrying every tick
 * with code 21010 rejection while position bled from -1.24% to -3.21% ROI.
 *
 * Pure function — no I/O, trivially testable.
 */

export const MAX_CONTRACTS_PER_ORDER = 9999;  // Conservative — Poloniex cap is 10000

export interface ChunkPlan {
  chunks: number[];
  /** Sum of chunks (≤ desired). May be < desired if a residual smaller
   *  than one lot couldn't be fit into a chunk; the reconciler handles
   *  that residual via its standard ghost-close path. */
  totalCovered: number;
  /** Residual that couldn't be allocated (smaller than one lot). */
  residual: number;
}

/**
 * Plan how to split a close into chunks of ≤ ``maxPerOrder`` contracts.
 * Each chunk is rounded DOWN to a multiple of ``lotSize`` so the exchange
 * accepts every chunk.
 *
 * Returns an empty plan when ``desired <= 0`` or every chunk rounded to
 * zero (e.g. lot > maxPerOrder is a misconfiguration the caller must
 * surface).
 */
export function planCloseChunks(
  desired: number,
  lotSize: number,
  maxPerOrder: number = MAX_CONTRACTS_PER_ORDER,
): ChunkPlan {
  if (!Number.isFinite(desired) || desired <= 0) {
    return { chunks: [], totalCovered: 0, residual: 0 };
  }
  if (!Number.isFinite(maxPerOrder) || maxPerOrder <= 0) {
    return { chunks: [], totalCovered: 0, residual: desired };
  }
  const lot = Number.isFinite(lotSize) && lotSize > 0 ? lotSize : 0;
  const chunks: number[] = [];
  let remaining = desired;
  while (remaining > 0) {
    const cap = Math.min(remaining, maxPerOrder);
    const chunk = lot > 0 ? Math.floor(cap / lot) * lot : cap;
    if (chunk <= 0) break;
    chunks.push(chunk);
    remaining -= chunk;
  }
  const totalCovered = chunks.reduce((s, v) => s + v, 0);
  return { chunks, totalCovered, residual: Math.max(0, desired - totalCovered) };
}
