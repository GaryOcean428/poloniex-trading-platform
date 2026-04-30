import { describe, it, expect } from 'vitest';
import {
  classifyRegime,
  regimeEntryThresholdModifier,
  regimeHarvestTightness,
} from '../regime.js';
import { BASIN_DIM, type Basin } from '../basin.js';

function bullishBasin(intensity = 0.9): Basin {
  const v = new Float64Array(BASIN_DIM).fill(0.5);
  for (let i = 7; i <= 14; i++) v[i] = intensity;
  let s = 0;
  for (let i = 0; i < BASIN_DIM; i++) s += v[i]!;
  for (let i = 0; i < BASIN_DIM; i++) v[i] = v[i]! / s;
  return v as unknown as Basin;
}

function bearishBasin(intensity = 0.1): Basin {
  return bullishBasin(intensity);
}

function flatBasin(): Basin {
  return new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM) as unknown as Basin;
}

describe('classifyRegime — basics', () => {
  it('empty history -> CHOP at low confidence', () => {
    const r = classifyRegime([]);
    expect(r.regime).toBe('CHOP');
    expect(r.confidence).toBeLessThan(0.5);
  });

  it('single basin -> CHOP at low confidence', () => {
    const r = classifyRegime([flatBasin()]);
    expect(r.regime).toBe('CHOP');
  });

  it('consistent bull -> TREND_UP', () => {
    const hist = Array.from({ length: 16 }, () => bullishBasin());
    const r = classifyRegime(hist);
    expect(r.regime).toBe('TREND_UP');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('consistent bear -> TREND_DOWN', () => {
    const hist = Array.from({ length: 16 }, () => bearishBasin(0.1));
    const r = classifyRegime(hist);
    expect(r.regime).toBe('TREND_DOWN');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('alternating -> CHOP', () => {
    const hist: Basin[] = [];
    for (let i = 0; i < 16; i++) {
      hist.push(i % 2 === 0 ? bullishBasin() : bearishBasin(0.1));
    }
    const r = classifyRegime(hist);
    expect(r.regime).toBe('CHOP');
    expect(r.chopScore).toBeGreaterThan(0.5);
  });
});

describe('classifyRegime — fields', () => {
  it('trendStrength is signed', () => {
    const bull = classifyRegime(Array.from({ length: 16 }, () => bullishBasin()));
    const bear = classifyRegime(Array.from({ length: 16 }, () => bearishBasin(0.1)));
    expect(bull.trendStrength).toBeGreaterThan(0);
    expect(bear.trendStrength).toBeLessThan(0);
  });

  it('chopScore in [0, 1]', () => {
    const r = classifyRegime(Array.from({ length: 16 }, () => flatBasin()));
    expect(r.chopScore).toBeGreaterThanOrEqual(0);
    expect(r.chopScore).toBeLessThanOrEqual(1);
  });

  it('confidence in [0, 1]', () => {
    for (const hist of [
      Array.from({ length: 16 }, () => bullishBasin()),
      Array.from({ length: 16 }, () => bearishBasin(0.1)),
      Array.from({ length: 16 }, () => flatBasin()),
    ]) {
      const r = classifyRegime(hist);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('classifyRegime — modifiers', () => {
  it('chop entry threshold modifier > 1 (tighter)', () => {
    const m = regimeEntryThresholdModifier({
      regime: 'CHOP', confidence: 1, trendStrength: 0, chopScore: 1,
    });
    expect(m).toBeGreaterThan(1);
  });

  it('trend entry threshold modifier < 1 (looser)', () => {
    const m = regimeEntryThresholdModifier({
      regime: 'TREND_UP', confidence: 1, trendStrength: 0.5, chopScore: 0,
    });
    expect(m).toBeLessThan(1);
  });

  it('chop harvest tightness < 1', () => {
    const h = regimeHarvestTightness({
      regime: 'CHOP', confidence: 1, trendStrength: 0, chopScore: 1,
    });
    expect(h).toBeLessThan(1);
  });

  it('trend harvest tightness > 1', () => {
    const h = regimeHarvestTightness({
      regime: 'TREND_UP', confidence: 1, trendStrength: 0.5, chopScore: 0,
    });
    expect(h).toBeGreaterThan(1);
  });

  it('zero confidence is neutral', () => {
    const r = { regime: 'CHOP' as const, confidence: 0, trendStrength: 0, chopScore: 0 };
    expect(regimeEntryThresholdModifier(r)).toBeCloseTo(1.0);
    expect(regimeHarvestTightness(r)).toBeCloseTo(1.0);
  });
});

describe('classifyRegime — configurable thresholds', () => {
  it('looser thresholds promote borderline cases to TREND', () => {
    const hist = Array.from({ length: 16 }, () => bullishBasin(0.7));
    const tight = classifyRegime(hist, { trendThreshold: 0.95, chopThreshold: 0.05 });
    expect(tight.regime).toBe('CHOP');
    const loose = classifyRegime(hist, { trendThreshold: 0.001, chopThreshold: 0.95 });
    expect(loose.regime).toBe('TREND_UP');
  });
});

describe('classifyRegime — stability', () => {
  it('majority bull with noise stays TREND_UP', () => {
    const hist: Basin[] = [];
    let seed = 7;
    function rand() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    for (let i = 0; i < 16; i++) {
      hist.push(rand() < 0.85 ? bullishBasin() : flatBasin());
    }
    const r = classifyRegime(hist);
    expect(r.regime).toBe('TREND_UP');
  });
});
