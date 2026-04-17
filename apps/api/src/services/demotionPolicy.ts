/**
 * Demotion + oscillation policy.
 *
 * Handles the reverse direction of the pipeline. A strategy that stops
 * performing reverts to prior stages with `status='recalibrating'`
 * rather than being killed, preserving its genome so the bandit can
 * re-evaluate it under different conditions.
 *
 * Two independent guards:
 *
 *   1. Rolling-20-trade drawdown. If realised P&L as a fraction of the
 *      cumulative margin committed across the last 20 trades hits
 *      −10%, demote to the prior stage.
 *
 *   2. Oscillation guard. If cumulative realised P&L over the last 3
 *      promotion cycles is net-negative, retire permanently. Prevents
 *      paper↔live oscillators that burn slot capacity forever without
 *      delivering P&L.
 *
 * Pure functions. No DB, no IO.
 */

export interface TradeOutcome {
  realisedPnl: number;   // signed; negative = loss
  marginCommitted: number; // always positive
}

export interface PromotionCycle {
  realisedPnl: number;   // cumulative P&L earned during one paper/live stint
}

export interface DemotionDecision {
  demote: boolean;
  reason?: string;
  triggeringDrawdownPct?: number;
}

export interface RetirementDecision {
  retire: boolean;
  reason?: string;
}

// ───────── Thresholds ─────────
export const ROLLING_DEMOTION_WINDOW = 20;
export const ROLLING_DEMOTION_THRESHOLD = -0.10;  // −10% of margin committed
export const RECALIBRATION_LIMIT_PER_30_DAYS = 3;
export const OSCILLATION_PROMOTION_CYCLES = 3;

/**
 * Evaluate demotion based on realised P&L across the rolling
 * ROLLING_DEMOTION_WINDOW most recent trades. Ratio is
 *    sum(realisedPnl) / sum(marginCommitted)
 * so small-margin losses don't trigger demotion the same as
 * large-margin ones.
 *
 * Returns demote=false if the window hasn't accumulated enough trades
 * yet — this prevents a cold-start strategy from getting demoted on
 * its first loss.
 */
export function evaluateRollingDrawdownDemotion(
  recentTrades: TradeOutcome[],
): DemotionDecision {
  if (recentTrades.length < ROLLING_DEMOTION_WINDOW) {
    return { demote: false };
  }
  const window = recentTrades.slice(-ROLLING_DEMOTION_WINDOW);
  const pnl = window.reduce((sum, t) => sum + t.realisedPnl, 0);
  const margin = window.reduce((sum, t) => sum + Math.abs(t.marginCommitted), 0);
  if (margin <= 0) return { demote: false };
  const ratio = pnl / margin;
  if (ratio <= ROLLING_DEMOTION_THRESHOLD) {
    return {
      demote: true,
      triggeringDrawdownPct: ratio,
      reason: `rolling_${ROLLING_DEMOTION_WINDOW}_trade_drawdown_${(ratio * 100).toFixed(2)}pct`,
    };
  }
  return { demote: false };
}

/**
 * Decide whether a strategy should be permanently retired based on its
 * recent promotion cycles. If the strategy has completed at least
 * OSCILLATION_PROMOTION_CYCLES and the sum of their realised P&L is
 * ≤ 0, we retire — the strategy is oscillating without delivering
 * value.
 */
export function evaluateOscillationRetirement(
  recentCycles: PromotionCycle[],
): RetirementDecision {
  if (recentCycles.length < OSCILLATION_PROMOTION_CYCLES) {
    return { retire: false };
  }
  const window = recentCycles.slice(-OSCILLATION_PROMOTION_CYCLES);
  const total = window.reduce((sum, c) => sum + c.realisedPnl, 0);
  if (total <= 0) {
    return {
      retire: true,
      reason: `lifetime_pnl_floor: last_${OSCILLATION_PROMOTION_CYCLES}_cycles_sum_${total.toFixed(2)}_leq_0`,
    };
  }
  return { retire: false };
}

/**
 * Decide whether to retire based on the 3-recalibrations-in-30-days
 * rule. Counts demotion events that occurred in the trailing 30 days;
 * if the count exceeds RECALIBRATION_LIMIT_PER_30_DAYS, the strategy
 * is too flaky to keep cycling and should be retired.
 */
export function evaluateRecalibrationLimitRetirement(
  recentDemotionTimestamps: Date[],
  now: Date = new Date(),
): RetirementDecision {
  const cutoffMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const recent = recentDemotionTimestamps.filter((d) => d.getTime() >= cutoffMs);
  if (recent.length > RECALIBRATION_LIMIT_PER_30_DAYS) {
    return {
      retire: true,
      reason: `recalibration_limit: ${recent.length}_demotions_in_last_30_days_exceeds_${RECALIBRATION_LIMIT_PER_30_DAYS}`,
    };
  }
  return { retire: false };
}
