/**
 * safePnlSql.test.ts — pin the per-row pnl computation that replaces
 * caller-aggregate writes (#931).
 *
 * The bug being fixed: multiple close paths in loop.ts wrote
 * `pnl = $caller_value` where caller_value was the AGGREGATE across
 * all open rows for the kernel+symbol. When the aggregate landed on
 * a single row, the row's recorded pnl could be wildly inflated.
 *
 * The fix replaces those UPDATEs with SQL that computes pnl from the
 * row's own data: `quantity * (exit - entry) * sideSign`.
 *
 * These tests pin the TS-side formula. The SQL fragment is verified
 * by integration tests + the production audit query that re-runs
 * `|db_pnl - calc_pnl| > 0.5` against autonomous_trades.
 */

import { describe, expect, it } from 'vitest';

import { computeSafePnl, verifyPnl } from '../safePnlSql.js';

describe('computeSafePnl — per-row pnl arithmetic', () => {
  it('long winner: positive qty × positive price-delta', () => {
    expect(computeSafePnl(100, 110, 0.5, 'long')).toBeCloseTo(5.0, 6);
    expect(computeSafePnl(100, 110, 0.5, 'buy')).toBeCloseTo(5.0, 6);
  });

  it('long loser: negative price-delta yields negative pnl', () => {
    expect(computeSafePnl(100, 90, 0.5, 'long')).toBeCloseTo(-5.0, 6);
  });

  it('short winner: price-drop is profit', () => {
    expect(computeSafePnl(100, 90, 0.5, 'short')).toBeCloseTo(5.0, 6);
    expect(computeSafePnl(100, 90, 0.5, 'sell')).toBeCloseTo(5.0, 6);
  });

  it('short loser: price-rise is loss', () => {
    expect(computeSafePnl(100, 110, 0.5, 'short')).toBeCloseTo(-5.0, 6);
  });

  it('reproduces #931 phantom 1: BTC buy 0.018 @ 77584.55 → 77527.12', () => {
    // Production phantom 2026-05-25 16:16 — DB recorded +$315.21, true pnl −$1.03
    const pnl = computeSafePnl(77584.55, 77527.12, 0.018, 'buy');
    expect(pnl).toBeCloseTo(-1.034, 3);
  });

  it('reproduces #931 phantom 2: BTC buy 0.001 @ 76799.97 → 76802.55', () => {
    // Production phantom 2026-05-24 02:36 — DB recorded +$374.12, true pnl +$0.0026
    const pnl = computeSafePnl(76799.97, 76802.55, 0.001, 'buy');
    expect(pnl).toBeCloseTo(0.00258, 5);
  });

  it('flat trade: zero price-delta → zero pnl', () => {
    expect(Math.abs(computeSafePnl(100, 100, 1, 'long'))).toBe(0);
    expect(Math.abs(computeSafePnl(100, 100, 1, 'short'))).toBe(0);
  });

  it('zero quantity → zero pnl', () => {
    expect(computeSafePnl(100, 110, 0, 'long')).toBe(0);
  });
});

describe('verifyPnl — phantom detection', () => {
  it('clean within-tolerance match is not flagged', () => {
    const v = verifyPnl(5.05, 100, 110, 0.5, 'long'); // calc = 5.0; drift = $0.05
    expect(v.diverged).toBe(false);
    expect(v.isPhantomCandidate).toBe(false);
  });

  it('small drift > $0.50 flags diverged but not phantom', () => {
    const v = verifyPnl(7.0, 100, 110, 0.5, 'long'); // calc = 5.0; drift = $2.0
    expect(v.diverged).toBe(true);
    expect(v.isPhantomCandidate).toBe(false);
  });

  it('phantom-class divergence (> $5) flags both', () => {
    const v = verifyPnl(315.21, 77584.55, 77527.12, 0.018, 'buy');
    expect(v.diverged).toBe(true);
    expect(v.isPhantomCandidate).toBe(true);
    expect(v.divergenceAbs).toBeCloseTo(316.24, 1);
  });

  it('reports both provided and calculated for structured logging', () => {
    const v = verifyPnl(374.12, 76799.97, 76802.55, 0.001, 'buy');
    expect(v.provided).toBe(374.12);
    expect(v.calculated).toBeCloseTo(0.00258, 5);
    expect(v.isPhantomCandidate).toBe(true);
  });

  it('respects custom phantom threshold', () => {
    // With default $5 threshold, $3 drift is not phantom
    const v1 = verifyPnl(8.0, 100, 110, 0.5, 'long'); // drift = 3
    expect(v1.isPhantomCandidate).toBe(false);
    // With $1 threshold, same drift is phantom
    const v2 = verifyPnl(8.0, 100, 110, 0.5, 'long', 1);
    expect(v2.isPhantomCandidate).toBe(true);
  });
});

