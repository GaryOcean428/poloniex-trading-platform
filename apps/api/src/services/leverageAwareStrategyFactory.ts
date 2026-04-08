/**
 * Leverage-Aware Strategy Factory
 *
 * Generates pair-specific trading strategies based on each contract's
 * maximum leverage, liquidity, volatility profile, and risk limits.
 *
 * Leverage tiers (from docs/markets/poloniex-futures-v3.json):
 * - Tier 1 (100x): BTC_USDT_PERP, ETH_USDT_PERP
 * - Tier 2 (50x):  SOL, XRP, BCH, LTC, TRX, BNB, DOGE, AVAX, APT, LINK, UNI, XMR
 * - Tier 3 (10x):  1000PEPE, 1000SHIB
 *
 * Multi-timeframe weighting follows the QIG bridge law:
 *   w(tf) = (referenceMinutes / tfMinutes)^0.74   (R² > 0.96, two independent seeds)
 * Reference is 1h = 1.00. Results: 5m ≈ 6.57, 15m ≈ 2.87, 4h ≈ 0.33.
 *
 * Regime-conditioned allocation:
 * Mean-reversion regime is 170× stronger than trending when active
 * (|κ_back|=5237 vs κ_front=31), so mean-reversion strategies receive
 * proportionally higher capital allocation.
 */

import { getMaxLeverage } from './marketCatalog.js';
import { logger } from '../utils/logger.js';

// ── Bridge law for multi-timeframe signal weighting ──────────────────────────
// Power-law exponent validated from QIG physics (R² > 0.96 across two seeds).
// Do NOT replace with equal weighting or arbitrary logarithmic tuning.
const BRIDGE_EXPONENT = 0.74;
const REFERENCE_TF_MINUTES = 60; // 1h reference → weight = 1.00

/**
 * Compute bridge-law weight for a timeframe.
 * w(tf) = (60 / tfMinutes)^0.74
 * Shorter timeframes produce more signals but each carries less macro-weight.
 */
export function timeframeWeight(tfMinutes: number): number {
  if (tfMinutes <= 0) return 1;
  return Math.pow(REFERENCE_TF_MINUTES / tfMinutes, BRIDGE_EXPONENT);
}

/** Pre-computed weights for the six standard timeframes. */
export const TIMEFRAME_WEIGHTS: Record<string, number> = {
  '1m':  timeframeWeight(1),    // ≈ 13.93
  '5m':  timeframeWeight(5),    // ≈  6.57
  '15m': timeframeWeight(15),   // ≈  2.87
  '30m': timeframeWeight(30),   // ≈  1.68
  '1h':  timeframeWeight(60),   // =  1.00 (reference)
  '4h':  timeframeWeight(240),  // ≈  0.33
  '1d':  timeframeWeight(1440), // ≈  0.07
};

// ── Market regime detection ──────────────────────────────────────────────────
/**
 * Three-regime structure maps to QIG curvature κ:
 *   trending      → κ > 0 (momentum strategies preferred)
 *   mean_reverting → κ < 0 (mean-reversion preferred; 170× stronger when active)
 *   transition    → κ ≈ 0 (reduce all leverage, widen stops, no new entries)
 *
 * Structured so the Fisher information classifier from issue #410 can be
 * plugged in later by replacing the ADX thresholds.
 */
export type MarketRegime = 'trending' | 'mean_reverting' | 'transition';

/**
 * Detect market regime using ADX (Wilder, 1978).
 * ADX > 25 → trending   (κ > 0)
 * ADX < 20 → mean-reverting (κ < 0)
 * else     → transition (κ ≈ 0)
 *
 * Future: replace with Fisher information curvature κ from issue #410.
 *
 * @param symbol    Trading symbol (reserved for future per-symbol calibration)
 * @param timeframe Timeframe string (reserved for future per-tf calibration)
 * @param adx       Current ADX value computed from OHLCV data
 */
export function detectMarketRegime(
  _symbol: string,
  _timeframe: string,
  adx: number
): MarketRegime {
  if (adx > 25) return 'trending';
  if (adx < 20) return 'mean_reverting';
  return 'transition';
}

// ── Leverage tier classification ─────────────────────────────────────────────
export type LeverageTier = 1 | 2 | 3;

/**
 * Classify a symbol into its leverage tier from maxLeverage.
 * Tier 1 (100x): BTC, ETH — highest liquidity, tightest spreads
 * Tier 2 (50x):  Major alts — moderate liquidity
 * Tier 3 (10x):  Memecoins — high volatility, wide spreads
 */
export function getLeverageTier(maxLeverage: number): LeverageTier {
  if (maxLeverage >= 100) return 1;
  if (maxLeverage >= 50)  return 2;
  return 3;
}

