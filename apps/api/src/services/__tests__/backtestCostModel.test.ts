/**
 * Commit 2 regression tests: backtest cost model.
 *
 * The red team identified three systematic biases that together were
 * masking real strategy edge behind fake costs:
 *
 *  1. Slippage constant of 0.001 (10bps) — institutional-scale, ~5-10x
 *     realistic for the 1-contract orders this engine trades.
 *  2. Funding rate hardcoded at +0.01% (perma-contango) — systematically
 *     overcharged longs in every backtest.
 *  3. Taker fees overstated (0.075% vs 0.06%), maker fees understated
 *     (0.01% vs 0.02%).
 *
 * These tests lock the corrected values so a future refactor can't
 * silently regress the cost model.
 */

// @ts-expect-error — backtestingEngine is a .js module without TS types.
import { default as backtestingEngine, computeFundingCost } from '../backtestingEngine.js';
import { describe, expect, it } from 'vitest';

describe('backtestingEngine cost model', () => {
  it('uses calibrated slippage (0.0002, not 0.001)', () => {
    expect(backtestingEngine.marketSimulation.slippage).toBe(0.0002);
  });

  it('uses Poloniex VIP0 taker fee (0.06%)', () => {
    const fees = backtestingEngine.calculateTradingFees(1, 10_000, 'market');
    // 1 * 10000 * 0.0006 = 6
    expect(fees).toBeCloseTo(6, 6);
  });

  it('uses Poloniex VIP0 maker fee (0.02%)', () => {
    const fees = backtestingEngine.calculateTradingFees(1, 10_000, 'limit');
    // 1 * 10000 * 0.0002 = 2
    expect(fees).toBeCloseTo(2, 6);
  });
});

describe('computeFundingCost', () => {
  const RATE = 0.0001;
  const NOTIONAL = 1_000;

  it('charges a long position when funding rate is positive (even block)', () => {
    // Even block → rate signed +0.0001; long pays +0.0001 × 1000 = +0.1
    expect(computeFundingCost(NOTIONAL, 'long', 0, RATE)).toBeCloseTo(0.1, 10);
    expect(computeFundingCost(NOTIONAL, 'long', 2, RATE)).toBeCloseTo(0.1, 10);
  });

  it('credits a long position when funding rate is negative (odd block)', () => {
    // Odd block → rate signed −0.0001; long "pays" −0.1 = gains 0.1
    expect(computeFundingCost(NOTIONAL, 'long', 1, RATE)).toBeCloseTo(-0.1, 10);
    expect(computeFundingCost(NOTIONAL, 'long', 3, RATE)).toBeCloseTo(-0.1, 10);
  });

  it('mirrors the sign for short positions', () => {
    expect(computeFundingCost(NOTIONAL, 'short', 0, RATE)).toBeCloseTo(-0.1, 10);
    expect(computeFundingCost(NOTIONAL, 'short', 1, RATE)).toBeCloseTo(0.1, 10);
  });

  it('sums to zero over an even number of adjacent blocks for either side', () => {
    let total = 0;
    for (let b = 0; b < 8; b++) {
      total += computeFundingCost(NOTIONAL, 'long', b, RATE);
    }
    expect(total).toBeCloseTo(0, 10);

    total = 0;
    for (let b = 0; b < 8; b++) {
      total += computeFundingCost(NOTIONAL, 'short', b, RATE);
    }
    expect(total).toBeCloseTo(0, 10);
  });

  it('scales linearly with notional', () => {
    const small = computeFundingCost(100, 'long', 0, RATE);
    const big = computeFundingCost(10_000, 'long', 0, RATE);
    expect(big / small).toBeCloseTo(100, 6);
  });
});
