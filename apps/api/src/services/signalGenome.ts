/**
 * Signal Genome — composable, evolvable signal configuration
 *
 * Replaces the hardcoded strategy type enum with a flat parameter vector
 * that the SLE can mutate, crossover, and evolve.  The backtest engine
 * computes ALL indicators on every candle and evaluates the genome's
 * conditions — no switch statement, no type enum.
 *
 * QIG integration path (future phases):
 *  - Phase 2: qig-warp .auto() wraps backtest objective for screening
 *  - Phase 3: Fisher-Rao gradient replaces random mutation
 */

// ─────────────────────────────────────────────────────────────────────────────
// Indicator types available to genomes
// ─────────────────────────────────────────────────────────────────────────────

/** All indicator types the genome can reference */
export type IndicatorType =
  // Trend
  | 'sma20'
  | 'sma50'
  | 'ema9'
  | 'ema20'
  | 'ema50'
  // Momentum
  | 'rsi'
  | 'macd_histogram'
  | 'macd_line'
  // Volatility
  | 'bb_position'     // (price − lower) / (upper − lower), 0..1
  | 'atr_ratio'       // ATR / price, normalised volatility
  // Volume
  | 'volume_ratio'    // current volume / volumeMA
  // Derived / cross
  | 'ema_cross_9_20'  // (ema9 − ema20) / ema20, positive = bullish
  | 'sma_cross_20_50'; // (sma20 − sma50) / sma50

/** Comparators for signal conditions */
export type Comparator = '>' | '<' | 'crosses_above' | 'crosses_below';

/** Which side this condition applies to */
export type ConditionSide = 'long' | 'short' | 'both';

// ─────────────────────────────────────────────────────────────────────────────
// Core interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface SignalCondition {
  indicator: IndicatorType;
  comparator: Comparator;
  threshold: number;
  side: ConditionSide;
}

export interface SignalGenome {
  /** Entry conditions — all must be true (ANDed) to enter */
  entryConditions: SignalCondition[];
  /** Exit conditions beyond SL/TP */
  exitConditions: SignalCondition[];
  /** Risk parameters — learnable */
  stopLossPercent: number;    // 0.005 – 0.05
  takeProfitPercent: number;  // 0.01 – 0.10
  positionSizeFraction: number; // 0.01 – 0.10
}

// ─────────────────────────────────────────────────────────────────────────────
// Indicator computation
// ─────────────────────────────────────────────────────────────────────────────

/** Map of all indicator values for a single candle */
export interface IndicatorMap {
  sma20: number | null;
  sma50: number | null;
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi: number | null;
  macd_histogram: number | null;
  macd_line: number | null;
  bb_position: number | null;
  atr_ratio: number | null;
  volume_ratio: number | null;
  ema_cross_9_20: number | null;
  sma_cross_20_50: number | null;
}

/**
 * Build a flat indicator map from raw backtest indicators.
 * The backtesting engine already computes sma20, sma50, ema9, ema20, ema50,
 * rsi, macd, bollingerBands, atr, volumeMA, and current price/volume.
 */
