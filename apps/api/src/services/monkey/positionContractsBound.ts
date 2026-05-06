/**
 * positionContractsBound.ts — per-(agent, symbol, lane) hard cap on
 * cumulative open contracts.
 *
 * Why this exists:
 *
 * Poloniex v3 rejects single orders > 10,000 contracts with code 21010.
 * The closeChunker (closeChunker.ts) splits an oversized close into chunks
 * — necessary defense, but it treats the symptom. The disease is the
 * kernel letting positions grow that large in the first place. Live tape
 * 2026-05-06 02:08-12hr: Agent T (Turtle pyramid on Donchian breakouts)
 * accumulated 9 BTC swing/trend rows over 12 hours, cumulative quantity
 * far exceeded 10,000 contracts. Stale_bleed correctly fired but every
 * close was rejected. User had to manually flatten on Poloniex UI.
 *
 * The cap below is set well under the exchange limit (8,000 vs 10,000)
 * so the kernel always retains headroom for partial closes / chunked
 * exits. It bounds CUMULATIVE quantity per (agent, symbol, lane),
 * not per-order — so DCA adds, T pyramids, and consecutive M entries
 * all funnel into the same envelope.
 *
 * Independence preserved: K, M, T each get their own cap (the cap is
 * scoped per agent label). One agent maxing out doesn't suppress the
 * others. Mirrors the agentEquityBound discipline (PR #636).
 */

/**
 * Default ceiling. 8,000 contracts at BTC's 0.0001 lot size = 0.8 BTC
 * (~ \$80k notional at typical prices); at ETH's 0.01 lot = 80 ETH
 * (~ \$200k). These are large but within typical Poloniex retail
 * tolerances. The 2,000-contract buffer below the exchange's 10,000
 * cap leaves room for one-shot full closes (no chunking needed).
 */
export const MAX_CONTRACTS_PER_POSITION_DEFAULT = 8000;

/** Env override: set ``MONKEY_MAX_CONTRACTS_PER_POSITION`` to tune. */
export function getMaxContractsPerPosition(): number {
  const raw = Number(process.env.MONKEY_MAX_CONTRACTS_PER_POSITION);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return MAX_CONTRACTS_PER_POSITION_DEFAULT;
}

/**
 * Compute the maximum new contracts that can be added without exceeding
 * the per-position cap. Returns 0 when the position is already at-cap.
 *
 * Pure function — caller queries the DB for ``currentContracts``, then
 * uses this to decide whether to clamp or skip the entry.
 */
export function headroomContracts(
  currentContracts: number,
  maxCap: number,
): number {
  if (!Number.isFinite(currentContracts) || currentContracts < 0) return maxCap;
  if (!Number.isFinite(maxCap) || maxCap <= 0) return 0;
  return Math.max(0, maxCap - currentContracts);
}

/**
 * Clamp a desired new entry's contracts to the available headroom.
 * Returns 0 when the headroom is exhausted (caller should suppress
 * the entry rather than place a 0-contract order).
 */
export function clampNewContractsToCap(
  desiredContracts: number,
  currentContracts: number,
  maxCap: number,
): number {
  if (!Number.isFinite(desiredContracts) || desiredContracts <= 0) return 0;
  const headroom = headroomContracts(currentContracts, maxCap);
  return Math.min(desiredContracts, headroom);
}
