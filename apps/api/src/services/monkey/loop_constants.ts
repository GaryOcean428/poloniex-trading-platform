/**
 * loop_constants.ts — module-level constants + kill-switch for the
 * Monkey kernel loop. Extracted from loop.ts (2026-05-14 modularization)
 * with no behavioural change — these are the exact same values, just
 * in their own file so loop.ts is the orchestration spine only.
 */

/** Default Monkey watchlist — matches liveSignalEngine for side-by-side. */
export const DEFAULT_SYMBOLS = ['BTC_USDT_PERP', 'ETH_USDT_PERP'];

// v0.4: faster tick so scalp TP/SL exits catch sub-minute wiggles.
// Full perception runs per tick; DB + compute cost is modest.
export const DEFAULT_TICK_MS = Number(process.env.MONKEY_TICK_MS) || 30_000;

/** OHLCV window ml-worker also uses. */
export const OHLCV_LOOKBACK = 200;

/** Running history for Loop 1 self-observation + f_health trend. */
export const HISTORY_MAX = 100;

/** Half-life for reward decay (ms). Rewards older than ~3 × this are ≈ 0. */
export const REWARD_HALF_LIFE_MS = 20 * 60_000;  // 20 min

/** Max rewards retained; FIFO eviction. */
export const REWARD_QUEUE_MAX = 50;

/**
 * v0.8.7 regime-hysteresis — minimum number of consecutive ticks where
 * regimeNow != regimeAtOpen before the regime_change exit can fire. The
 * Python kernel reads this from the parameter registry as
 * ``executive.regime_stability_ticks_for_exit``; TS has no parameter
 * registry yet, so the constant is the default. Default 3: a flicker
 * (1-2 tick mode divergence) cannot trigger the exit alone — the
 * kernel must read the new regime stably for at least 3 ticks AND the
 * basin must have moved more than 1/π in Fisher-Rao distance from the
 * entry anchor.
 */
export const REGIME_STABILITY_TICKS_FOR_EXIT =
  Number(process.env.MONKEY_REGIME_STABILITY_TICKS_FOR_EXIT) || 3;

/** Cap the recent-bus-event ring at this size — anything older than
 *  the bus window doesn't influence current decisions. */
export const BUS_RING_CAP = 32;

/**
 * v0.8.7 kill switch — when MONKEY_TRADING_PAUSED=true, gate
 * entry-order placement only. Exit orders (scalp_exit, auto_flatten,
 * hard SL, rejust exits) are NOT gated; existing positions must close
 * cleanly during deploy/incident response. Default false (no pause).
 *
 * Reads at order-placement time (live, not cached at startup) so the
 * operator can flip the env var on Railway without redeploying.
 */
export function isTradingPaused(): boolean {
  return process.env.MONKEY_TRADING_PAUSED === 'true';
}
