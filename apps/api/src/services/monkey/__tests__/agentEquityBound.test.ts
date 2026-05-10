/**
 * agentEquityBound.test.ts — verifies the pure helpers that bound
 * an agent's cumulative open margin to its Arbiter allocation share.
 */
import { describe, it, expect } from 'vitest';
import {
  computeAgentHeadroom,
  clampSizeToHeadroom,
  computeAgentNotionalHeadroom,
  clampMarginToNotionalHeadroom,
} from '../agentEquityBound.js';

describe('computeAgentHeadroom', () => {
  it('returns full allocation when no margin is open', () => {
    expect(computeAgentHeadroom(50, 0)).toBe(50);
  });

  it('returns difference when within allocation', () => {
    expect(computeAgentHeadroom(50, 30)).toBe(20);
  });

  it('returns zero when fully committed', () => {
    expect(computeAgentHeadroom(50, 50)).toBe(0);
  });

  it('floors at zero when over-committed (does not return negative)', () => {
    expect(computeAgentHeadroom(50, 75)).toBe(0);
  });

  it('handles zero allocation', () => {
    expect(computeAgentHeadroom(0, 0)).toBe(0);
    expect(computeAgentHeadroom(0, 10)).toBe(0);
  });

  it('returns zero on NaN/Infinity inputs', () => {
    expect(computeAgentHeadroom(NaN, 10)).toBe(0);
    expect(computeAgentHeadroom(50, NaN)).toBe(0);
    expect(computeAgentHeadroom(Infinity, 10)).toBe(0);
  });
});

describe('clampSizeToHeadroom', () => {
  it('returns desired size when fully within headroom', () => {
    expect(clampSizeToHeadroom(20, 50)).toBe(20);
  });

  it('clamps to headroom when desired exceeds it', () => {
    expect(clampSizeToHeadroom(60, 50)).toBe(50);
  });

  it('returns zero when headroom is zero', () => {
    expect(clampSizeToHeadroom(20, 0)).toBe(0);
  });

  it('returns zero when headroom is negative', () => {
    expect(clampSizeToHeadroom(20, -5)).toBe(0);
  });

  it('returns zero when desired size is zero or negative', () => {
    expect(clampSizeToHeadroom(0, 50)).toBe(0);
    expect(clampSizeToHeadroom(-10, 50)).toBe(0);
  });

  it('returns zero on NaN/Infinity inputs', () => {
    expect(clampSizeToHeadroom(NaN, 50)).toBe(0);
    expect(clampSizeToHeadroom(20, NaN)).toBe(0);
    expect(clampSizeToHeadroom(20, Infinity)).toBe(0);
  });

  it('handles the live-tape scenario: M with $50 alloc and $40 already open', () => {
    // Arbiter says M has $50 this tick, $40 already deployed → $10 headroom.
    // Agent M's decide() wants to enter at $25 (its 0.5× allocation cap).
    // The clamp should reduce this to $10 — the last fit before the cap.
    const allocation = 50;
    const openMargin = 40;
    const headroom = computeAgentHeadroom(allocation, openMargin);
    expect(headroom).toBe(10);
    const desired = 25;
    expect(clampSizeToHeadroom(desired, headroom)).toBe(10);
  });
});

describe('computeAgentNotionalHeadroom', () => {
  it('returns full cap (allocation × ratio) when no notional is open', () => {
    expect(computeAgentNotionalHeadroom(50, 0, 4.0)).toBe(200);
  });

  it('default ratio is 4.0', () => {
    expect(computeAgentNotionalHeadroom(50, 0)).toBe(200);
  });

  it('subtracts open notional from the cap', () => {
    expect(computeAgentNotionalHeadroom(50, 50, 4.0)).toBe(150);
  });

  it('returns zero when fully committed', () => {
    expect(computeAgentNotionalHeadroom(50, 200, 4.0)).toBe(0);
  });

  it('floors at zero when over-committed', () => {
    expect(computeAgentNotionalHeadroom(50, 300, 4.0)).toBe(0);
  });

  it('returns zero on bad inputs', () => {
    expect(computeAgentNotionalHeadroom(0, 0, 4.0)).toBe(0);
    expect(computeAgentNotionalHeadroom(NaN, 0, 4.0)).toBe(0);
    expect(computeAgentNotionalHeadroom(50, -10, 4.0)).toBe(0);
    expect(computeAgentNotionalHeadroom(50, 0, 0)).toBe(0);
    expect(computeAgentNotionalHeadroom(50, 0, NaN)).toBe(0);
  });

  it('models the L stacking scenario: $20 alloc, $80 cap, 39 rows already at $3500 notional', () => {
    // L was stacking 39 BTC LONGs at 17.7× equity ($3500 cumulative
    // notional on a $200 account). Even with a 4× cap on its $20
    // arbiter allocation, headroom is $0 — the cap blocks new stacking.
    const allocation = 20;
    const openNotional = 3500;
    expect(computeAgentNotionalHeadroom(allocation, openNotional, 4.0)).toBe(0);
  });
});

describe('clampMarginToNotionalHeadroom', () => {
  it('returns desired margin when notional fits in headroom', () => {
    // 5 × 14 = 70 notional, well under 200 headroom
    expect(clampMarginToNotionalHeadroom(5, 14, 200)).toBe(5);
  });

  it('clamps margin so notional == headroom when proposed exceeds', () => {
    // 10 × 14 = 140 notional vs 70 headroom → margin scales to 70/14 = 5
    expect(clampMarginToNotionalHeadroom(10, 14, 70)).toBe(5);
  });

  it('returns zero when headroom is zero', () => {
    expect(clampMarginToNotionalHeadroom(5, 14, 0)).toBe(0);
  });

  it('returns zero when headroom is negative', () => {
    expect(clampMarginToNotionalHeadroom(5, 14, -10)).toBe(0);
  });

  it('returns zero when leverage is zero or negative', () => {
    expect(clampMarginToNotionalHeadroom(5, 0, 200)).toBe(0);
    expect(clampMarginToNotionalHeadroom(5, -1, 200)).toBe(0);
  });

  it('returns zero when desired margin is zero or negative', () => {
    expect(clampMarginToNotionalHeadroom(0, 14, 200)).toBe(0);
    expect(clampMarginToNotionalHeadroom(-5, 14, 200)).toBe(0);
  });

  it('exact-fit preserves desired margin', () => {
    // 10 × 14 = 140 == headroom 140 → no clamp
    expect(clampMarginToNotionalHeadroom(10, 14, 140)).toBe(10);
  });
});
