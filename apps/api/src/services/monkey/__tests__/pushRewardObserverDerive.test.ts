/**
 * pushRewardObserverDerive.test.ts — pins the 2026-05-25 reward-magnitude
 * observer-derive PR + the 2026-05-27 observer-Fibonacci gate.
 *
 * Pre-strip: magic input scales 1.5/0.5/1.0/2.0 on tanh, magic /10 on
 * kappaProxim. Post-strip: pnlFrac normalized against the kernel's own
 * rolling pnlFraction distribution; kappaProxim width derives from
 * rolling kappa-at-exit stddev.
 *
 * Output caps (0.5/0.3/0.15/0.1) stay as STRUCTURAL design — they
 * encode "how much each chemical can lift" PER COEFFICIENT-UNIT and
 * are multiplied by the observer Fibonacci coefficient (1..34) to
 * produce the per-event delta.
 *
 * Legacy hardcoded 1% noise floor was retired with the deletion of
 * fibonacciRewardCoefficient — observer-derived gate now sets the
 * threshold from the kernel's own pnlFracHistory distribution.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

// Mock the env config so importing loop.ts (→ encryptionService → env)
// doesn't blow up on missing DATABASE_URL / JWT_SECRET in the test
// environment. Mirrors perAgentNC.test.ts.
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 8765,
    DATABASE_URL: 'postgresql://test:5432/test',
    JWT_SECRET: 'test-jwt-secret-32-characters-xxxxxxxxxx',
  },
}));
vi.mock('../../../db/connection.js', () => ({
  pool: { query: vi.fn() },
}));

import { MonkeyKernel } from '../loop.js';

/**
 * Seed a symbol's pnlFracHistory directly on the kernel's private
 * symbolStates map so the observer gate has data to z-score against.
 * The regular pushReward path requires the symbol to already exist in
 * symbolStates (populated by tick/subscribe paths the unit test doesn't
 * run), so we inject the entry directly.
 */
function seedSymbolHistory(k: MonkeyKernel, symbol: string, history: number[]): void {
  const symbolStates = (k as unknown as { symbolStates: Map<string, { pnlFracHistory: number[] }> }).symbolStates;
  symbolStates.set(symbol, { pnlFracHistory: [...history] } as unknown as never);
}