export function buildIndicatorMap(indicators: any): IndicatorMap {
  const price = indicators.current?.price ?? null;
  const volume = indicators.current?.volume ?? null;
  const bb = indicators.bollingerBands;
  const macd = indicators.macd;

  // Bollinger position: (price − lower) / (upper − lower)
  let bbPos: number | null = null;
  if (bb && price != null && bb.upper !== bb.lower) {
    bbPos = (price - bb.lower) / (bb.upper - bb.lower);
  }

  // ATR ratio: ATR / price (normalised volatility)
  let atrRatio: number | null = null;
  if (indicators.atr != null && price != null && price > 0) {
    atrRatio = indicators.atr / price;
  }

  // Volume ratio: current volume / volume MA
  let volRatio: number | null = null;
  if (volume != null && indicators.volumeMA != null && indicators.volumeMA > 0) {
    volRatio = volume / indicators.volumeMA;
  }

  // EMA cross 9/20: (ema9 − ema20) / ema20
  let emaCross: number | null = null;
  if (indicators.ema9 != null && indicators.ema20 != null && indicators.ema20 !== 0) {
    emaCross = (indicators.ema9 - indicators.ema20) / indicators.ema20;
  }

  // SMA cross 20/50: (sma20 − sma50) / sma50
  let smaCross: number | null = null;
  if (indicators.sma20 != null && indicators.sma50 != null && indicators.sma50 !== 0) {
    smaCross = (indicators.sma20 - indicators.sma50) / indicators.sma50;
  }

  return {
    sma20: indicators.sma20 ?? null,
    sma50: indicators.sma50 ?? null,
    ema9: indicators.ema9 ?? null,
    ema20: indicators.ema20 ?? null,
    ema50: indicators.ema50 ?? null,
    rsi: indicators.rsi ?? null,
    macd_histogram: macd?.histogram ?? null,
    macd_line: macd?.macd ?? null,
    bb_position: bbPos,
    atr_ratio: atrRatio,
    volume_ratio: volRatio,
    ema_cross_9_20: emaCross,
    sma_cross_20_50: smaCross,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal evaluation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a single condition against the indicator map.
 * Returns true if the condition is met.
 */
function evaluateCondition(
  cond: SignalCondition,
  indicatorMap: IndicatorMap,
  _prevIndicatorMap?: IndicatorMap | null
): boolean {
  const value = indicatorMap[cond.indicator];
  if (value == null) return false;

  switch (cond.comparator) {
    case '>':
      return value > cond.threshold;
    case '<':
      return value < cond.threshold;
    case 'crosses_above': {
      if (!_prevIndicatorMap) return false;
      const prev = _prevIndicatorMap[cond.indicator];
      if (prev == null) return false;
      return prev <= cond.threshold && value > cond.threshold;
    }
    case 'crosses_below': {
      if (!_prevIndicatorMap) return false;
      const prev = _prevIndicatorMap[cond.indicator];
      if (prev == null) return false;
      return prev >= cond.threshold && value < cond.threshold;
    }
    default:
      return false;
  }
}

/**
 * Evaluate genome entry conditions.
 * Returns { side, strength, reason } or null if no entry signal.
 *
 * For a given side ('long' or 'short'), ALL conditions with matching side
 * or 'both' must be true.  Strength is set to the fraction of satisfied
 * conditions over total (always 1.0 when a valid signal is generated,
 * since we AND them).
 */
export function evaluateGenomeEntry(
  genome: SignalGenome,
  indicatorMap: IndicatorMap,
  prevIndicatorMap?: IndicatorMap | null
): { side: 'long' | 'short'; strength: number; reason: string } | null {
  // Try long
  const longConds = genome.entryConditions.filter(
    c => c.side === 'long' || c.side === 'both'
  );
  if (longConds.length > 0) {
    const allPass = longConds.every(c => evaluateCondition(c, indicatorMap, prevIndicatorMap));
    if (allPass) {
      return {
        side: 'long',
        strength: 1.0,
        reason: `genome_long_${longConds.length}cond`,
      };
    }
  }

  // Try short
  const shortConds = genome.entryConditions.filter(
    c => c.side === 'short' || c.side === 'both'
  );
  if (shortConds.length > 0) {
    const allPass = shortConds.every(c => evaluateCondition(c, indicatorMap, prevIndicatorMap));
    if (allPass) {
      return {
        side: 'short',
        strength: 1.0,
        reason: `genome_short_${shortConds.length}cond`,
      };
    }
  }

  return null;
}

/**
 * Evaluate genome exit conditions.
 * Returns true if any exit condition is satisfied (ORed).
 */
export function evaluateGenomeExit(
  genome: SignalGenome,
  indicatorMap: IndicatorMap,
  positionSide: 'long' | 'short',
  prevIndicatorMap?: IndicatorMap | null
): boolean {
  const relevantConds = genome.exitConditions.filter(
    c => c.side === positionSide || c.side === 'both'
  );
  return relevantConds.some(c => evaluateCondition(c, indicatorMap, prevIndicatorMap));
}

// ─────────────────────────────────────────────────────────────────────────────
// Genome generation (random)
// ─────────────────────────────────────────────────────────────────────────────

/** All indicator types for random selection (exported for external consumers) */
export const ALL_INDICATORS: IndicatorType[] = [
  'sma20', 'sma50', 'ema9', 'ema20', 'ema50',
  'rsi', 'macd_histogram', 'macd_line',
  'bb_position', 'atr_ratio', 'volume_ratio',
  'ema_cross_9_20', 'sma_cross_20_50',
];

/**
 * Default threshold ranges per indicator type.
 * Raw price-level indicators (sma20, sma50, etc.) have wide ranges as they are
 * not used in NORMALISED_INDICATORS — genomes generate conditions using
 * normalised indicators only.  The ranges are retained for completeness.
 */
const THRESHOLD_RANGES: Record<IndicatorType, [number, number]> = {
  sma20:          [0, 100000],     // raw price level — not used in genome generation
  sma50:          [0, 100000],
  ema9:           [0, 100000],
  ema20:          [0, 100000],
  ema50:          [0, 100000],
  rsi:            [15, 85],
  macd_histogram: [-0.05, 0.05],
  macd_line:      [-0.1, 0.1],
  bb_position:    [0, 1],
  atr_ratio:      [0.001, 0.05],
  volume_ratio:   [0.5, 3.0],
  ema_cross_9_20: [-0.02, 0.02],
  sma_cross_20_50:[-0.02, 0.02],
};

/** Indicators best suited for genome conditions (not raw price levels) */
const NORMALISED_INDICATORS: IndicatorType[] = [
  'rsi', 'macd_histogram', 'macd_line',
  'bb_position', 'atr_ratio', 'volume_ratio',
  'ema_cross_9_20', 'sma_cross_20_50',
];

/** Simple random float in [min, max] */
function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generate a random signal condition using normalised indicators */
function randomCondition(side: ConditionSide): SignalCondition {
  const indicator = randChoice(NORMALISED_INDICATORS);
  const [lo, hi] = THRESHOLD_RANGES[indicator];
  const comparator = randChoice(['>', '<'] as const);
  return {
    indicator,
    comparator,
    threshold: randFloat(lo, hi),
    side,
  };
}

/**
 * Generate a random signal genome.
 * Produces 2–4 entry conditions and 0–2 exit conditions with
 * random but bounded risk parameters.
 */
export function generateRandomGenome(): SignalGenome {
  const numEntry = 2 + Math.floor(Math.random() * 3); // 2–4
  const numExit = Math.floor(Math.random() * 3); // 0–2

  // Decide entry side bias — 50% long-biased, 50% short-biased
  const entrySide: ConditionSide = Math.random() < 0.5 ? 'long' : 'short';

  const entryConditions: SignalCondition[] = [];
  for (let i = 0; i < numEntry; i++) {
    entryConditions.push(randomCondition(entrySide));
  }

  const exitConditions: SignalCondition[] = [];
  for (let i = 0; i < numExit; i++) {
    // Exit conditions typically use 'both' or opposite side
    exitConditions.push(randomCondition('both'));
  }

  return {
    entryConditions,
    exitConditions,
    stopLossPercent: randFloat(0.005, 0.05),
    takeProfitPercent: randFloat(0.01, 0.10),
    positionSizeFraction: randFloat(0.01, 0.10),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Genome mutation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mutate a genome.  Applies one of:
 *   1. Threshold perturbation (±10–30%)
 *   2. Add a random condition
 *   3. Remove a condition (if >1 entry)
 *   4. Swap an indicator
 *   5. Mutate risk parameters
 */
export function mutateGenome(genome: SignalGenome): SignalGenome {
  // Deep clone
  const g: SignalGenome = {
    entryConditions: genome.entryConditions.map(c => ({ ...c })),
    exitConditions: genome.exitConditions.map(c => ({ ...c })),
    stopLossPercent: genome.stopLossPercent,
    takeProfitPercent: genome.takeProfitPercent,
    positionSizeFraction: genome.positionSizeFraction,
  };

  const op = Math.random();

  if (op < 0.3 && g.entryConditions.length > 0) {
    // 1. Threshold perturbation
    const idx = Math.floor(Math.random() * g.entryConditions.length);
    const cond = g.entryConditions[idx];
    const perturbation = 1 + randFloat(-0.3, 0.3);
    cond.threshold *= perturbation;
    // Clamp to valid range
    const [lo, hi] = THRESHOLD_RANGES[cond.indicator];
    cond.threshold = Math.max(lo, Math.min(hi, cond.threshold));
  } else if (op < 0.5) {
    // 2. Add a random condition
    const side = g.entryConditions.length > 0 ? g.entryConditions[0].side : 'both';
    g.entryConditions.push(randomCondition(side));
  } else if (op < 0.65 && g.entryConditions.length > 1) {
    // 3. Remove a condition (simplify)
    const idx = Math.floor(Math.random() * g.entryConditions.length);
    g.entryConditions.splice(idx, 1);
  } else if (op < 0.8 && g.entryConditions.length > 0) {
    // 4. Swap indicator on a condition
    const idx = Math.floor(Math.random() * g.entryConditions.length);
    const newInd = randChoice(NORMALISED_INDICATORS);
    const [lo, hi] = THRESHOLD_RANGES[newInd];
    g.entryConditions[idx].indicator = newInd;
    g.entryConditions[idx].threshold = randFloat(lo, hi);
  } else {
    // 5. Mutate risk parameters
    g.stopLossPercent = Math.max(0.005, Math.min(0.05, g.stopLossPercent * (1 + randFloat(-0.2, 0.2))));
    g.takeProfitPercent = Math.max(0.01, Math.min(0.10, g.takeProfitPercent * (1 + randFloat(-0.2, 0.2))));
    g.positionSizeFraction = Math.max(0.01, Math.min(0.10, g.positionSizeFraction * (1 + randFloat(-0.2, 0.2))));
  }

  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Genome crossover
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crossover two genomes.
 * Splices entry conditions from both parents and averages risk parameters.
 */
export function crossoverGenomes(parent1: SignalGenome, parent2: SignalGenome): SignalGenome {
  // Split entry conditions: take first half from parent1, second half from parent2
  const splitP1 = Math.ceil(parent1.entryConditions.length / 2);
  const splitP2 = Math.floor(parent2.entryConditions.length / 2);

  const entryConditions = [
    ...parent1.entryConditions.slice(0, splitP1).map(c => ({ ...c })),
    ...parent2.entryConditions.slice(splitP2).map(c => ({ ...c })),
  ];

  // Unify side — pick the side that has more conditions
  if (entryConditions.length > 0) {
    const longCount = entryConditions.filter(c => c.side === 'long').length;
    const shortCount = entryConditions.filter(c => c.side === 'short').length;
    const dominantSide: ConditionSide = longCount >= shortCount ? 'long' : 'short';
    for (const c of entryConditions) {
      if (c.side !== 'both') c.side = dominantSide;
    }
  }

  // Exit conditions: take from the parent with more exits
  const exitSource = parent1.exitConditions.length >= parent2.exitConditions.length ? parent1 : parent2;
  const exitConditions = exitSource.exitConditions.map(c => ({ ...c }));

  // Average risk parameters
  return {
    entryConditions,
    exitConditions,
    stopLossPercent: (parent1.stopLossPercent + parent2.stopLossPercent) / 2,
    takeProfitPercent: (parent1.takeProfitPercent + parent2.takeProfitPercent) / 2,
    positionSizeFraction: (parent1.positionSizeFraction + parent2.positionSizeFraction) / 2,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backward compatibility — map old strategy types to equivalent genomes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a legacy strategy type string into an equivalent signal genome.
 * This preserves backward compatibility so old strategies loaded from DB
 * can run through the genome-based evaluation path.
 */
export function strategyTypeToGenome(
  strategyType: string,
  params?: Record<string, any>
): SignalGenome {
  switch (strategyType) {
    case 'trend_following':
      return {
        entryConditions: [
          { indicator: 'sma_cross_20_50', comparator: '>', threshold: 0, side: 'long' },
          { indicator: 'sma_cross_20_50', comparator: '<', threshold: 0, side: 'short' },
        ],
        exitConditions: [],
        stopLossPercent: params?.stopLossPercent ?? 0.02,
        takeProfitPercent: params?.takeProfitPercent ?? 0.04,
        positionSizeFraction: params?.positionSizeFraction ?? 0.05,
      };

    case 'momentum':
      return {
        entryConditions: [
          { indicator: 'rsi', comparator: '<', threshold: params?.rsi_oversold ?? 35, side: 'long' },
          { indicator: 'macd_histogram', comparator: '>', threshold: params?.macd_threshold ?? 0, side: 'long' },
          { indicator: 'rsi', comparator: '>', threshold: params?.rsi_overbought ?? 65, side: 'short' },
          { indicator: 'macd_histogram', comparator: '<', threshold: -(params?.macd_threshold ?? 0), side: 'short' },
        ],
        exitConditions: [],
        stopLossPercent: params?.stopLossPercent ?? 0.02,
        takeProfitPercent: params?.takeProfitPercent ?? 0.04,
        positionSizeFraction: params?.positionSizeFraction ?? 0.05,
      };

    case 'mean_reversion':
      return {
        entryConditions: [
          { indicator: 'bb_position', comparator: '<', threshold: 0.0, side: 'long' },
          { indicator: 'rsi', comparator: '<', threshold: params?.rsi_extreme ?? 30, side: 'long' },
          { indicator: 'bb_position', comparator: '>', threshold: 1.0, side: 'short' },
          { indicator: 'rsi', comparator: '>', threshold: 100 - (params?.rsi_extreme ?? 30), side: 'short' },
        ],
        exitConditions: [],
        stopLossPercent: params?.stopLossPercent ?? 0.015,
        takeProfitPercent: params?.takeProfitPercent ?? 0.03,
        positionSizeFraction: params?.positionSizeFraction ?? 0.05,
      };

    case 'breakout':
      return {
        entryConditions: [
          { indicator: 'bb_position', comparator: '>', threshold: 1.0, side: 'long' },
          { indicator: 'volume_ratio', comparator: '>', threshold: params?.volumeThreshold ?? 1.3, side: 'long' },
          { indicator: 'bb_position', comparator: '<', threshold: 0.0, side: 'short' },
          { indicator: 'volume_ratio', comparator: '>', threshold: params?.volumeThreshold ?? 1.3, side: 'short' },
        ],
        exitConditions: [],
        stopLossPercent: params?.stopLossPercent ?? 0.02,
        takeProfitPercent: params?.takeProfitPercent ?? 0.04,
        positionSizeFraction: params?.positionSizeFraction ?? 0.05,
      };

    case 'scalping':
      return {
        entryConditions: [
          { indicator: 'ema_cross_9_20', comparator: '>', threshold: 0, side: 'long' },
          { indicator: 'rsi', comparator: '<', threshold: params?.rsi_high ?? 60, side: 'long' },
          { indicator: 'rsi', comparator: '>', threshold: params?.rsi_low ?? 40, side: 'long' },
          { indicator: 'ema_cross_9_20', comparator: '<', threshold: 0, side: 'short' },
          { indicator: 'rsi', comparator: '>', threshold: 100 - (params?.rsi_high ?? 60), side: 'short' },
          { indicator: 'rsi', comparator: '<', threshold: 100 - (params?.rsi_low ?? 40), side: 'short' },
        ],
        exitConditions: [],
        stopLossPercent: params?.stopLossPercent ?? 0.01,
        takeProfitPercent: params?.takeProfitPercent ?? 0.02,
        positionSizeFraction: params?.positionSizeFraction ?? 0.03,
      };

    default:
      // Unknown type — generate a basic genome
      return generateRandomGenome();
  }
}

/**
 * Infer a legacy strategy type label from a genome's dominant indicators.
 * Used for DB backward compat and human-readable labelling.
 */
export function inferStrategyType(genome: SignalGenome): string {
  const indicators = new Set(genome.entryConditions.map(c => c.indicator));

  if (indicators.has('sma_cross_20_50') && !indicators.has('rsi')) return 'trend_following';
  if (indicators.has('rsi') && indicators.has('macd_histogram')) return 'momentum';
  if (indicators.has('bb_position') && indicators.has('rsi')) return 'mean_reversion';
  if (indicators.has('bb_position') && indicators.has('volume_ratio')) return 'breakout';
  if (indicators.has('ema_cross_9_20')) return 'scalping';

  return 'genome_custom';
}
