/**
 * Anchor strategies — hand-crafted SignalGenome seeds.
 *
 * Production evidence after the hard-cut pipeline came online showed
 * the random-genome generator produces strategies that trade like
 * coin flips (sharpe ≈ 0). The Thompson bandit can't bias toward
 * winners because there are no winners to learn from — a classic
 * cold-start problem for a random-search system.
 *
 * Anchors solve the cold-start by seeding the bandit with known
 * classical patterns. They go through the same multi-metric
 * promotion gate as everything else; anchors that pass on current
 * data proceed to paper → live like any other strategy. Anchors
 * that fail get retired same as a generated variant.
 *
 * The role of an anchor is NOT to be the final live strategy —
 * it's to give the bandit and the genome-mutator a real winning
 * distribution to warp toward.
 *
 * Every anchor is a pair (long + short conditions) because user
 * requirement: "check that it is trading on a sell ... the system
 * needs to account for making money that way too."
 */

import type {
  SignalCondition,
  SignalGenome,
} from './signalGenome.js';
import type { MarketRegime, StrategyType } from './strategyLearningEngine.js';

export interface AnchorStrategyDef {
  /** Stable ID — prefix 'anchor_' keeps them identifiable in strategy_performance. */
  id: string;
  /** Human-readable description for logs / observability. */
  name: string;
  /** Classical pattern family — maps to existing StrategyType union. */
  strategyType: StrategyType;
  /** Symbol the anchor was tuned for. */
  symbol: string;
  /** Timeframe the anchor was tuned for. */
  timeframe: string;
  /** Leverage the anchor requests (kernel still caps at per-symbol exchange max). */
  leverage: number;
  /** Hand-tuned genome — not evolved. */
  genome: SignalGenome;
  /** Regime where this anchor expects to perform best. */
  regimeAffinity: MarketRegime;
}

// ───────── Anchor 1: Trend-pullback scalper ─────────
// Long: uptrend (ema20 > ema50) + RSI pullback (<45) → enter on bounce.
// Short: downtrend + RSI retrace (>55) → enter on failed rally.
// Classical pattern that fires multiple times per week in trending regimes.
const TREND_PULLBACK_ENTRY: SignalCondition[] = [
  // LONG side — uptrend pullback
  { indicator: 'ema_cross_9_20', comparator: '>', threshold: 0, side: 'long' },
  { indicator: 'sma_cross_20_50', comparator: '>', threshold: 0, side: 'long' },
  { indicator: 'rsi', comparator: '<', threshold: 45, side: 'long' },
  // SHORT side — downtrend rally
  { indicator: 'ema_cross_9_20', comparator: '<', threshold: 0, side: 'short' },
  { indicator: 'sma_cross_20_50', comparator: '<', threshold: 0, side: 'short' },
  { indicator: 'rsi', comparator: '>', threshold: 55, side: 'short' },
];

const TREND_PULLBACK_EXIT: SignalCondition[] = [
  // Long exits when trend flips or RSI gets overbought
  { indicator: 'ema_cross_9_20', comparator: '<', threshold: 0, side: 'long' },
  { indicator: 'rsi', comparator: '>', threshold: 70, side: 'long' },
  // Short exits when trend flips or RSI gets oversold
  { indicator: 'ema_cross_9_20', comparator: '>', threshold: 0, side: 'short' },
  { indicator: 'rsi', comparator: '<', threshold: 30, side: 'short' },
];

// ───────── Anchor 2: Bollinger mean-reversion ─────────
// Long: price near lower band (bb_position < 0.1) + RSI oversold.
// Short: price near upper band (bb_position > 0.9) + RSI overbought.
// Fires on extreme moves, catches snapback bounces. Works in ranging regimes.
const MEAN_REV_ENTRY: SignalCondition[] = [
  { indicator: 'bb_position', comparator: '<', threshold: 0.15, side: 'long' },
  { indicator: 'rsi', comparator: '<', threshold: 32, side: 'long' },
  { indicator: 'bb_position', comparator: '>', threshold: 0.85, side: 'short' },
  { indicator: 'rsi', comparator: '>', threshold: 68, side: 'short' },
];