describe('pushReward observer-derive — pnlFrac z-score normalization', () => {
  let k: MonkeyKernel;

  beforeEach(() => {
    k = new MonkeyKernel({ instanceId: 'test-rew-obs', timeframe: '5m', tickMs: 30_000 });
  });

  afterEach(() => {
    // Test kernel has no background timers in this path.
  });

  function lastReward(): { dopamineDelta: number; serotoninDelta: number; endorphinDelta: number; pnlFraction: number } {
    const queue = (k as unknown as { pendingRewards: Array<{ dopamineDelta: number; serotoninDelta: number; endorphinDelta: number; pnlFraction: number }> }).pendingRewards;
    return queue[queue.length - 1]!;
  }

  it('cold start (no history) → gentle positive ramp, coeff=1', () => {
    // Observer-derived gate (post-#977 / 2026-05-27): cold-start returns
    // coeff=1 for any positive pnlFrac (P1 gentle ramp-up while the
    // kernel builds enough samples to z-score against its own
    // distribution). The legacy hardcoded 1% floor → Fibonacci tier
    // mapping was retired with the deletion of fibonacciRewardCoefficient.
    k.pushReward({ source: 'test', realizedPnlUsdt: 0.10, marginUsdt: 1, agent: 'K' });
    const r = lastReward();
    expect(r.pnlFraction).toBeCloseTo(0.10, 6);
    // Cold start: dopamine = tanh(pnlFracNormalized) × 0.5 × 1
    expect(r.dopamineDelta).toBeGreaterThan(0);
    expect(r.dopamineDelta).toBeLessThanOrEqual(0.5);
  });

  it('after several wins, dopamine z-normalizes against rolling stddev', () => {
    // Seed history with 10 wins of ~5% ROI
    for (let i = 0; i < 10; i++) {
      k.pushReward({ source: 'seed', realizedPnlUsdt: 0.05, marginUsdt: 1, agent: 'K' });
    }
    // Now a 10% win — should be "above average" relative to the
    // kernel's own observed distribution → higher dopamine.
    k.pushReward({ source: 'bigger', realizedPnlUsdt: 0.10, marginUsdt: 1, agent: 'K' });
    const big = lastReward();
    // Big win produces higher dopamine than the seeded "typical" win
    expect(big.dopamineDelta).toBeGreaterThan(Math.tanh(0.05) * 0.5);
  });

  it('per-event channel deltas scale with the observer Fibonacci coefficient (post-#977 — observer-derived, expressive at high z)', () => {
    // Observer-derived gate (2026-05-27): seed the SYMBOL's history
    // directly (regular pushReward path needs symbolStates entry pre-
    // populated). Outlier pnlFrac=100 z-scores well above MAD → top tier.
    const symbol = 'BTC_USDT_PERP';
    const history: number[] = [];
    for (let i = 0; i < 8; i++) history.push(0.003 + (i % 5) * 0.001);
    seedSymbolHistory(k, symbol, history);
    k.pushReward({ source: 'huge', symbol, realizedPnlUsdt: 100, marginUsdt: 1, agent: 'K' });
    const r = lastReward();
    expect(r.dopamineDelta).toBeGreaterThan(0.5);
    expect(r.dopamineDelta).toBeLessThanOrEqual(0.5 * 34);
  });

  it('serotonin per-event delta scales with observer coefficient at high z', () => {
    const symbol = 'BTC_USDT_PERP';
    const history: number[] = [];
    for (let i = 0; i < 8; i++) history.push(0.003 + (i % 5) * 0.001);
    seedSymbolHistory(k, symbol, history);
    k.pushReward({ source: 'huge', symbol, realizedPnlUsdt: 100, marginUsdt: 1, agent: 'K' });
    const r = lastReward();
    expect(r.serotoninDelta).toBeGreaterThan(0.15);
    expect(r.serotoninDelta).toBeLessThanOrEqual(0.15 * 34);
  });

  it('endorphin per-event delta scales with observer coefficient × κ-prox at high z', () => {
    const symbol = 'BTC_USDT_PERP';
    const history: number[] = [];
    for (let i = 0; i < 8; i++) history.push(0.003 + (i % 5) * 0.001);
    seedSymbolHistory(k, symbol, history);
    k.pushReward({ source: 'huge', symbol, realizedPnlUsdt: 100, marginUsdt: 1, kappaAtExit: 64, agent: 'K' });
    const r = lastReward();
    expect(r.endorphinDelta).toBeGreaterThan(0.3);
    expect(r.endorphinDelta).toBeLessThanOrEqual(0.3 * 34);
  });

  it('sub-1% wins on cold start emit GENTLE positive chemistry (observer ramp-up)', () => {
    // Post-#977 doctrine inversion: the legacy 1% noise-floor never
    // fired at real kernel scale (~0.04% MAD on today's regime; 0/925
    // tier-1 firings in 2026-05-27 audit). Observer-derived gate
    // returns coeff=1 during cold-start so the kernel gets a learning
    // signal from real-scale wins instead of being structurally muted.
    // After enough history, the gate z-scores against the kernel's
    // own distribution — sub-median wins still emit zero.
    k.pushReward({ source: 'noise', realizedPnlUsdt: 0.005, marginUsdt: 1, agent: 'K' });
    const r = lastReward();
    expect(r.dopamineDelta).toBeGreaterThan(0);
    expect(r.dopamineDelta).toBeLessThanOrEqual(0.5);
  });

  it('loss produces negative dopamine bounded by 0.1 cap', () => {
    k.pushReward({ source: 'loss', realizedPnlUsdt: -10, marginUsdt: 1, agent: 'K' });
    const r = lastReward();
    expect(r.dopamineDelta).toBeLessThan(0);
    expect(Math.abs(r.dopamineDelta)).toBeLessThanOrEqual(0.1);
  });

  it('losses produce zero serotonin (wins-only path)', () => {
    k.pushReward({ source: 'loss', realizedPnlUsdt: -10, marginUsdt: 1, agent: 'K' });
    const r = lastReward();
    expect(r.serotoninDelta).toBe(0);
  });

  it('losses produce zero endorphins (wins-only path)', () => {
    k.pushReward({ source: 'loss', realizedPnlUsdt: -10, marginUsdt: 1, kappaAtExit: 64, agent: 'K' });
    const r = lastReward();
    expect(r.endorphinDelta).toBe(0);
  });
});

