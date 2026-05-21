/**
 * Resolve a Poloniex v3 futures position's side (long/short).
 *
 * HEDGE accounts: `qty` is a POSITIVE magnitude and the real side lives
 * in `posSide` (LONG/SHORT). ONE_WAY accounts: `posSide` is absent or
 * `BOTH` and `qty` is signed.
 *
 * Pure qty-sign detection (`qty < 0 ? short : long`) silently misreads
 * every HEDGE short as a long — production runs HEDGE
 * (`MONKEY_SHORTS_LIVE=true`). This is the bug class behind #676/#677/
 * #679 and the 2026-05-14 kernel-paralysis incident: after a position
 * was reversed long→short on the exchange, `loop.ts` `fetchAccountContext`
 * read the HEDGE short's positive qty as `long`, so the kernel logged
 * `held long` while it wanted `short` and could neither DCA nor manage
 * the position.
 *
 * Canonical resolution everywhere: posSide first, `Math.sign(qty)`
 * fallback for ONE_WAY. Mirrors `stateReconciliationService`'s
 * `resolveExchangeSide` — this is the shared source of truth so the
 * pattern can't drift again.
 */
export function resolveExchangePositionSide(
  pos: Record<string, unknown>,
): 'long' | 'short' {
  const posSide = String(pos.posSide ?? '').toUpperCase();
  const qtyNum = parseFloat(
    String(pos.qty ?? pos.availQty ?? pos.size ?? '0'),
  );
  return posSide === 'SHORT' || (posSide !== 'LONG' && qtyNum < 0)
    ? 'short'
    : 'long';
}

/**
 * Resolve a Poloniex v3 futures position's USD notional.
 *
 * v3 `/trade/position/opens` has NO `notional` or `size` field — it
 * reports `qty` (contract count), `im` (initial margin) and `lever`.
 * notional = im × lever. The old `Number(p.notional ?? p.size ?? 0)`
 * read both-undefined → 0, silently zeroing `checkPerSymbolExposure`'s
 * existing-exposure sum: the per-symbol cap saw only the NEW order,
 * never the open stack, so positions stacked unbounded — the BTC short
 * bloated to ~$7k (≈5× equity) over 2026-05-07..14 via hundreds of
 * small entries the cap never summed. Same un-normalized-v3-response
 * bug class as resolveExchangePositionSide; kept in the same file so
 * the pair stays the shared source of truth.
 *
 * Pure function. Returns 0 only when the margin/leverage fields are
 * both absent (malformed response) — callers treat 0 as "unknown".
 */
export function resolveExchangePositionNotional(
  pos: Record<string, unknown>,
): number {
  // Honour a direct notional/value field if a caller ever passes an
  // already-normalized position shape (v3 itself emits none of these).
  // Signed values (ONE_WAY-style) are accepted — magnitude is what the
  // exposure cap sums.
  const direct = Number(pos.notional ?? pos.value ?? pos.posValue ?? NaN);
  if (Number.isFinite(direct) && direct !== 0) return Math.abs(direct);

  const margin = Number(
    pos.im ?? pos.initialMargin ?? pos.mgn ?? pos.margin ?? NaN,
  );
  const lever = Number(pos.lever ?? pos.leverage ?? NaN);
  if (
    Number.isFinite(margin) && Number.isFinite(lever) &&
    margin > 0 && lever > 0
  ) {
    return margin * lever;
  }
  return 0;
}
