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
 * and `liveSignalEngine` both read the HEDGE short's positive qty as
 * `long`, so the kernel logged `held long` while it wanted `short` and
 * could neither DCA nor manage the position.
 *
 * Canonical resolution everywhere: posSide first, `Math.sign(qty)`
 * fallback for ONE_WAY. Mirrors `stateReconciliationService`'s
 * `resolveExchangeSide` and `fullyAutonomousTrader`'s side resolution —
 * this is the shared source of truth so the pattern can't drift again.
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
