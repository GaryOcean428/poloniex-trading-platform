import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyRegime,
  regimeEntryThresholdModifier,
  regimeHarvestTightness,
} from '../regime.js';
import {
  _resetTrajectoryObserver,
  observerSnapshot,
  observeAndClassify,
} from '../trajectory_observer.js';
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

// Each test gets a fresh observer state so per-symbol buffers don't leak
// across tests.
beforeEach(() => {
  _resetTrajectoryObserver();
});

describe('classifyRegime — basics', () => {
  it('empty history -> CHOP at low confidence', () => {
    const r = classifyRegime('TEST', []);
    expect(r.regime).toBe('CHOP');
    expect(r.confidence).toBeLessThan(0.5);
  });

  it('single basin -> CHOP at low confidence', () => {
    const r = classifyRegime('TEST', [flatBasin()]);
    expect(r.regime).toBe('CHOP');
  });

  it('consistent bull -> TREND_UP', () => {
    const hist = Array.from({ length: 16 }, () => bullishBasin());
    const r = classifyRegime('TEST', hist);
    expect(r.regime).toBe('TREND_UP');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('consistent bear -> TREND_DOWN', () => {
    const hist = Array.from({ length: 16 }, () => bearishBasin(0.1));
    const r = classifyRegime('TEST', hist);
    expect(r.regime).toBe('TREND_DOWN');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('alternating -> CHOP', () => {
    const hist: Basin[] = [];
    for (let i = 0; i < 16; i++) {
      hist.push(i % 2 === 0 ? bullishBasin() : bearishBasin(0.1));
    }
    const r = classifyRegime('TEST', hist);
    expect(r.regime).toBe('CHOP');
    expect(r.chopScore).toBeGreaterThan(0.5);
  });
});

describe('classifyRegime — fields', () => {
  it('trendStrength is signed', () => {
    const bull = classifyRegime('TEST_BULL', Array.from({ length: 16 }, () => bullishBasin()));
    const bear = classifyRegime('TEST_BEAR', Array.from({ length: 16 }, () => bearishBasin(0.1)));
    expect(bull.trendStrength).toBeGreaterThan(0);
    expect(bear.trendStrength).toBeLessThan(0);
  });

  it('chopScore in [0, 1]', () => {
    const r = classifyRegime('TEST', Array.from({ length: 16 }, () => flatBasin()));
    expect(r.chopScore).toBeGreaterThanOrEqual(0);
    expect(r.chopScore).toBeLessThanOrEqual(1);
  });

  it('confidence in [0, 1]', () => {
    let i = 0;
    for (const hist of [
      Array.from({ length: 16 }, () => bullishBasin()),
      Array.from({ length: 16 }, () => bearishBasin(0.1)),
      Array.from({ length: 16 }, () => flatBasin()),
    ]) {
      const r = classifyRegime(`TEST_${i++}`, hist);
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
    const r = classifyRegime('TEST', hist);
    expect(r.regime).toBe('TREND_UP');
  });
});

describe('TrajectoryObserver — per-symbol isolation', () => {
  it('ETH observer state is independent from BTC', () => {
    // Seed ETH with bullish basins so its rolling buffer skews bullish.
    for (let i = 0; i < 50; i++) {
      observeAndClassify('ETH_USDT_PERP', bullishBasin());
    }
    // Seed BTC with bearish basins.
    for (let i = 0; i < 50; i++) {
      observeAndClassify('BTC_USDT_PERP', bearishBasin(0.1));
    }
    const eth = observerSnapshot('ETH_USDT_PERP');
    const btc = observerSnapshot('BTC_USDT_PERP');
    expect(eth.n).toBe(50);
    expect(btc.n).toBe(50);
    expect(eth.isWarmup).toBe(false);
    expect(btc.isWarmup).toBe(false);
    // Tercile bounds derived from each symbol's own distribution should
    // exist independently (pooling would produce one shared boundary).
    expect(eth.lower).not.toBeNull();
    expect(btc.lower).not.toBeNull();
  });
});

describe('TrajectoryObserver — warmup contract', () => {
  it('isWarmup true while n < 30 ticks for that symbol', () => {
    for (let i = 0; i < 5; i++) {
      observeAndClassify('TEST_WARMUP', bullishBasin());
    }
    const snap = observerSnapshot('TEST_WARMUP');
    expect(snap.isWarmup).toBe(true);
    expect(snap.n).toBe(5);
    expect(snap.lower).toBeNull();
    expect(snap.upper).toBeNull();
  });

  it('isWarmup false once n >= 30 ticks for that symbol', () => {
    for (let i = 0; i < 30; i++) {
      observeAndClassify('TEST_WARM', bullishBasin());
    }
    const snap = observerSnapshot('TEST_WARM');
    expect(snap.isWarmup).toBe(false);
    expect(snap.n).toBe(30);
    expect(snap.lower).not.toBeNull();
    expect(snap.upper).not.toBeNull();
  });

  it('classifyRegime under warmup uses legacy thresholds for back-compat', () => {
    // 16-bar bullish history is too small to warm a 30-tick observer,
    // but bullish classification must still emerge via the legacy
    // fall-through (which uses TREND_THRESHOLD=0.025 / CHOP_THRESHOLD=0.55).
    const hist = Array.from({ length: 16 }, () => bullishBasin());
    const r = classifyRegime('TEST_FALLTHROUGH', hist);
    expect(r.regime).toBe('TREND_UP');
  });
});