const MEAN_REV_EXIT: SignalCondition[] = [
  // Exit at the BB mid (bb_position ≈ 0.5)
  { indicator: 'bb_position', comparator: '>', threshold: 0.5, side: 'long' },
  { indicator: 'bb_position', comparator: '<', threshold: 0.5, side: 'short' },
];

// ───────── Anchor 3: MACD momentum ─────────
// Long: MACD histogram crosses above 0 within an uptrending SMA structure.
// Short: MACD histogram crosses below 0 in a downtrending structure.
// Fires at momentum inflections; catches early breakouts.
const MACD_MOMENTUM_ENTRY: SignalCondition[] = [
  { indicator: 'macd_histogram', comparator: 'crosses_above', threshold: 0, side: 'long' },
  { indicator: 'sma_cross_20_50', comparator: '>', threshold: 0, side: 'long' },
  { indicator: 'macd_histogram', comparator: 'crosses_below', threshold: 0, side: 'short' },
  { indicator: 'sma_cross_20_50', comparator: '<', threshold: 0, side: 'short' },
];

const MACD_MOMENTUM_EXIT: SignalCondition[] = [
  { indicator: 'macd_histogram', comparator: 'crosses_below', threshold: 0, side: 'long' },
  { indicator: 'macd_histogram', comparator: 'crosses_above', threshold: 0, side: 'short' },
];

export const ANCHOR_STRATEGIES: AnchorStrategyDef[] = [
  {
    id: 'anchor_trend_pullback_btc_15m',
    name: 'Trend-pullback scalper (BTC 15m)',
    strategyType: 'trend_following',
    symbol: 'BTC_USDT_PERP',
    timeframe: '15m',
    leverage: 3,
    regimeAffinity: 'trending',
    genome: {
      entryConditions: TREND_PULLBACK_ENTRY,
      exitConditions: TREND_PULLBACK_EXIT,
      stopLossPercent: 0.015,      // 1.5% — tight on a scalp
      takeProfitPercent: 0.030,    // 3% — 2:1 reward-to-risk
      positionSizeFraction: 0.05,  // 5% of allocated capital
    },
  },
  {
    id: 'anchor_mean_rev_eth_15m',
    name: 'Bollinger mean-reversion (ETH 15m)',
    strategyType: 'mean_reversion',
    symbol: 'ETH_USDT_PERP',
    timeframe: '15m',
    leverage: 3,
    regimeAffinity: 'ranging',
    genome: {
      entryConditions: MEAN_REV_ENTRY,
      exitConditions: MEAN_REV_EXIT,
      stopLossPercent: 0.010,      // 1% — mean-reverts should bounce fast
      takeProfitPercent: 0.020,    // 2% — 2:1
      positionSizeFraction: 0.05,
    },
  },
  {
    id: 'anchor_macd_momentum_btc_1h',
    name: 'MACD momentum (BTC 1h)',
    strategyType: 'momentum',
    symbol: 'BTC_USDT_PERP',
    timeframe: '1h',
    leverage: 3,
    regimeAffinity: 'trending',
    genome: {
      entryConditions: MACD_MOMENTUM_ENTRY,
      exitConditions: MACD_MOMENTUM_EXIT,
      stopLossPercent: 0.020,      // 2% — 1h bars are wider
      takeProfitPercent: 0.040,    // 4% — 2:1
      positionSizeFraction: 0.05,
    },
  },
];

/**
 * Return anchor strategies whose regime-affinity matches the current
 * regime. Anchors tuned for other regimes are skipped so we don't
 * pollute the gate with strategies that aren't expected to work right
 * now. All three regimes see at least one anchor.
 */
export function getAnchorsForRegime(regime: MarketRegime): AnchorStrategyDef[] {
  // 'unknown' regime gets all anchors — we don't know what's working
  // yet, so let the gate decide.
  if (regime === 'unknown') return [...ANCHOR_STRATEGIES];
  return ANCHOR_STRATEGIES.filter(
    (a) => a.regimeAffinity === regime || a.regimeAffinity === 'unknown',
  );
}
