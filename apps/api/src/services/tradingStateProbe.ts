/**
 * Trading-state probe — computes whether we should expect trades to be
 * happening right now, so the trades-per-hour floor alert only fires
 * when silence is genuinely unexpected.
 *
 * Decision rule (Option C from the design doc — user-picked on
 * 2026-04-18 after production alert review):
 *
 *   expect_trading = TRUE if EITHER
 *     (A) at least one strategy is in 'paper_trading' | 'recommended' | 'live', OR
 *     (B) the most recent paper-promotion (`promoted_paper_at`) is
 *         within the last 24h — strategies have recently been earning
 *         their way forward, even if none are active at this instant.
 *
 * This silences the two false-positive modes we saw in production
 * (alertCount:41 on a $27 account with no passing strategies) while
 * keeping the alert loud if a pipeline that USED TO work has stopped.
 *
 * The complementary "generator is broken" failure mode (no strategy
 * ever passes backtest) is intentionally NOT caught here — that's the
 * job of a separate backtest-pass-rate metric and threshold.
 */

import { query } from '../db/connection.js';
import { logger } from '../utils/logger.js';

export const TRADING_STATE_RECENT_PASS_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Called every 60s by the probe tick. Split into two narrow queries so
 * the expensive half (MAX(promoted_paper_at) over all rows) only runs
 * in the uncommon "no active strategy" branch. Both queries hit
 * partial indexes from migrations 027 and 028.
 *
 * Fails soft: returns false on any error so a DB hiccup doesn't
 * trigger a spurious alert cascade.
 */
export async function shouldExpectPaperTrades(
  now: Date = new Date(),
): Promise<boolean> {
  try {
    // Query A: uses idx_strategy_performance_status_tier (partial,
    // WHERE deleted_at IS NULL). Returns fast — in the steady state
    // this is the only query that runs.
    const activeResult = await query(
      `SELECT COUNT(*)::int AS n
         FROM strategy_performance
        WHERE deleted_at IS NULL
          AND status IN ('paper_trading', 'recommended', 'live')`,
    );
    const activeCount = Number((activeResult.rows as any[])[0]?.n ?? 0);
    if (activeCount > 0) return true;

    // Query B: uses idx_strategy_performance_promoted_paper_at
    // (migration 028, partial WHERE promoted_paper_at IS NOT NULL).
    // Only runs when zero strategies are currently paper/live.
    const promoResult = await query(
      `SELECT MAX(promoted_paper_at) AS last_paper_promo
         FROM strategy_performance
        WHERE deleted_at IS NULL
          AND promoted_paper_at IS NOT NULL`,
    );
    const rawPromo = (promoResult.rows as any[])[0]?.last_paper_promo;
    if (!rawPromo) return false;
    const lastPromo = new Date(rawPromo as string);
    return now.getTime() - lastPromo.getTime() < TRADING_STATE_RECENT_PASS_WINDOW_MS;
  } catch (err) {
    logger.debug('[tradingStateProbe] shouldExpectPaperTrades failed (fail-soft)', {
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
