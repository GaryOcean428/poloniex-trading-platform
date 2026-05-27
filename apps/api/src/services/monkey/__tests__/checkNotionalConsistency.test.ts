/**
 * checkNotionalConsistency.test.ts — Finding 1 / LIVED ONLY 5.
 *
 * Pins the centralized notional self-consistency assertion. Any new
 * row entering `autonomous_trades` must have `entry_price * quantity`
 * match the originating order's declared notional within 0.1%.
 * Mismatch = unit error (contracts vs base-asset) = phantom-PnL root cause.
 */

import { describe, it, expect } from 'vitest';
import { checkNotionalConsistency } from '../safePnlSql.js';

describe('checkNotionalConsistency — base case', () => {
  it('exact match → consistent', () => {
    const c = checkNotionalConsistency(2000, 0.5, 1000);
    expect(c.consistent).toBe(true);
    expect(c.rowNotional).toBe(1000);
    expect(c.divergencePct).toBe(0);
  });

  it('within 0.099% tolerance → consistent (slippage band)', () => {
    // 1000 vs 999.05 = 0.095% — well inside tolerance
    const c = checkNotionalConsistency(2000, 0.499525, 1000);
    expect(c.consistent).toBe(true);
    expect(c.divergencePct).toBeLessThan(0.001);
  });

  it('exactly at 0.1% boundary → still consistent (≤ tolerance)', () => {
    // 2000 × 0.4995 = 999.0 → divergence = 0.001 (exactly at boundary)
    const c = checkNotionalConsistency(2000, 0.4995, 1000);
    expect(c.divergencePct).toBeCloseTo(0.001, 5);
    expect(c.consistent).toBe(true);
  });

  it('above 0.101% → MISMATCH (out of tolerance)', () => {
    // 1000 vs 998.5 = 0.15%
    const c = checkNotionalConsistency(2000, 0.49925, 1000);
    expect(c.consistent).toBe(false);
    expect(c.diagnostic).toMatch(/MISMATCH/);
  });
});

describe('checkNotionalConsistency — phantom-PnL root cause (contracts vs base-asset)', () => {
  it('ETH 100× contracts inflation → MISMATCH', () => {
    // Bug: kernel stored 13 contracts instead of 0.13 ETH (lot size 0.01 ETH/contract)
    // entry_price=2080, "quantity"=13 (contracts) → rowNotional = $27,040
    // expected notional from order = $270.4
    // Ratio: 100×
    const c = checkNotionalConsistency(2080, 13, 270.4);
    expect(c.consistent).toBe(false);
    expect(c.divergencePct).toBeGreaterThan(50);  // 100× → 99×
    expect(c.diagnostic).toMatch(/unit mismatch/);
  });

  it('BTC 1000× contracts inflation → MISMATCH', () => {
    // BTC lot size 0.001 → if 4 contracts stored vs 0.004 BTC: 1000× inflation
    const c = checkNotionalConsistency(80000, 4, 320);
    expect(c.consistent).toBe(false);
    expect(c.divergencePct).toBeGreaterThan(900);
    expect(c.diagnostic).toMatch(/unit mismatch/);
  });

  it('user incident: +$315 phantom on $1.03 real (~300× ratio)', () => {
    // Real notional was ~$210 (entry 2080 × 0.1 ETH); kernel-written stored
    // raw contracts as base-asset, blowing up notional ~300×.
    const c = checkNotionalConsistency(2080, 30, 210);  // 30 cont stored as base
    expect(c.consistent).toBe(false);
    expect(c.divergencePct).toBeGreaterThan(200);
  });
});

describe('checkNotionalConsistency — fall-open boundary cases', () => {
  it('expectedNotional = 0 → consistent (no expected → assertion bypassed)', () => {
    // Legacy callers that don't yet thread expected notional fall open
    // so they keep working until threaded. Live INSERT paths MUST thread
    // a real value; this is for boundary code only.
    const c = checkNotionalConsistency(2000, 0.5, 0);
    expect(c.consistent).toBe(true);
    expect(c.diagnostic).toMatch(/no expected notional/);
  });

  it('expectedNotional < 0 → fall-open', () => {
    expect(checkNotionalConsistency(2000, 0.5, -100).consistent).toBe(true);
  });

  it('expectedNotional NaN → fall-open', () => {
    expect(checkNotionalConsistency(2000, 0.5, NaN).consistent).toBe(true);
  });

  it('expectedNotional Infinity → fall-open', () => {
    expect(checkNotionalConsistency(2000, 0.5, Infinity).consistent).toBe(true);
  });
});

describe('checkNotionalConsistency — tolerance parameter', () => {
  it('tighter tolerance (0.05%) catches what default would allow', () => {
    // 0.08% drift — passes default 0.1%, fails 0.05%
    const c1 = checkNotionalConsistency(2000, 0.4996, 1000);
    expect(c1.consistent).toBe(true);
    const c2 = checkNotionalConsistency(2000, 0.4996, 1000, 0.0005);
    expect(c2.consistent).toBe(false);
  });

  it('looser tolerance (1%) tolerates what default rejects', () => {
    // 0.5% drift — fails default 0.1%, passes 1%
    const c1 = checkNotionalConsistency(2000, 0.4975, 1000);
    expect(c1.consistent).toBe(false);
    const c2 = checkNotionalConsistency(2000, 0.4975, 1000, 0.01);
    expect(c2.consistent).toBe(true);
  });
});
