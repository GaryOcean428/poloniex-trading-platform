/**
 * Commit 5 — promotion engine pure-function tests.
 *
 * Covers:
 *   - promotionGates: backtest/paper/live-sizing
 *   - demotionPolicy: rolling DD, oscillation, recalibration limits
 *   - thompsonBandit: Beta sampling, outcome application, class sampling
 *   - slotAllocator: reserved + floating pool admission
 */

import { describe, expect, it } from 'vitest';
import {
  BACKTEST_MIN_PROFIT_FACTOR,
  BACKTEST_MIN_TRADES,
  LIVE_SIZING_USDT,
  OOS_MIN_PROFIT_FACTOR,
  PAPER_MAX_SINGLE_LOSS,
  PAPER_MIN_TRADES,
  computeLiveSizingTier,
  evaluateBacktestGate,
  evaluatePaperGate,
  getLiveSizeForTier,
} from '../promotionGates.js';
import {
  OSCILLATION_PROMOTION_CYCLES,
  RECALIBRATION_LIMIT_PER_30_DAYS,
  ROLLING_DEMOTION_THRESHOLD,
  ROLLING_DEMOTION_WINDOW,
  evaluateOscillationRetirement,
  evaluateRecalibrationLimitRetirement,
  evaluateRollingDrawdownDemotion,
} from '../demotionPolicy.js';
import {
  ALL_STRATEGY_CLASSES,
  DEFAULT_BANDIT_COUNTER,
  applyOutcome,
  sampleBestClass,
  sampleBeta,
  type BanditCounter,
  type StrategyClass,
} from '../thompsonBandit.js';
import {
  FLOATING_SLOTS,
  SLOTS_PER_CLASS,
  TOTAL_SLOTS,
  tryAdmitStrategy,
  withAdmittedStrategy,
  type SlotOccupancy,
} from '../slotAllocator.js';

// ───────── promotionGates ─────────

describe('evaluateBacktestGate', () => {
  const passingInSample = {
    totalTrades: 15,
    sharpe: 1.2,
    sortino: 1.8,
    calmar: 2.5,
    profitFactor: 1.6,
    maxDrawdown: 0.12,
  };
  const passingOos = { profitFactor: 1.4 };

  it('passes a strategy that clears every threshold in both windows', () => {
    expect(evaluateBacktestGate(passingInSample, passingOos).allowed).toBe(true);
  });

  it(`rejects when trades < ${BACKTEST_MIN_TRADES}`, () => {
    const d = evaluateBacktestGate({ ...passingInSample, totalTrades: 5 }, passingOos);
    expect(d.allowed).toBe(false);
    expect(d.failingMetrics?.[0]).toMatch(/totalTrades/);
  });

  it('requires an OOS window — missing OOS is a failure', () => {
    const d = evaluateBacktestGate(passingInSample, null);
    expect(d.allowed).toBe(false);
    expect(d.failingMetrics?.some((m) => /oos/i.test(m))).toBe(true);
  });

  it(`rejects when oos profit factor < ${OOS_MIN_PROFIT_FACTOR}`, () => {
    const d = evaluateBacktestGate(passingInSample, { profitFactor: 0.9 });
    expect(d.allowed).toBe(false);
  });

  it('aggregates multiple failures rather than short-circuiting', () => {
    const d = evaluateBacktestGate(
      { ...passingInSample, sharpe: 0.3, profitFactor: 1.0, maxDrawdown: 0.25 },
      passingOos,
    );
    expect(d.failingMetrics?.length).toBeGreaterThanOrEqual(3);
  });

  it(`constant check: BACKTEST_MIN_PROFIT_FACTOR stays ≥ 1.3 (relaxed from 1.5 for first-pass viability)`, () => {
    expect(BACKTEST_MIN_PROFIT_FACTOR).toBeGreaterThanOrEqual(1.3);
  });
});

describe('evaluatePaperGate', () => {
  const passing = {
    totalTrades: 25,
    cumulativePnl: 3,
    largestSingleLossPct: 0.03,
    rolling20TradeMaxDrawdown: 0.05,
    profitablePaperTrades: 18,
  };

  it('passes a strategy that clears every paper threshold', () => {
    expect(evaluatePaperGate(passing).allowed).toBe(true);
  });

  it(`rejects when paper trades < ${PAPER_MIN_TRADES}`, () => {
    expect(evaluatePaperGate({ ...passing, totalTrades: 3 }).allowed).toBe(false);
  });

  it('rejects on any single loss over the 5% cap', () => {
    expect(
      evaluatePaperGate({ ...passing, largestSingleLossPct: 0.06 }).allowed,
    ).toBe(false);
    expect(PAPER_MAX_SINGLE_LOSS).toBeLessThanOrEqual(0.05);
  });

  it('rejects on flat or negative cumulative PnL', () => {
    expect(evaluatePaperGate({ ...passing, cumulativePnl: 0 }).allowed).toBe(false);
    expect(evaluatePaperGate({ ...passing, cumulativePnl: -1 }).allowed).toBe(false);
  });
});

