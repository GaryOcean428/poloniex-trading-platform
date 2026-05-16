/**
 * perAgentNC.test.ts — per-agent neurochemistry reward isolation.
 *
 * Extends PR #700 (commit b39be2e) K-only filter to M/T/L. The invariant
 * under test:
 *
 *   decayedRewardSums(now, 'X') returns only the rewards tagged 'X'.
 *   decayedRewardSums(now)      returns the legacy shared-pool sum.
 *
 * Before this change, every pushReward in the close path was tagged 'K',
 * so M/T/L wins diluted K's dopamine even though K's executive was the
 * only consumer. After this change, M/T/L close paths push with their
 * own agent tag and the executive's K-only filter is honoured exactly.
 *
 * The test pushes one reward per agent (K, M, T, L), then asserts that
 * each agent's filtered view sees only its own reward, and the unfiltered
 * view pools all of them — matching the cross-agent telemetry surface
 * already used by `derivation.ncByAgent`.
 */
import { describe, expect, it, vi } from 'vitest';

// Mock the env config so importing loop.ts (→ encryptionService → env)
// doesn't blow up on missing DATABASE_URL / JWT_SECRET in the test
// environment. Mirrors the pattern in kellyCapLane.test.ts.
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 8765,
    DATABASE_URL: 'postgresql://test:5432/test',
    JWT_SECRET: 'test-jwt-secret-32-characters-xxxxxxxxxx',
  },
}));

// Pool is touched by loop.ts at module load via import chains, but
// pushReward + decayedRewardSums never call it — mock returns a stub
// so accidental queries surface as test failures, not silent hangs.
vi.mock('../../../db/connection.js', () => ({
  pool: { query: vi.fn() },
}));

