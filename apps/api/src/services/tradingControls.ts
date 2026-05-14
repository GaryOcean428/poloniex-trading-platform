/**
 * tradingControls.ts — process-wide trading kill switch.
 *
 * Canonical home for `isTradingPaused()`. Honoured by every engine that
 * can OPEN a position: the Monkey kernel loop, LiveSignal, and FAT.
 * Exit / close orders are never gated — open positions must always be
 * able to close cleanly during an incident or a deploy.
 *
 * Either env var set to 'true' pauses entries:
 *   TRADING_PAUSED        — canonical, engine-agnostic
 *   MONKEY_TRADING_PAUSED — back-compat. Before 2026-05-14 the kill
 *                           switch was Monkey-only; LiveSignal and FAT
 *                           silently ignored it. Kept so existing
 *                           operator runbooks / Railway vars still work,
 *                           but it now pauses ALL entry engines.
 *
 * Read live at order-placement time (not cached at startup) so the
 * operator can flip the Railway var without a redeploy.
 */
export function isTradingPaused(): boolean {
  return (
    process.env.TRADING_PAUSED === 'true' ||
    process.env.MONKEY_TRADING_PAUSED === 'true'
  );
}
