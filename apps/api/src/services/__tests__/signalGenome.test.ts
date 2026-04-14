/**
 * Unit tests for the signal genome module.
 *
 * Validates:
 *   - Indicator map building from raw backtest indicators
 *   - Genome signal evaluation (entry/exit)
 *   - Random genome generation
 *   - Genome mutation (threshold, add/remove/swap conditions, risk params)
 *   - Genome crossover
 *   - Legacy strategy type → genome conversion
 *   - Strategy type inference from genome
 */

import { describe, it, expect } from 'vitest';
import {
  buildIndicatorMap,
  evaluateGenomeEntry,
  evaluateGenomeExit,
  generateRandomGenome,
  mutateGenome,
  crossoverGenomes,
  strategyTypeToGenome,
  inferStrategyType,
  SignalGenome,
  SignalCondition,
  IndicatorMap,
} from '../signalGenome.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a complete mock indicator set as the backtesting engine produces */
function mockRawIndicators(overrides: Partial<Record<string, any>> = {}) {
  return {
    sma20: 50000,
    sma50: 49000,
    ema9: 50500,
    ema20: 50200,
    ema50: 49500,
    rsi: 45,
    macd: { macd: 0.02, signal: 0.015, histogram: 0.005 },
    bollingerBands: { upper: 52000, middle: 50000, lower: 48000 },
    atr: 500,
    volumeMA: 1000,
    current: { price: 50100, high: 50500, low: 49800, volume: 1200 },
    ...overrides,
  };
}

// ─── buildIndicatorMap ───────────────────────────────────────────────────────

describe('buildIndicatorMap', () => {
  it('should build a complete indicator map from raw indicators', () => {
    const raw = mockRawIndicators();
    const map = buildIndicatorMap(raw);

    expect(map.sma20).toBe(50000);
    expect(map.sma50).toBe(49000);
    expect(map.ema9).toBe(50500);
    expect(map.ema20).toBe(50200);
    expect(map.ema50).toBe(49500);
    expect(map.rsi).toBe(45);
    expect(map.macd_histogram).toBe(0.005);
    expect(map.macd_line).toBe(0.02);
  });

  it('should compute bb_position correctly', () => {
    const raw = mockRawIndicators();
    const map = buildIndicatorMap(raw);
    // bb_position = (price - lower) / (upper - lower) = (50100 - 48000) / (52000 - 48000) = 0.525
    expect(map.bb_position).toBeCloseTo(0.525, 3);
  });

  it('should compute atr_ratio correctly', () => {
    const raw = mockRawIndicators();
    const map = buildIndicatorMap(raw);
    // atr_ratio = 500 / 50100 ≈ 0.00998
    expect(map.atr_ratio).toBeCloseTo(0.00998, 4);
  });

  it('should compute volume_ratio correctly', () => {
    const raw = mockRawIndicators();
    const map = buildIndicatorMap(raw);
    // volume_ratio = 1200 / 1000 = 1.2
    expect(map.volume_ratio).toBeCloseTo(1.2, 2);
  });

  it('should compute ema_cross_9_20 correctly', () => {
    const raw = mockRawIndicators();
    const map = buildIndicatorMap(raw);
    // ema_cross = (50500 - 50200) / 50200 ≈ 0.00598
    expect(map.ema_cross_9_20).toBeCloseTo(0.00598, 4);
  });

  it('should compute sma_cross_20_50 correctly', () => {
    const raw = mockRawIndicators();
    const map = buildIndicatorMap(raw);
    // sma_cross = (50000 - 49000) / 49000 ≈ 0.02041
    expect(map.sma_cross_20_50).toBeCloseTo(0.02041, 4);
  });

  it('should return null for missing indicators', () => {
    const map = buildIndicatorMap({});
    expect(map.sma20).toBeNull();
    expect(map.rsi).toBeNull();
    expect(map.bb_position).toBeNull();
    expect(map.volume_ratio).toBeNull();
  });
});

// ─── evaluateGenomeEntry ─────────────────────────────────────────────────────