describe('per-agent neurochemistry reward isolation', () => {
  it('isolates K rewards from M/T/L pool dilution (and vice versa)', async () => {
    const { MonkeyKernel } = await import('../loop.js');
    const kernel = new MonkeyKernel({
      instanceId: 'test-kernel-nc-mtl',
      symbols: ['BTC_USDT_PERP'],
      label: 'TestNCMTL',
    });

    // Push one reward per agent. Use the SAME pnl + margin so each agent
    // produces an identical dopamine delta — that way per-agent sums are
    // easy to reason about (each = the single-event delta).
    kernel.pushReward({
      source: 'test_close',
      symbol: 'BTC_USDT_PERP',
      realizedPnlUsdt: 1.0,    // 10 % win on 10 USDT margin
      marginUsdt: 10,
      agent: 'K',
    });
    kernel.pushReward({
      source: 'test_close',
      symbol: 'BTC_USDT_PERP',
      realizedPnlUsdt: 1.0,
      marginUsdt: 10,
      agent: 'M',
    });
    kernel.pushReward({
      source: 'test_close',
      symbol: 'BTC_USDT_PERP',
      realizedPnlUsdt: 1.0,
      marginUsdt: 10,
      agent: 'T',
    });
    kernel.pushReward({
      source: 'test_close',
      symbol: 'BTC_USDT_PERP',
      realizedPnlUsdt: 1.0,
      marginUsdt: 10,
      agent: 'L',
    });

    const now = Date.now();

    // K-only filter — sees exactly K's contribution (the legacy K-only
    // invariant from PR #700 must still hold). With all four events
    // pushed at ~now (decay ≈ 1), K's window equals one single-event
    // dop delta.
    const kOnly = kernel.decayedRewardSums(now, 'K');
    expect(kOnly.dopamine).toBeGreaterThan(0);

    // M, T, L filters — each must see its own event AND match K's
    // magnitude (same pnl + margin + age). This is the new property:
    // M's window is no longer diluted with K's + T's + L's events, and
    // K's window is no longer diluted with M's + T's + L's events.
    const mOnly = kernel.decayedRewardSums(now, 'M');
    const tOnly = kernel.decayedRewardSums(now, 'T');
    const lOnly = kernel.decayedRewardSums(now, 'L');

    expect(mOnly.dopamine).toBeCloseTo(kOnly.dopamine, 6);
    expect(tOnly.dopamine).toBeCloseTo(kOnly.dopamine, 6);
    expect(lOnly.dopamine).toBeCloseTo(kOnly.dopamine, 6);

    // Unfiltered (legacy shared-pool behaviour) — sums all four. Must
    // be ~4× any single agent's window. This is the telemetry path
    // (`derivation.ncByAgent` iterates per-agent for the dashboard
    // surface but kept unfiltered access for cross-agent diagnostics).
    const pooled = kernel.decayedRewardSums(now);
    expect(pooled.dopamine).toBeCloseTo(kOnly.dopamine * 4, 5);
    expect(pooled.serotonin).toBeCloseTo(kOnly.serotonin * 4, 5);
    expect(pooled.endorphin).toBeCloseTo(kOnly.endorphin * 4, 5);
  });

  it('cross-agent isolation: an M-only push does not leak into K/T/L windows', async () => {
    const { MonkeyKernel } = await import('../loop.js');
    const kernel = new MonkeyKernel({
      instanceId: 'test-kernel-nc-mtl-2',
      symbols: ['BTC_USDT_PERP'],
      label: 'TestNCMTL2',
    });

    kernel.pushReward({
      source: 'test_close',
      symbol: 'BTC_USDT_PERP',
      realizedPnlUsdt: 2.0,
      marginUsdt: 10,
      agent: 'M',
    });

    const now = Date.now();
    const kView = kernel.decayedRewardSums(now, 'K');
    const tView = kernel.decayedRewardSums(now, 'T');
    const lView = kernel.decayedRewardSums(now, 'L');
    const mView = kernel.decayedRewardSums(now, 'M');

    expect(kView.dopamine).toBe(0);
    expect(tView.dopamine).toBe(0);
    expect(lView.dopamine).toBe(0);
    expect(mView.dopamine).toBeGreaterThan(0);
  });

  it('back-compat: pushReward without an agent param defaults to K', async () => {
    const { MonkeyKernel } = await import('../loop.js');
    const kernel = new MonkeyKernel({
      instanceId: 'test-kernel-nc-mtl-3',
      symbols: ['BTC_USDT_PERP'],
      label: 'TestNCMTL3',
    });

    // Legacy callsite shape — no `agent` field. Must land in K's
    // window per the `agent ?? 'K'` default in pushReward, so any
    // pre-2026-05-16 deploys that race a fresh build see no behaviour
    // regression on K.
    kernel.pushReward({
      source: 'legacy_close',
      symbol: 'BTC_USDT_PERP',
      realizedPnlUsdt: 1.5,
      marginUsdt: 10,
    });

    const now = Date.now();
    expect(kernel.decayedRewardSums(now, 'K').dopamine).toBeGreaterThan(0);
    expect(kernel.decayedRewardSums(now, 'M').dopamine).toBe(0);
    expect(kernel.decayedRewardSums(now, 'T').dopamine).toBe(0);
    expect(kernel.decayedRewardSums(now, 'L').dopamine).toBe(0);
  });

  it('losing trades produce negative dopamine but stay agent-isolated', async () => {
    const { MonkeyKernel } = await import('../loop.js');
    const kernel = new MonkeyKernel({
      instanceId: 'test-kernel-nc-mtl-4',
      symbols: ['BTC_USDT_PERP'],
      label: 'TestNCMTL4',
    });

    // T loses, K wins — verify the T-only window shows the negative
    // mood dip and K's window shows the positive lift, neither bleeds.
    kernel.pushReward({
      source: 'test_close',
      symbol: 'BTC_USDT_PERP',
      realizedPnlUsdt: -1.0,
      marginUsdt: 10,
      agent: 'T',
    });
    kernel.pushReward({
      source: 'test_close',
      symbol: 'BTC_USDT_PERP',
      realizedPnlUsdt: 1.0,
      marginUsdt: 10,
      agent: 'K',
    });

    const now = Date.now();
    const kView = kernel.decayedRewardSums(now, 'K');
    const tView = kernel.decayedRewardSums(now, 'T');

    expect(kView.dopamine).toBeGreaterThan(0);   // K's win lifted K's dop
    expect(tView.dopamine).toBeLessThan(0);      // T's loss dipped T's dop
    expect(kView.dopamine).not.toBeCloseTo(tView.dopamine, 6);
  });
});