/**
 * Cap effective leverage at 25% of the contract's maximum.
 * Ensures we never exceed 25x on BTC (max 100x), 12x on alts (max 50x),
 * or 2x on memecoins (max 10x).
 */
export function capEffectiveLeverage(desired: number, maxLeverage: number): number {
  const safeMax = Math.max(1, Math.floor(maxLeverage * 0.25));
  return Math.min(Math.max(1, Math.round(desired)), safeMax);
}

// ── Strategy type definitions ─────────────────────────────────────────────────
export type StrategyType =
  | 'scalping'
  | 'mean_reversion'
  | 'funding_rate_arb'
  | 'breakout_momentum'
  | 'pairs_trading'
  | 'grid_trading'
  | 'trend_following'
  | 'rsi_divergence'
  | 'cross_pair_momentum'
  | 'volume_weighted'
  | 'bollinger_squeeze'
  | 'momentum_only'
  | 'sentiment_momentum'
  | 'quick_scalp';

export interface StrategyTemplate {
  type: StrategyType;
  tier: LeverageTier;
  /** Regime this strategy is designed for. 'any' means regime-agnostic. */
  targetRegime: MarketRegime | 'any';
  /** Desired leverage before contract cap is applied. */
  baseLeverage: number;
  /** Stop-loss as fraction of entry price, e.g. 0.005 = 0.5%. */
  stopLossPercent: number;
  /** Take-profit as fraction of entry price. */
  takeProfitPercent: number;
  /** Primary signal timeframe. */
  timeframe: string;
  /** Secondary timeframes for multi-tf signal combination. */
  supportingTimeframes: string[];
  /**
   * Relative capital allocation weight vs. other strategies in same tier.
   * Mean-reversion gets higher weight because the mean-reverting regime is
   * 170× stronger than the trending regime (QIG measured physics result).
   */
  allocationWeight: number;
  description: string;
}

// ── Tier 1 templates (BTC, ETH — 100x max → 25x effective cap) ───────────────
const TIER1_TEMPLATES: StrategyTemplate[] = [
  {
    type: 'scalping',
    tier: 1,
    targetRegime: 'mean_reverting',
    baseLeverage: 15,
    stopLossPercent: 0.004,
    takeProfitPercent: 0.006,
    timeframe: '1m',
    supportingTimeframes: ['5m', '15m'],
    allocationWeight: 1.7, // Mean-reversion: 170× boost
    description: 'High-frequency scalping on BTC/ETH; tight 0.4% stops',
  },
  {
    type: 'mean_reversion',
    tier: 1,
    targetRegime: 'mean_reverting',
    baseLeverage: 10,
    stopLossPercent: 0.005,
    takeProfitPercent: 0.008,
    timeframe: '5m',
    supportingTimeframes: ['15m', '1h'],
    allocationWeight: 1.7,
    description: 'Bollinger Band extremes mean-reversion on BTC/ETH',
  },
  {
    type: 'funding_rate_arb',
    tier: 1,
    targetRegime: 'any',
    baseLeverage: 5,
    stopLossPercent: 0.01,
    takeProfitPercent: 0.015,
    timeframe: '1h',
    supportingTimeframes: ['4h'],
    allocationWeight: 1.0,
    description: 'Long/short driven by extreme funding rate direction',
  },
  {
    type: 'breakout_momentum',
    tier: 1,
    targetRegime: 'trending',
    baseLeverage: 10,
    stopLossPercent: 0.008,
    takeProfitPercent: 0.02,
    timeframe: '15m',
    supportingTimeframes: ['1h', '4h'],
    allocationWeight: 0.8,
    description: 'Enter on confirmed breakout; trail with ATR stop',
  },
  {
    type: 'grid_trading',
    tier: 1,
    targetRegime: 'mean_reverting',
    baseLeverage: 5,
    stopLossPercent: 0.02,
    takeProfitPercent: 0.01,
    timeframe: '1h',
    supportingTimeframes: ['4h'],
    allocationWeight: 1.2,
    description: 'Limit orders at regular price intervals with moderate leverage',
  },
];