describe('computeLiveSizingTier + getLiveSizeForTier', () => {
  it('starts at tier 1 immediately on live promotion', () => {
    expect(computeLiveSizingTier({ profitableLiveTrades: 0 })).toBe(1);
    expect(getLiveSizeForTier(1)).toBe(2);
  });

  it('advances one tier per +10 profitable trades', () => {
    expect(computeLiveSizingTier({ profitableLiveTrades: 10 })).toBe(2);
    expect(computeLiveSizingTier({ profitableLiveTrades: 20 })).toBe(3);
    expect(computeLiveSizingTier({ profitableLiveTrades: 30 })).toBe(4);
    expect(computeLiveSizingTier({ profitableLiveTrades: 40 })).toBe(5);
  });

  it('caps at tier 5', () => {
    expect(computeLiveSizingTier({ profitableLiveTrades: 1000 })).toBe(5);
  });

  it('sizes ladder matches plan: $2 → $3 → $5 → $8 → $12', () => {
    expect([1, 2, 3, 4, 5].map(getLiveSizeForTier)).toEqual([2, 3, 5, 8, 12]);
    // Verify the constants haven't drifted.
    expect(LIVE_SIZING_USDT[1]).toBe(2);
    expect(LIVE_SIZING_USDT[5]).toBe(12);
  });
});

// ───────── demotionPolicy ─────────

describe('evaluateRollingDrawdownDemotion', () => {
  const makeTrade = (pnl: number, margin = 10) => ({ realisedPnl: pnl, marginCommitted: margin });

  it(`does not demote before ${ROLLING_DEMOTION_WINDOW} trades accumulate`, () => {
    const trades = Array.from({ length: 3 }, () => makeTrade(-5));
    expect(evaluateRollingDrawdownDemotion(trades).demote).toBe(false);
  });

  it('demotes when rolling window PnL / margin ≤ threshold', () => {
    // 5 × −1 / (5 × 10) = −10% → triggers
    const losers = Array.from({ length: 5 }, () => makeTrade(-1));
    const d = evaluateRollingDrawdownDemotion(losers);
    expect(d.demote).toBe(true);
    expect(d.triggeringDrawdownPct).toBeLessThanOrEqual(ROLLING_DEMOTION_THRESHOLD);
  });

  it('does not demote a profitable window', () => {
    const winners = Array.from({ length: 5 }, () => makeTrade(5));
    expect(evaluateRollingDrawdownDemotion(winners).demote).toBe(false);
  });

  it('evaluates only the most recent window', () => {
    const earlyLosers = Array.from({ length: 5 }, () => makeTrade(-5));
    const recentWinners = Array.from({ length: 5 }, () => makeTrade(5));
    expect(
      evaluateRollingDrawdownDemotion([...earlyLosers, ...recentWinners]).demote,
    ).toBe(false);
  });
});

describe('evaluateOscillationRetirement', () => {
  it('does not retire before enough cycles accumulate', () => {
    expect(
      evaluateOscillationRetirement([{ realisedPnl: -5 }, { realisedPnl: -5 }]).retire,
    ).toBe(false);
  });

  it(`retires when last ${OSCILLATION_PROMOTION_CYCLES} cycles sum ≤ 0`, () => {
    const d = evaluateOscillationRetirement([
      { realisedPnl: -3 },
      { realisedPnl: -2 },
      { realisedPnl: -1 },
    ]);
    expect(d.retire).toBe(true);
  });

  it('does not retire if recent cycles are net-positive', () => {
    expect(
      evaluateOscillationRetirement([
        { realisedPnl: -3 },
        { realisedPnl: -2 },
        { realisedPnl: 10 },
      ]).retire,
    ).toBe(false);
  });
});

describe('evaluateRecalibrationLimitRetirement', () => {
  const now = new Date('2026-04-17T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  it(`retires after > ${RECALIBRATION_LIMIT_PER_30_DAYS} demotions in 30 days`, () => {
    const recent = [daysAgo(1), daysAgo(5), daysAgo(10), daysAgo(20)];
    expect(evaluateRecalibrationLimitRetirement(recent, now).retire).toBe(true);
  });

  it('ignores demotions older than 30 days', () => {
    const mixed = [daysAgo(31), daysAgo(32), daysAgo(33), daysAgo(1)];
    expect(evaluateRecalibrationLimitRetirement(mixed, now).retire).toBe(false);
  });
});

// ───────── thompsonBandit ─────────