describe('evaluateGenomeEntry', () => {
  it('should return a long signal when all long conditions pass', () => {
    const genome: SignalGenome = {
      entryConditions: [
        { indicator: 'rsi', comparator: '<', threshold: 50, side: 'long' },
        { indicator: 'volume_ratio', comparator: '>', threshold: 1.0, side: 'long' },
      ],
      exitConditions: [],
      stopLossPercent: 0.02,
      takeProfitPercent: 0.04,
      positionSizeFraction: 0.05,
    };

    const indicators = buildIndicatorMap(mockRawIndicators({ rsi: 45 }));
    const result = evaluateGenomeEntry(genome, indicators);

    expect(result).not.toBeNull();
    expect(result!.side).toBe('long');
    expect(result!.strength).toBe(1.0);
    expect(result!.reason).toContain('genome_long');
  });

  it('should return null when not all conditions pass', () => {
    const genome: SignalGenome = {
      entryConditions: [
        { indicator: 'rsi', comparator: '<', threshold: 30, side: 'long' }, // RSI 45 > 30 → fails
        { indicator: 'volume_ratio', comparator: '>', threshold: 1.0, side: 'long' },
      ],
      exitConditions: [],
      stopLossPercent: 0.02,
      takeProfitPercent: 0.04,
      positionSizeFraction: 0.05,
    };

    const indicators = buildIndicatorMap(mockRawIndicators({ rsi: 45 }));
    const result = evaluateGenomeEntry(genome, indicators);
    expect(result).toBeNull();
  });

  it('should return a short signal when short conditions pass', () => {
    const genome: SignalGenome = {
      entryConditions: [
        { indicator: 'rsi', comparator: '>', threshold: 70, side: 'short' },
      ],
      exitConditions: [],
      stopLossPercent: 0.02,
      takeProfitPercent: 0.04,
      positionSizeFraction: 0.05,
    };

    const indicators = buildIndicatorMap(mockRawIndicators({ rsi: 80 }));
    const result = evaluateGenomeEntry(genome, indicators);

    expect(result).not.toBeNull();
    expect(result!.side).toBe('short');
  });

  it('should handle crosses_above comparator with prev indicator map', () => {
    const genome: SignalGenome = {
      entryConditions: [
        { indicator: 'rsi', comparator: 'crosses_above', threshold: 50, side: 'long' },
      ],
      exitConditions: [],
      stopLossPercent: 0.02,
      takeProfitPercent: 0.04,
      positionSizeFraction: 0.05,
    };

    const prevIndicators = buildIndicatorMap(mockRawIndicators({ rsi: 48 }));
    const currIndicators = buildIndicatorMap(mockRawIndicators({ rsi: 52 }));

    const result = evaluateGenomeEntry(genome, currIndicators, prevIndicators);
    expect(result).not.toBeNull();
    expect(result!.side).toBe('long');
  });

  it('should return null for crosses_above when no previous map', () => {
    const genome: SignalGenome = {
      entryConditions: [
        { indicator: 'rsi', comparator: 'crosses_above', threshold: 50, side: 'long' },
      ],
      exitConditions: [],
      stopLossPercent: 0.02,
      takeProfitPercent: 0.04,
      positionSizeFraction: 0.05,
    };

    const indicators = buildIndicatorMap(mockRawIndicators({ rsi: 52 }));
    const result = evaluateGenomeEntry(genome, indicators);
    expect(result).toBeNull();
  });

  it('should handle null indicator values gracefully', () => {
    const genome: SignalGenome = {
      entryConditions: [
        { indicator: 'rsi', comparator: '<', threshold: 50, side: 'long' },
      ],
      exitConditions: [],
      stopLossPercent: 0.02,
      takeProfitPercent: 0.04,
      positionSizeFraction: 0.05,
    };

    const indicators = buildIndicatorMap({});
    const result = evaluateGenomeEntry(genome, indicators);
    expect(result).toBeNull();
  });
});

// ─── evaluateGenomeExit ──────────────────────────────────────────────────────