describe('regression: per-row arithmetic recovers from the aggregate-pnl bug', () => {
  // Simulates the bug scenario: kernel had two open rows (DCA stack),
  // aggregate pnl was -$50. Pre-fix path wrote aggregate to ONE row by
  // tradeId. Post-fix path computes each row's pnl from its own data.

  it('two DCA-stacked rows with different entries get correct per-row pnl', () => {
    const exitPrice = 100;
    // Row A: entered at 110 (above exit), qty 0.5, long — loss
    const aPnl = computeSafePnl(110, exitPrice, 0.5, 'long');
    // Row B: entered at 90 (below exit), qty 0.5, long — gain
    const bPnl = computeSafePnl(90, exitPrice, 0.5, 'long');

    expect(aPnl).toBe(-5);
    expect(bPnl).toBe(5);
    // Aggregate is zero, but each row's individual pnl is materially
    // different. Pre-fix split would have given each row 0; post-fix
    // gives each row its own ±5 — chemistry now sees the real per-row
    // outcomes instead of a deceptive aggregate.
  });

  it('many-row stack with varied entries each gets correct pnl', () => {
    const rows = [
      { entry: 100, qty: 0.1, side: 'long' as const, expected:  1 },
      { entry: 105, qty: 0.2, side: 'long' as const, expected: -1 },
      { entry: 95,  qty: 0.3, side: 'long' as const, expected:  4.5 },
      { entry: 110, qty: 0.4, side: 'long' as const, expected: -4 },
    ];
    const exitPrice = 110;
    for (const r of rows) {
      const pnl = computeSafePnl(r.entry, exitPrice, r.qty, r.side);
      expect(pnl).toBeCloseTo(r.qty * (exitPrice - r.entry), 6);
    }
  });
});

import { observerFibCoefficient } from '../ocean_reward.js';
import { computeNetPnlForReward } from '../safePnlSql.js';

describe('net-of-fees reward signal (P1/P5/P25 — chemistry must see lived economic reality)', () => {
  it('synthetic winning close returns 0 — no fabricated fee estimate (operator "no knobs" doctrine 2026-05-27)', () => {
    // The previous implementation used 9 bp + 0.18 floor as a fee estimate,
    // which were knobs the operator explicitly rejected. The canonical
    // reward path is now `applyPoloRealizedPnlAfterClose` which fetches
    // Polo's real realizedPnl and pushes a separate `polo_authoritative_close`
    // event. The synthetic immediate-close path returns 0 so no chemistry
    // fires on estimated data; the authoritative event supersedes within
    // seconds.
    const grossPnl = 0.148;
    const margin = 1.2;
    const notional = margin * 16;

    const netPnl = computeNetPnlForReward(grossPnl, notional);
    // No fabricated fee — synthetic wins return 0 by design.
    expect(netPnl).toBe(0);

    // Post-#1040: observer coefficient no longer hard-gates z<=0 to zero;
    // absolute deviation maps to structural tiers.
    const history = [0.0005, 0.0012, -0.0008, 0.0003, 0.0009];
    const netPnlFrac = netPnl / margin;
    const coeff = observerFibCoefficient(netPnlFrac, history);
    expect(coeff).toBeGreaterThanOrEqual(1);
  });

  it('synthetic losing close preserves gross loss as immediate negative reinforcement', () => {
    const netPnl = computeNetPnlForReward(-2.5479, 129.5);

    expect(netPnl).toBeCloseTo(-2.5479, 6);
  });

  it('cold-start / test fixture path (notional ≤ 0) falls open to gross', () => {
    // Test harnesses that don't thread a notional (legacy / cold-start)
    // keep working. Production paths always thread notional > 0 and
    // therefore hit the zero-fallback above.
    expect(computeNetPnlForReward(0.5, 0)).toBe(0.5);
    expect(computeNetPnlForReward(-0.5, 0)).toBe(-0.5);
    expect(computeNetPnlForReward(1.0, -5)).toBe(1.0);
    expect(computeNetPnlForReward(1.0, NaN)).toBe(1.0);
  });

  it('non-finite gross input returns 0 (defensive)', () => {
    expect(computeNetPnlForReward(NaN, 10)).toBe(0);
    expect(computeNetPnlForReward(Infinity, 10)).toBe(0);
    expect(computeNetPnlForReward(-Infinity, 10)).toBe(0);
  });
});

describe('canonical Polo-authoritative reward surface (user 2026-05-28 spec + LIVED ONLY 5)', () => {
  it('15:30:45 case via polo_authoritative_close: gross +0.148 but real Polo net ≈ −0.02 still maps via observer z-magnitude (no hard zero-gate)', () => {
    // This simulates the authoritative reward event pushed by the Polo helper
    // after it writes the real realizedPnl from getPositionHistory.
    const poloRealizedNet = -0.02; // what Polo actually paid (user's measured)
    const margin = 1.2;
    const history = [0.0005, 0.0012, -0.0008, 0.0003, 0.0009];

    const netPnlFrac = poloRealizedNet / margin;
    const coeff = observerFibCoefficient(netPnlFrac, history);

    // The hard LIVED ONLY 5 path for 'polo_authoritative_close' must only ever
    // see real Polo net. The post-#1040 observer map removes z<=0 hard-zero.
    expect(coeff).toBeGreaterThanOrEqual(1);
  });
});