describe('sampleBeta', () => {
  it('returns a value in [0, 1]', () => {
    for (let i = 0; i < 50; i++) {
      const s = sampleBeta(2, 5);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('has higher mean when wins dominate', () => {
    const samples = Array.from({ length: 500 }, () => sampleBeta(50, 5));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeGreaterThan(0.8);
  });

  it('has lower mean when losses dominate', () => {
    const samples = Array.from({ length: 500 }, () => sampleBeta(5, 50));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeLessThan(0.2);
  });
});

describe('applyOutcome', () => {
  it('weights live wins 10× more than paper wins', () => {
    const base = { ...DEFAULT_BANDIT_COUNTER };
    const afterLive = applyOutcome(base, 'live', 1);
    const afterPaper = applyOutcome(base, 'paper', 1);
    expect(afterLive.wins - base.wins).toBeCloseTo(1.0, 6);
    expect(afterPaper.wins - base.wins).toBeCloseTo(0.1, 6);
  });

  it('routes non-positive rewards to losses', () => {
    const after = applyOutcome({ ...DEFAULT_BANDIT_COUNTER }, 'live', -1);
    expect(after.losses).toBeCloseTo(2.0, 6);
    expect(after.wins).toBeCloseTo(1.0, 6);
  });
});

describe('sampleBestClass', () => {
  it('preferentially returns the class with the strongest posterior', () => {
    const counters = new Map<StrategyClass, BanditCounter>();
    counters.set('scalping', { wins: 100, losses: 1 });
    for (const klass of ALL_STRATEGY_CLASSES) {
      if (klass !== 'scalping') counters.set(klass, DEFAULT_BANDIT_COUNTER);
    }

    let scalpingHits = 0;
    for (let i = 0; i < 200; i++) {
      if (sampleBestClass(counters) === 'scalping') scalpingHits++;
    }
    expect(scalpingHits).toBeGreaterThan(150); // ≥75% — bandit should strongly favour
  });
});

// ───────── slotAllocator ─────────

describe('slotAllocator', () => {
  const emptyOccupancy: SlotOccupancy = { countsByClass: new Map() };

  it('exposes a 12-slot total pool (10 reserved + 2 floating)', () => {
    expect(TOTAL_SLOTS).toBe(SLOTS_PER_CLASS * 5 + FLOATING_SLOTS);
  });

  it('admits the first 2 strategies of any class into reserved seats', () => {
    let occ = emptyOccupancy;
    const a1 = tryAdmitStrategy('scalping', occ);
    expect(a1.admitted).toBe(true);
    expect(a1.bucket).toBe('reserved');
    occ = withAdmittedStrategy('scalping', occ);

    const a2 = tryAdmitStrategy('scalping', occ);
    expect(a2.bucket).toBe('reserved');
  });

  it('uses floating slots when a class exceeds its reserved seats', () => {
    let occ = emptyOccupancy;
    for (let i = 0; i < 2; i++) occ = withAdmittedStrategy('scalping', occ);
    const a3 = tryAdmitStrategy('scalping', occ);
    expect(a3.admitted).toBe(true);
    expect(a3.bucket).toBe('floating');
  });

  it('blocks a class when its reserved are full AND floating are exhausted', () => {
    // Fill scalping up to its full 4 (2 reserved + 2 floating worth from scalping).
    let occ = emptyOccupancy;
    for (let i = 0; i < 4; i++) occ = withAdmittedStrategy('scalping', occ);
    const denied = tryAdmitStrategy('scalping', occ);
    expect(denied.admitted).toBe(false);
    expect(denied.reason).toMatch(/floating_full/);
  });

  it('preserves diversity — one hot class cannot starve others', () => {
    // Scalping consumes all its reserved + both floating. Trend still gets reserved.
    let occ = emptyOccupancy;
    for (let i = 0; i < 4; i++) occ = withAdmittedStrategy('scalping', occ);
    const trendAdmit = tryAdmitStrategy('trend_following', occ);
    expect(trendAdmit.admitted).toBe(true);
    expect(trendAdmit.bucket).toBe('reserved');
  });

  it('rejects when the pool is fully saturated', () => {
    // Populate every class's reserved seats + both floating slots.
    let occ = emptyOccupancy;
    for (const klass of ALL_STRATEGY_CLASSES) {
      for (let i = 0; i < SLOTS_PER_CLASS; i++) occ = withAdmittedStrategy(klass, occ);
    }
    // Use floating on scalping.
    for (let i = 0; i < FLOATING_SLOTS; i++) occ = withAdmittedStrategy('scalping', occ);

    const denied = tryAdmitStrategy('momentum', occ);
    expect(denied.admitted).toBe(false);
    expect(denied.reason).toBe('pool_full');
  });
});