describe('evaluateGenomeExit', () => {
  it('should return true when any exit condition is satisfied', () => {
    const genome: SignalGenome = {
      entryConditions: [],
      exitConditions: [
        { indicator: 'rsi', comparator: '>', threshold: 70, side: 'both' },
      ],
      stopLossPercent: 0.02,
      takeProfitPercent: 0.04,
      positionSizeFraction: 0.05,
    };

    const indicators = buildIndicatorMap(mockRawIndicators({ rsi: 75 }));
    expect(evaluateGenomeExit(genome, indicators, 'long')).toBe(true);
  });

  it('should return false when no exit condition is satisfied', () => {
    const genome: SignalGenome = {
      entryConditions: [],
      exitConditions: [
        { indicator: 'rsi', comparator: '>', threshold: 80, side: 'both' },
      ],
      stopLossPercent: 0.02,
      takeProfitPercent: 0.04,
      positionSizeFraction: 0.05,
    };

    const indicators = buildIndicatorMap(mockRawIndicators({ rsi: 50 }));
    expect(evaluateGenomeExit(genome, indicators, 'long')).toBe(false);
  });
});

// ─── generateRandomGenome ────────────────────────────────────────────────────

describe('generateRandomGenome', () => {
  it('should generate a genome with 2–4 entry conditions', () => {
    // Run multiple times to verify range
    for (let i = 0; i < 20; i++) {
      const genome = generateRandomGenome();
      expect(genome.entryConditions.length).toBeGreaterThanOrEqual(2);
      expect(genome.entryConditions.length).toBeLessThanOrEqual(4);
    }
  });

  it('should generate a genome with valid risk parameters', () => {
    const genome = generateRandomGenome();
    expect(genome.stopLossPercent).toBeGreaterThanOrEqual(0.005);
    expect(genome.stopLossPercent).toBeLessThanOrEqual(0.05);
    expect(genome.takeProfitPercent).toBeGreaterThanOrEqual(0.01);
    expect(genome.takeProfitPercent).toBeLessThanOrEqual(0.10);
    expect(genome.positionSizeFraction).toBeGreaterThanOrEqual(0.01);
    expect(genome.positionSizeFraction).toBeLessThanOrEqual(0.10);
  });

  it('should produce diverse genomes', () => {
    const genomes = Array.from({ length: 10 }, () => generateRandomGenome());
    const indicators = new Set(
      genomes.flatMap(g => g.entryConditions.map(c => c.indicator))
    );
    // Should use multiple different indicators across 10 genomes
    expect(indicators.size).toBeGreaterThan(1);
  });
});

// ─── mutateGenome ────────────────────────────────────────────────────────────