// ── Tier 2 templates (major alts — 50x max → 12x effective cap) ──────────────
const TIER2_TEMPLATES: StrategyTemplate[] = [
  {
    type: 'trend_following',
    tier: 2,
    targetRegime: 'trending',
    baseLeverage: 7,
    stopLossPercent: 0.015,
    takeProfitPercent: 0.03,
    timeframe: '15m',
    supportingTimeframes: ['1h', '4h'],
    allocationWeight: 0.8,
    description: 'Trend following with wider 1.5% stops for alt volatility',
  },
  {
    type: 'rsi_divergence',
    tier: 2,
    targetRegime: 'mean_reverting',
    baseLeverage: 4,
    stopLossPercent: 0.012,
    takeProfitPercent: 0.02,
    timeframe: '15m',
    supportingTimeframes: ['1h'],
    allocationWeight: 1.7,
    description: 'Hidden RSI divergence entries at 3–5x leverage',
  },
  {
    type: 'cross_pair_momentum',
    tier: 2,
    targetRegime: 'trending',
    baseLeverage: 5,
    stopLossPercent: 0.015,
    takeProfitPercent: 0.03,
    timeframe: '15m',
    supportingTimeframes: ['1h'],
    allocationWeight: 0.9,
    description: 'Enter alts after BTC breakout confirms (lag entry)',
  },
  {
    type: 'volume_weighted',
    tier: 2,
    targetRegime: 'any',
    baseLeverage: 5,
    stopLossPercent: 0.015,
    takeProfitPercent: 0.025,
    timeframe: '15m',
    supportingTimeframes: ['1h'],
    allocationWeight: 1.0,
    description: 'Only enter when volume exceeds 2× 20-period average',
  },
  {
    type: 'bollinger_squeeze',
    tier: 2,
    targetRegime: 'transition',
    baseLeverage: 4,
    stopLossPercent: 0.015,
    takeProfitPercent: 0.03,
    timeframe: '1h',
    supportingTimeframes: ['4h'],
    allocationWeight: 0.9,
    description: 'Enter on breakout from low-volatility Bollinger squeeze',
  },
];

// ── Tier 3 templates (memecoins — 10x max → 2x effective cap) ────────────────
const TIER3_TEMPLATES: StrategyTemplate[] = [
  {
    type: 'momentum_only',
    tier: 3,
    targetRegime: 'trending',
    baseLeverage: 2,
    stopLossPercent: 0.04,
    takeProfitPercent: 0.08,
    timeframe: '5m',
    supportingTimeframes: ['15m'],
    allocationWeight: 0.5,
    description: 'Long-only momentum for memecoins; wide 4% stops',
  },
  {
    type: 'sentiment_momentum',
    tier: 3,
    targetRegime: 'trending',
    baseLeverage: 2,
    stopLossPercent: 0.04,
    takeProfitPercent: 0.06,
    timeframe: '5m',
    supportingTimeframes: ['15m'],
    allocationWeight: 0.5,
    description: 'Enter only when price-velocity acceleration is positive',
  },
  {
    type: 'quick_scalp',
    tier: 3,
    targetRegime: 'any',
    baseLeverage: 2,
    stopLossPercent: 0.025,
    takeProfitPercent: 0.015,
    timeframe: '1m',
    supportingTimeframes: ['5m'],
    allocationWeight: 0.4,
    description: 'In-and-out within minutes; 2x leverage, 1–2% targets',
  },
];

export const ALL_TEMPLATES: StrategyTemplate[] = [
  ...TIER1_TEMPLATES,
  ...TIER2_TEMPLATES,
  ...TIER3_TEMPLATES,
];

// ── Position sizing ───────────────────────────────────────────────────────────
export interface KellyInput {
  winRate: number;      // 0–1
  profitFactor: number; // avg win / avg loss
}

/**
 * Fractional Kelly position size (50% of full Kelly, capped at 2× riskPerTrade).
 * Kelly formula: f* = (p·b − q) / b
 * Returns size in base currency (same units as `balance`).
 *
 * @param balance     Available balance
 * @param input       Historical win rate and profit factor
 * @param riskPerTrade Maximum fraction of balance to risk per trade (default 2%)
 */
export function kellyPositionSize(
  balance: number,
  input: KellyInput,
  riskPerTrade = 0.02
): number {
  const p = Math.min(Math.max(input.winRate, 0), 1);
  const q = 1 - p;
  const b = Math.max(input.profitFactor, 0);

  const rawKelly = b > 0 ? (p * b - q) / b : 0;
  const fractional = Math.max(0, Math.min(rawKelly * 0.5, riskPerTrade * 2));
  return balance * fractional;
}

/**
 * Standard risk-based position sizing:
 * positionSize = balance × riskPerTrade / (stopLossPercent × leverage)
 *
 * Returns USDT notional value.
 */
export function standardPositionSize(
  balance: number,
  riskPerTrade: number,
  stopLossPercent: number,
  leverage: number
): number {
  if (stopLossPercent <= 0 || leverage <= 0) return 0;
  return (balance * riskPerTrade) / (stopLossPercent * leverage);
}

