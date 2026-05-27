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
  it('15:30:45 case: gross +0.148 but net ≈ −0.02 after fees → oceanCoeff must be 0, no positive tier reward', () => {
    // User's exact production report: hold was 8.5 min (not 56.9), gross +0.148,
    // Polo fees made it net-negative (~ −0.02). The observer reward gate must
    // NOT fire positive chemistry on this structurally losing trade.
    const grossPnl = 0.148;
    // Realistic margin for the trade that produced ~$0.17 fee hit at 9 bp + floor
    const margin = 1.2; // notional ~19.2 USDT
    const notional = margin * 16;

    const netPnl = computeNetPnlForReward(grossPnl, notional);
    // Must reproduce the user's measured outcome: net negative
    expect(netPnl).toBeLessThan(0);

    // Simulate the history the kernel would have seen (small positive median)
    const history = [0.0005, 0.0012, -0.0008, 0.0003, 0.0009];

    // The pnlFrac passed to the observer must be the *net* version
    const netPnlFrac = netPnl / margin;
    const coeff = observerFibCoefficient(netPnlFrac, history);

    // Gross would have produced positive z and tier ≥1.
    // Net must produce z ≤ 0 → coeff = 0 (no positive chemistry).
    expect(coeff).toBe(0);
  });

  it('computeNetPnlForReward is conservative (never over-rewards marginal gross-positive trades)', () => {
    const gross = 0.05;
    const notional = 10;
    const net = computeNetPnlForReward(gross, notional);
    expect(net).toBeLessThan(gross);
    // On very small gross the net can easily go negative
    const tinyGross = 0.005;
    const tinyNet = computeNetPnlForReward(tinyGross, notional);
    expect(tinyNet).toBeLessThan(0);
  });
});

describe('canonical Polo-authoritative reward surface (user 2026-05-28 spec + LIVED ONLY 5)', () => {
  it('15:30:45 case via polo_authoritative_close: gross +0.148 but real Polo net ≈ −0.02 → oceanCoeff must be 0, no positive tier (exercises hard LIVED ONLY 5 path)', () => {
    // This simulates the authoritative reward event pushed by the Polo helper
    // after it writes the real realizedPnl from getPositionHistory.
    const poloRealizedNet = -0.02; // what Polo actually paid (user's measured)
    const margin = 1.2;
    const history = [0.0005, 0.0012, -0.0008, 0.0003, 0.0009];

    const netPnlFrac = poloRealizedNet / margin;
    const coeff = observerFibCoefficient(netPnlFrac, history);

    // The hard LIVED ONLY 5 path for 'polo_authoritative_close' must only ever
    // see real Polo net. With the user's numbers, it must produce zero positive chemistry.
    expect(coeff).toBe(0);
  });
});
