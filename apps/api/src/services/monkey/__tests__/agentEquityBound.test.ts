/**
 * agentEquityBound.test.ts — verifies the pure helpers that bound
 * an agent's cumulative open margin to its Arbiter allocation share.
 */
import { describe, it, expect } from 'vitest';
import {
  computeAgentHeadroom,
  clampSizeToHeadroom,
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