describe('mutateGenome', () => {
  it('should return a new genome (not mutate in place)', () => {
    const original = generateRandomGenome();
    const originalJSON = JSON.stringify(original);
    mutateGenome(original);
    expect(JSON.stringify(original)).toBe(originalJSON);
  });

  it('should produce a genome with at least 1 entry condition', () => {
    // Run many times to catch edge cases
    for (let i = 0; i < 50; i++) {
      const genome = generateRandomGenome();
      const mutated = mutateGenome(genome);
      expect(mutated.entryConditions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should produce valid risk parameters', () => {
    for (let i = 0; i < 20; i++) {
      const genome = generateRandomGenome();
      const mutated = mutateGenome(genome);
      expect(mutated.stopLossPercent).toBeGreaterThanOrEqual(0.005);
      expect(mutated.stopLossPercent).toBeLessThanOrEqual(0.05);
      expect(mutated.takeProfitPercent).toBeGreaterThanOrEqual(0.01);
      expect(mutated.takeProfitPercent).toBeLessThanOrEqual(0.10);
      expect(mutated.positionSizeFraction).toBeGreaterThanOrEqual(0.01);
      expect(mutated.positionSizeFraction).toBeLessThanOrEqual(0.10);
    }
  });
});

// ─── crossoverGenomes ────────────────────────────────────────────────────────

describe('crossoverGenomes', () => {
  it('should combine conditions from both parents', () => {
    const parent1: SignalGenome = {
      entryConditions: [
        { indicator: 'rsi', comparator: '<', threshold: 30, side: 'long' },
        { indicator: 'macd_histogram', comparator: '>', threshold: 0, side: 'long' },
      ],
      exitConditions: [],
      stopLossPercent: 0.01,
      takeProfitPercent: 0.03,
      positionSizeFraction: 0.02,
    };
    const parent2: SignalGenome = {
      entryConditions: [
        { indicator: 'bb_position', comparator: '<', threshold: 0.2, side: 'long' },
        { indicator: 'volume_ratio', comparator: '>', threshold: 1.5, side: 'long' },
      ],
      exitConditions: [],
      stopLossPercent: 0.03,
      takeProfitPercent: 0.06,
      positionSizeFraction: 0.08,
    };

    const child = crossoverGenomes(parent1, parent2);

    // Child should have conditions from both parents
    expect(child.entryConditions.length).toBeGreaterThanOrEqual(1);
    // Risk params should be averaged
    expect(child.stopLossPercent).toBeCloseTo(0.02, 4);
    expect(child.takeProfitPercent).toBeCloseTo(0.045, 4);
    expect(child.positionSizeFraction).toBeCloseTo(0.05, 4);
  });

  it('should produce a valid genome', () => {
    for (let i = 0; i < 20; i++) {
      const p1 = generateRandomGenome();
      const p2 = generateRandomGenome();
      const child = crossoverGenomes(p1, p2);
      expect(child.entryConditions.length).toBeGreaterThanOrEqual(1);
      expect(child.stopLossPercent).toBeGreaterThan(0);
      expect(child.takeProfitPercent).toBeGreaterThan(0);
    }
  });
});

// ─── strategyTypeToGenome ────────────────────────────────────────────────────

describe('strategyTypeToGenome', () => {
  const legacyTypes = ['trend_following', 'momentum', 'mean_reversion', 'breakout', 'scalping'];

  for (const type of legacyTypes) {
    it(`should convert '${type}' to a valid genome`, () => {
      const genome = strategyTypeToGenome(type);
      expect(genome.entryConditions.length).toBeGreaterThan(0);
      expect(genome.stopLossPercent).toBeGreaterThan(0);
      expect(genome.takeProfitPercent).toBeGreaterThan(0);
      expect(genome.positionSizeFraction).toBeGreaterThan(0);
    });
  }

  it('should produce signals equivalent to the old trend_following logic', () => {
    const genome = strategyTypeToGenome('trend_following');
    // SMA20 > SMA50 → sma_cross_20_50 > 0 → long signal
    const indicators = buildIndicatorMap(mockRawIndicators({ sma20: 50000, sma50: 49000 }));
    const result = evaluateGenomeEntry(genome, indicators);
    expect(result).not.toBeNull();
    expect(result!.side).toBe('long');
  });

  it('should produce signals equivalent to the old momentum logic', () => {
    const genome = strategyTypeToGenome('momentum');
    // RSI < 35 && MACD histogram > 0 → long
    const indicators = buildIndicatorMap(mockRawIndicators({
      rsi: 30,
      macd: { macd: 0.02, signal: 0.01, histogram: 0.01 },
    }));
    const result = evaluateGenomeEntry(genome, indicators);
    expect(result).not.toBeNull();
    expect(result!.side).toBe('long');
  });

  it('should return a random genome for unknown types', () => {
    const genome = strategyTypeToGenome('unknown_type');
    expect(genome.entryConditions.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── inferStrategyType ───────────────────────────────────────────────────────

describe('inferStrategyType', () => {
  it('should infer trend_following from SMA cross genome', () => {
    const genome = strategyTypeToGenome('trend_following');
    expect(inferStrategyType(genome)).toBe('trend_following');
  });

  it('should infer momentum from RSI + MACD genome', () => {
    const genome = strategyTypeToGenome('momentum');
    expect(inferStrategyType(genome)).toBe('momentum');
  });

  it('should infer scalping from EMA cross genome', () => {
    const genome = strategyTypeToGenome('scalping');
    expect(inferStrategyType(genome)).toBe('scalping');
  });

  it('should return genome_custom for unrecognised indicator combinations', () => {
    const genome: SignalGenome = {
      entryConditions: [
        { indicator: 'atr_ratio', comparator: '>', threshold: 0.01, side: 'long' },
      ],
      exitConditions: [],
      stopLossPercent: 0.02,
      takeProfitPercent: 0.04,
      positionSizeFraction: 0.05,
    };
    expect(inferStrategyType(genome)).toBe('genome_custom');
  });
});