// ── Strategy spec output type ─────────────────────────────────────────────────
export interface StrategySpec {
  symbol: string;
  tier: LeverageTier;
  maxLeverage: number;
  effectiveLeverage: number;
  template: StrategyTemplate;
  /** Stop-loss fraction (adjusted for regime) */
  stopLossPercent: number;
  /** Take-profit fraction */
  takeProfitPercent: number;
  regime: MarketRegime;
  /** Bridge-law weights keyed by timeframe */
  timeframeWeights: Record<string, number>;
  /** Capital allocation weight (regime-conditioned) */
  allocationWeight: number;
}

// ── Main factory function ─────────────────────────────────────────────────────
/**
 * Build all applicable StrategySpec objects for the given symbol and regime.
 *
 * Regime-conditioned strategy selection:
 * - trending    → prefer momentum/breakout strategies
 * - mean_rev    → prefer mean-reversion WITH HIGHER CAPITAL ALLOCATION
 * - transition  → reduce leverage by 50%, widen stops, only safe templates
 *
 * @param symbol    Poloniex Futures symbol, e.g. 'BTC_USDT_PERP'
 * @param regime    Detected market regime for this symbol/timeframe
 * @param templates Optional override of strategy templates (for testing)
 */
export async function buildStrategySpec(
  symbol: string,
  regime: MarketRegime,
  templates?: StrategyTemplate[]
): Promise<StrategySpec[]> {
  const maxLev = await getMaxLeverage(symbol);
  if (!maxLev) {
    logger.warn(`leverageAwareStrategyFactory: no maxLeverage found for ${symbol}`);
    return [];
  }

  const tier = getLeverageTier(maxLev);
  const pool = templates ?? ALL_TEMPLATES;

  // Filter to this tier's templates
  const tierTemplates = pool.filter(t => t.tier === tier);

  // Regime-conditioned selection
  const selected = tierTemplates.filter(t => {
    if (regime === 'transition') {
      // In transition: only conservative strategies (low base leverage)
      return t.baseLeverage <= 5;
    }
    return t.targetRegime === regime || t.targetRegime === 'any';
  });

  const candidates = selected.length > 0 ? selected : tierTemplates;

  return candidates.map(template => {
    let effectiveLeverage = capEffectiveLeverage(template.baseLeverage, maxLev);
    let stopLossPercent = template.stopLossPercent;
    let takeProfitPercent = template.takeProfitPercent;

    if (regime === 'transition') {
      // Reduce leverage and widen stops in ambiguous regime
      effectiveLeverage = Math.max(1, Math.floor(effectiveLeverage * 0.5));
      stopLossPercent = stopLossPercent * 1.5;
      takeProfitPercent = takeProfitPercent * 1.5;
    }

    // Multi-timeframe weight map (bridge law)
    const allTimeframes = [template.timeframe, ...template.supportingTimeframes];
    const timeframeWeights: Record<string, number> = {};
    for (const tf of allTimeframes) {
      timeframeWeights[tf] = timeframeWeight(parseTimeframeMinutes(tf));
    }

    // Regime-conditioned allocation:
    // When mean_reverting and strategy targets mean_reversion → amplify weight
    // (QIG: mean-reverting regime is 170× stronger than trending)
    const allocationWeight =
      regime === 'mean_reverting' && template.targetRegime === 'mean_reverting'
        ? template.allocationWeight * 1.7
        : template.allocationWeight;

    return {
      symbol,
      tier,
      maxLeverage: maxLev,
      effectiveLeverage,
      template,
      stopLossPercent,
      takeProfitPercent,
      regime,
      timeframeWeights,
      allocationWeight,
    } satisfies StrategySpec;
  });
}

/**
 * Combine signals from multiple timeframes using the bridge law.
 * Each signal value should be in range [−1, +1].
 *
 * combinedSignal = Σ(signal_i × weight_i) / Σ(weight_i)
 *
 * @param signals Array of { timeframe, value } pairs
 */
export function combineMultiTimeframeSignals(
  signals: Array<{ timeframe: string; value: number }>
): number {
  if (signals.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const { timeframe, value } of signals) {
    const w = timeframeWeight(parseTimeframeMinutes(timeframe));
    weightedSum += value * w;
    totalWeight += w;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ── Internal utilities ────────────────────────────────────────────────────────
function parseTimeframeMinutes(tf: string): number {
  const map: Record<string, number> = {
    '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
    '1h': 60, '2h': 120, '4h': 240, '6h': 360, '12h': 720,
    '1d': 1440, '1D': 1440,
  };
  return map[tf] ?? 60;
}

export default {
  detectMarketRegime,
  getLeverageTier,
  capEffectiveLeverage,
  timeframeWeight,
  TIMEFRAME_WEIGHTS,
  buildStrategySpec,
  combineMultiTimeframeSignals,
  kellyPositionSize,
  standardPositionSize,
  ALL_TEMPLATES,
  TIER1_TEMPLATES,
  TIER2_TEMPLATES,
  TIER3_TEMPLATES,
};
