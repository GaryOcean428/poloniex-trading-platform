/**
 * pushRewardObserverDerive.test.ts — pins the 2026-05-25 reward-magnitude
 * observer-derive PR.
 *
 * Pre-strip: magic input scales 1.5/0.5/1.0/2.0 on tanh, magic /10 on
 * kappaProxim. Post-strip: pnlFrac normalized against the kernel's own
 * rolling pnlFraction distribution; kappaProxim width derives from
 * rolling kappa-at-exit stddev.
 *
 * Output caps (0.5/0.3/0.15/0.1) stay as STRUCTURAL design — they
 * encode "how much each chemical can lift" and are documented in
 * pushReward.
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

// We test pushReward via a thin test harness — instantiating
// MonkeyKernel is heavy (it opens DB pool etc), so we use a private
// type-cast shim that calls pushReward then inspects pendingRewards.
import { MonkeyKernel } from '../loop.js';

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

  it('cold start (no history) → falls back to identity-on-pnlFrac × Ocean coefficient', () => {
    k.pushReward({ source: 'test', realizedPnlUsdt: 0.10, marginUsdt: 1, agent: 'K' });
    const r = lastReward();
    expect(r.pnlFraction).toBeCloseTo(0.10, 6);
    // Issue #948 (2026-05-26): pnlFrac=0.10 (10%) lands in the
    // Fibonacci [8%, 13%) bucket → oceanCoeff=8.
    // Expected: tanh(0.10) × 0.5 × 8 ≈ 0.399.
    expect(r.dopamineDelta).toBeCloseTo(Math.tanh(0.10) * 0.5 * 8, 4);
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

  it('per-event channel deltas scale with the Ocean Fibonacci coefficient (#948 — was capped, now expressive)', () => {
    // Issue #948 (2026-05-26): the pre-Ocean caps (0.5/0.15/0.3) were
    // PER-EVENT structural maxima. Post-Ocean, the per-event delta is
    // multiplied by the Fibonacci coefficient (1..34) so a 100×-margin
    // outlier win can deliver a strong learning signal in a single
    // event. The CONSUMER (clamp01 in the chemistry update path) is
    // what enforces the eventual [0, 1] saturation — not the per-event
    // delta. This is the canonical "reward the behaviour you want"
    // shape that Matrix tier-3 directed.
    //
    // Massive win (pnlFrac = 100/1 = 10000%) → Fibonacci cap = 34.
    // Expected dopamine delta ≈ tanh(saturated) × 0.5 × 34 ≈ 17.
    k.pushReward({ source: 'huge', realizedPnlUsdt: 100, marginUsdt: 1, agent: 'K' });
    const r = lastReward();
    // Coefficient cap is 34; tanh saturates to ~1; base scale 0.5 →
    // upper bound on the per-event dopamine delta is 0.5 × 34 = 17.
    expect(r.dopamineDelta).toBeGreaterThan(0.5);
    expect(r.dopamineDelta).toBeLessThanOrEqual(0.5 * 34);
  });

  it('serotonin per-event delta scales with Ocean coefficient (was capped at 0.15, now up to 0.15 × 34 = 5.1)', () => {
    k.pushReward({ source: 'huge', realizedPnlUsdt: 100, marginUsdt: 1, agent: 'K' });
    const r = lastReward();
    expect(r.serotoninDelta).toBeGreaterThan(0.15);
    expect(r.serotoninDelta).toBeLessThanOrEqual(0.15 * 34);
  });

  it('endorphin per-event delta scales with Ocean coefficient × κ-prox (was capped at 0.3, now up to 0.3 × 34 = 10.2)', () => {
    k.pushReward({ source: 'huge', realizedPnlUsdt: 100, marginUsdt: 1, kappaAtExit: 64, agent: 'K' });
    const r = lastReward();
    expect(r.endorphinDelta).toBeGreaterThan(0.3);
    expect(r.endorphinDelta).toBeLessThanOrEqual(0.3 * 34);
  });

  it('sub-1% wins emit ZERO positive chemistry (#948 noise-floor doctrine)', () => {
    // The substrate of #948: rewarding sub-1% wins teaches the kernel
    // to chase noise. The Ocean gate (fibonacciRewardCoefficient < 1%
    // returns 0) drops all positive deltas to zero in that band.
    k.pushReward({ source: 'noise', realizedPnlUsdt: 0.005, marginUsdt: 1, agent: 'K' });
    const r = lastReward();
    expect(r.dopamineDelta).toBe(0);
    expect(r.serotoninDelta).toBe(0);
    expect(r.endorphinDelta).toBe(0);
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