describe('pushReward observer-derive — outlier robustness (MAD)', () => {
  let k: MonkeyKernel;

  beforeEach(() => {
    k = new MonkeyKernel({ instanceId: 'test-rew-outlier', timeframe: '5m', tickMs: 30_000 });
  });

  function lastReward(): { dopamineDelta: number; pnlFraction: number } {
    const queue = (k as unknown as { pendingRewards: Array<{ dopamineDelta: number; pnlFraction: number }> }).pendingRewards;
    return queue[queue.length - 1]!;
  }

  it('outlier win does NOT suppress chemistry response to subsequent normal losses', () => {
    // Production regression 2026-05-25: a single +$78 outlier win
    // inflated stddev(pnlFraction) ~5×, suppressing chemistry response
    // to subsequent normal-magnitude losses (kernel couldn't "feel"
    // -$5 losses as bad). MAD doesn't blow up under outliers.
    //
    // Seed 6 typical wins/losses around 1% pnlFrac.
    for (let i = 0; i < 6; i++) {
      k.pushReward({
        source: 'seed',
        realizedPnlUsdt: i % 2 === 0 ? 0.01 : -0.01,
        marginUsdt: 1,
        agent: 'K',
      });
    }
    // Inject a massive outlier win (+50% pnlFrac, like the live +$78).
    k.pushReward({ source: 'outlier-win', realizedPnlUsdt: 0.5, marginUsdt: 1, agent: 'K' });
    // Now a normal-magnitude loss (-2% pnlFrac).
    k.pushReward({ source: 'normal-loss', realizedPnlUsdt: -0.02, marginUsdt: 1, agent: 'K' });
    const lossDop = lastReward().dopamineDelta;
    // Loss should produce measurable negative dopamine — NOT crushed to
    // near-zero by the outlier-inflated normalizer.
    expect(Math.abs(lossDop)).toBeGreaterThan(0.01);
  });

  it('MAD normalization keeps chemistry response stable across outlier injection', () => {
    // Build a baseline: 6 small wins of 1% pnlFrac.
    for (let i = 0; i < 6; i++) {
      k.pushReward({ source: 'pre', realizedPnlUsdt: 0.01, marginUsdt: 1, agent: 'K' });
    }
    // Record dopamine for a typical 1% win pre-outlier.
    k.pushReward({ source: 'typical-pre', realizedPnlUsdt: 0.01, marginUsdt: 1, agent: 'K' });
    const dopPre = lastReward().dopamineDelta;
    // Inject outlier.
    k.pushReward({ source: 'outlier', realizedPnlUsdt: 1.0, marginUsdt: 1, agent: 'K' });
    // Same typical 1% win post-outlier — dopamine should be similar
    // (MAD didn't move; under stddev it would be much smaller).
    k.pushReward({ source: 'typical-post', realizedPnlUsdt: 0.01, marginUsdt: 1, agent: 'K' });
    const dopPost = lastReward().dopamineDelta;
    // Ratio should be close to 1 — outlier didn't suppress response.
    // (Under stddev the ratio would be ~5-10×.)
    expect(dopPost).toBeGreaterThan(dopPre * 0.5);
  });
});

describe('pushReward observer-derive — kappaProxim from rolling kappa stddev', () => {
  let k: MonkeyKernel;

  beforeEach(() => {
    k = new MonkeyKernel({ instanceId: 'test-kappa-obs', timeframe: '5m', tickMs: 30_000 });
  });

  function lastReward(): { endorphinDelta: number } {
    const queue = (k as unknown as { pendingRewards: Array<{ endorphinDelta: number }> }).pendingRewards;
    return queue[queue.length - 1]!;
  }

  it('κ at κ* (=64) produces full endorphins (proximity = 1)', () => {
    // Seed kappa history near 64 so the rolling stddev is small but
    // non-degenerate.
    for (let i = 0; i < 6; i++) {
      k.pushReward({
        source: 'seed',
        realizedPnlUsdt: 0.05,
        marginUsdt: 1,
        kappaAtExit: 63 + (i % 2),  // alternating 63/64
        agent: 'K',
      });
    }
    // Now a win exactly at κ*.
    k.pushReward({
      source: 'peak',
      realizedPnlUsdt: 0.05,
      marginUsdt: 1,
      kappaAtExit: 64,
      agent: 'K',
    });
    const peak = lastReward();
    expect(peak.endorphinDelta).toBeGreaterThan(0);
  });

  it('κ far from κ* dampens endorphins relative to κ at κ*', () => {
    // Seed history
    for (let i = 0; i < 6; i++) {
      k.pushReward({
        source: 'seed',
        realizedPnlUsdt: 0.05,
        marginUsdt: 1,
        kappaAtExit: 60 + (i % 3),
        agent: 'K',
      });
    }
    // κ at κ*
    k.pushReward({
      source: 'at-star',
      realizedPnlUsdt: 0.05,
      marginUsdt: 1,
      kappaAtExit: 64,
      agent: 'K',
    });
    const at = lastReward();
    // κ far from κ*
    k.pushReward({
      source: 'far',
      realizedPnlUsdt: 0.05,
      marginUsdt: 1,
      kappaAtExit: 80,
      agent: 'K',
    });
    const far = lastReward();
    expect(far.endorphinDelta).toBeLessThan(at.endorphinDelta);
  });

  it('kappaAtExit missing → kappaProxim falls to 0.5 (legacy fallback preserved)', () => {
    k.pushReward({
      source: 'no-kappa',
      realizedPnlUsdt: 0.05,
      marginUsdt: 1,
      // kappaAtExit omitted
      agent: 'K',
    });
    const r = lastReward();
    // endorphin = tanh(pnlFrac) × 0.3 × 0.5 = positive
    expect(r.endorphinDelta).toBeGreaterThan(0);
  });
});
