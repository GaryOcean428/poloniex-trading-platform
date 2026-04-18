/**
 * Promotion gates for the SLE pipeline.
 *
 * Pure functions (no DB, no IO) that decide whether a strategy should
 * advance through the generated → backtest → paper → live pipeline
 * and, once live, what position size tier applies.
 *
 * Why multi-metric?
 *   The red team's statistician found Sharpe ≥ 1 alone is statistically
 *   indistinguishable from noise at the scale of strategies this SLE
 *   tests in parallel. We stack Sharpe + Sortino + Calmar + Profit
 *   Factor + Max Drawdown so a strategy has to look good across
 *   dependency-varied metrics, not just one.
 *
 * Why OOS?
 *   Without an untouched out-of-sample window, the bandit overfits to
 *   recent noise. A 30% OOS holdout that the generator cannot tune on
 *   is the cheapest defence against survivorship bias across thousands
 *   of strategies.
 */

export interface BacktestMetrics {
  totalTrades: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  profitFactor: number;
  maxDrawdown: number;           // positive fraction, e.g. 0.12 = 12%
}

export interface PaperStats {
  totalTrades: number;
  cumulativePnl: number;
  largestSingleLossPct: number;  // positive fraction (loss magnitude / margin)
  rolling20TradeMaxDrawdown: number; // positive fraction
  profitablePaperTrades: number;
}

export interface LiveStats {
  profitableLiveTrades: number;
}

export interface GateDecision {
  allowed: boolean;
  reason?: string;
  failingMetrics?: string[];
}

// ───────── Backtest → Paper thresholds ─────────
// Tuned for 15m-bar scalps on 30-90 day windows where "reliably prove"
// (user's phrase) means enough trades to be not-random but not so many
// that the first pass is blocked for weeks. Production evidence from
// the hard-cut deploy showed the generated signal genomes fire once
// per ~2000-6000 candles on real 5m data — 30-trade minimum was
// effectively unreachable until the genome layer evolves. Relaxed to
// 10 trades + multi-metric cross-check to unblock first passes; the
// Sharpe/Sortino/Calmar/PF stack still rejects noise.
export const BACKTEST_MIN_TRADES = 10;
export const BACKTEST_MIN_SHARPE = 0.8;
export const BACKTEST_MIN_SORTINO = 1.2;
export const BACKTEST_MIN_CALMAR = 1.5;
export const BACKTEST_MIN_PROFIT_FACTOR = 1.3;
export const BACKTEST_MAX_DRAWDOWN = 0.20;      // aligned with aggressive-mode 20% DD ceiling
export const OOS_MIN_PROFIT_FACTOR = 1.0;       // OOS must break even (PF >= 1.0); IS carries the edge proof

// ───────── Paper → Live thresholds ─────────
export const PAPER_MIN_TRADES = 10;
export const PAPER_MAX_SINGLE_LOSS = 0.05;      // 5% of margin
export const PAPER_MAX_ROLLING_DD = 0.10;       // 10%

// ───────── Live sizing ladder ($2 → $3 → $5 → $8 → $12) ─────────
// Each tier unlocks after +10 profitable live trades over the previous.
export const LIVE_SIZING_USDT: Record<number, number> = {
  0: 0,    // paper / recalibrating, no live size
  1: 2,
  2: 3,
  3: 5,
  4: 8,
  5: 12,
};
export const TRADES_PER_TIER = 10;

export function computeLiveSizingTier(live: LiveStats): number {
  const steps = Math.floor(live.profitableLiveTrades / TRADES_PER_TIER);
  // Tier 1 is unlocked immediately on promotion; additional tiers
  // accumulate with profitable trades. Cap at 5.
  return Math.min(5, 1 + steps);
}

export function getLiveSizeForTier(tier: number): number {
  return LIVE_SIZING_USDT[tier] ?? 0;
}

// ───────── Gate evaluators ─────────

export function evaluateBacktestGate(
  inSample: BacktestMetrics,
  outOfSample: Pick<BacktestMetrics, 'profitFactor'> | null,
): GateDecision {
  const failing: string[] = [];
  if (inSample.totalTrades < BACKTEST_MIN_TRADES) {
    failing.push(`totalTrades ${inSample.totalTrades} < ${BACKTEST_MIN_TRADES}`);
  }
  if (inSample.sharpe < BACKTEST_MIN_SHARPE) {
    failing.push(`sharpe ${inSample.sharpe.toFixed(2)} < ${BACKTEST_MIN_SHARPE}`);
  }
  if (inSample.sortino < BACKTEST_MIN_SORTINO) {
    failing.push(`sortino ${inSample.sortino.toFixed(2)} < ${BACKTEST_MIN_SORTINO}`);
  }
  if (inSample.calmar < BACKTEST_MIN_CALMAR) {
    failing.push(`calmar ${inSample.calmar.toFixed(2)} < ${BACKTEST_MIN_CALMAR}`);
  }
  if (inSample.profitFactor < BACKTEST_MIN_PROFIT_FACTOR) {
    failing.push(
      `profitFactor ${inSample.profitFactor.toFixed(2)} < ${BACKTEST_MIN_PROFIT_FACTOR}`,
    );
  }
  if (inSample.maxDrawdown > BACKTEST_MAX_DRAWDOWN) {
    failing.push(
      `maxDrawdown ${(inSample.maxDrawdown * 100).toFixed(1)}% > ${(BACKTEST_MAX_DRAWDOWN * 100).toFixed(0)}%`,
    );
  }

  if (!outOfSample) {
    failing.push('oosMetrics missing — promotion requires 30% OOS holdout');
  } else if (outOfSample.profitFactor < OOS_MIN_PROFIT_FACTOR) {
    failing.push(
      `oos.profitFactor ${outOfSample.profitFactor.toFixed(2)} < ${OOS_MIN_PROFIT_FACTOR}`,
    );
  }

  if (failing.length > 0) {
    return {
      allowed: false,
      reason: `backtest_gate_failed: ${failing.join('; ')}`,
      failingMetrics: failing,
    };
  }
  return { allowed: true };
}

export function evaluatePaperGate(paper: PaperStats): GateDecision {
  const failing: string[] = [];
  if (paper.totalTrades < PAPER_MIN_TRADES) {
    failing.push(`paperTrades ${paper.totalTrades} < ${PAPER_MIN_TRADES}`);
  }
  if (paper.cumulativePnl <= 0) {
    failing.push(`cumulativePnl ${paper.cumulativePnl.toFixed(2)} not positive`);
  }
  if (paper.largestSingleLossPct > PAPER_MAX_SINGLE_LOSS) {
    failing.push(
      `largestSingleLoss ${(paper.largestSingleLossPct * 100).toFixed(1)}% > ${(PAPER_MAX_SINGLE_LOSS * 100).toFixed(0)}%`,
    );
  }
  if (paper.rolling20TradeMaxDrawdown > PAPER_MAX_ROLLING_DD) {
    failing.push(
      `rolling20DD ${(paper.rolling20TradeMaxDrawdown * 100).toFixed(1)}% > ${(PAPER_MAX_ROLLING_DD * 100).toFixed(0)}%`,
    );
  }

  if (failing.length > 0) {
    return {
      allowed: false,
      reason: `paper_gate_failed: ${failing.join('; ')}`,
      failingMetrics: failing,
    };
  }
  return { allowed: true };
}
