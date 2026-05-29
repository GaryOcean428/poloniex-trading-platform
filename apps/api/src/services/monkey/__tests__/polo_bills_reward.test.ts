/**
 * polo_bills_reward.test.ts — money-path tests for composePoloBillsReward
 * (poloniex-trading-platform#1028).
 *
 * Fixtures are the EXACT `/v3/account/bills` rows captured from the live
 * polytrade-be account on 2026-05-29 for the two closes the Grok review
 * flagged. The prior synthetic gross under-counted (ETH reported −3.5568);
 * these PNL rows reconcile to the exchange-exported closed PnL of −4.2499
 * (ETH) and −2.24352466 (BTC). Pinning that reconciliation here.
 */
import { describe, expect, it } from 'vitest';
import { composePoloBillsReward, type PoloBillRow } from '../polo_reward_ledger.js';

const ETH_CLOSE_MS = 1780045824884;
const BTC_CLOSE_MS = 1780045854898;

// 8 ETH PNL bills (sz) at the close cTime → Σ = −4.2499 (exchange truth).
const ETH_PNL_SZ = [-0.7709, -0.4067, -0.222, -0.4887, -1.2648, -0.6312, -0.3654, -0.1002];
// 4 BTC PNL bills → Σ = −2.24352466…
const BTC_PNL_SZ = [
  -0.320870666666666666, -1.283082666666666666, -0.480976, -0.158595333333333333,
];

function pnlRows(symbol: string, szs: number[], cTimeMs: number): PoloBillRow[] {
  return szs.map((sz) => ({ type: 'PNL', sz, symbol, cTimeMs }));
}

describe('composePoloBillsReward', () => {
  it('reconciles ETH realized PnL to the exchange export (−4.2499)', () => {
    const rows = pnlRows('ETH_USDT_PERP', ETH_PNL_SZ, ETH_CLOSE_MS);
    const out = composePoloBillsReward(rows, {
      symbol: 'ETH_USDT_PERP',
      closeStartMs: ETH_CLOSE_MS - 2000,
      closeEndMs: ETH_CLOSE_MS + 2000,
      holdStartMs: ETH_CLOSE_MS - 3_600_000,
      holdEndMs: ETH_CLOSE_MS + 2000,
    });
    expect(out.pnlRowCount).toBe(8);
    expect(out.realizedPnl).toBeCloseTo(-4.2499, 6);
    expect(out.fundingSigned).toBe(0);
  });

  it('reconciles BTC realized PnL to the exchange export (−2.24352466)', () => {
    const rows = pnlRows('BTC_USDT_PERP', BTC_PNL_SZ, BTC_CLOSE_MS);
    const out = composePoloBillsReward(rows, {
      symbol: 'BTC_USDT_PERP',
      closeStartMs: BTC_CLOSE_MS - 2000,
      closeEndMs: BTC_CLOSE_MS + 2000,
      holdStartMs: BTC_CLOSE_MS - 3_600_000,
      holdEndMs: BTC_CLOSE_MS + 2000,
    });
    expect(out.pnlRowCount).toBe(4);
    expect(out.realizedPnl).toBeCloseTo(-2.24352466, 6);
  });

  it('sums FUNDING_FEE signed flow in the hold window (+ received, − paid)', () => {
    const rows: PoloBillRow[] = [
      ...pnlRows('ETH_USDT_PERP', ETH_PNL_SZ, ETH_CLOSE_MS),
      { type: 'FUNDING_FEE', sz: 0.12641643, symbol: 'ETH_USDT_PERP', cTimeMs: ETH_CLOSE_MS - 1_000_000 },
      { type: 'FUNDING_FEE', sz: -0.05173194, symbol: 'ETH_USDT_PERP', cTimeMs: ETH_CLOSE_MS - 2_000_000 },
    ];
    const out = composePoloBillsReward(rows, {
      symbol: 'ETH_USDT_PERP',
      closeStartMs: ETH_CLOSE_MS - 2000,
      closeEndMs: ETH_CLOSE_MS + 2000,
      holdStartMs: ETH_CLOSE_MS - 3_600_000,
      holdEndMs: ETH_CLOSE_MS + 2000,
    });
    expect(out.realizedPnl).toBeCloseTo(-4.2499, 6);
    expect(out.fundingRowCount).toBe(2);
    expect(out.fundingSigned).toBeCloseTo(0.12641643 - 0.05173194, 8);
  });

  it('excludes PNL rows outside the close window', () => {
    const rows: PoloBillRow[] = [
      ...pnlRows('ETH_USDT_PERP', ETH_PNL_SZ, ETH_CLOSE_MS),
      // a different close of the same symbol an hour later — must NOT be counted
      { type: 'PNL', sz: -99, symbol: 'ETH_USDT_PERP', cTimeMs: ETH_CLOSE_MS + 3_600_000 },
    ];
    const out = composePoloBillsReward(rows, {
      symbol: 'ETH_USDT_PERP',
      closeStartMs: ETH_CLOSE_MS - 2000,
      closeEndMs: ETH_CLOSE_MS + 2000,
      holdStartMs: ETH_CLOSE_MS - 3_600_000,
      holdEndMs: ETH_CLOSE_MS + 2000,
    });
    expect(out.pnlRowCount).toBe(8);
    expect(out.realizedPnl).toBeCloseTo(-4.2499, 6);
  });

  it('excludes other symbols and TRANSFER rows', () => {
    const rows: PoloBillRow[] = [
      ...pnlRows('ETH_USDT_PERP', ETH_PNL_SZ, ETH_CLOSE_MS),
      { type: 'PNL', sz: -50, symbol: 'BTC_USDT_PERP', cTimeMs: ETH_CLOSE_MS },
      { type: 'TRANSFER', sz: 1000, symbol: 'ETH_USDT_PERP', cTimeMs: ETH_CLOSE_MS },
    ];
    const out = composePoloBillsReward(rows, {
      symbol: 'ETH_USDT_PERP',
      closeStartMs: ETH_CLOSE_MS - 2000,
      closeEndMs: ETH_CLOSE_MS + 2000,
      holdStartMs: ETH_CLOSE_MS - 3_600_000,
      holdEndMs: ETH_CLOSE_MS + 2000,
    });
    expect(out.pnlRowCount).toBe(8);
    expect(out.realizedPnl).toBeCloseTo(-4.2499, 6);
  });

  it('returns pnlRowCount=0 when no PNL rows match (caller must fall back)', () => {
    const out = composePoloBillsReward([], {
      symbol: 'ETH_USDT_PERP',
      closeStartMs: ETH_CLOSE_MS - 2000,
      closeEndMs: ETH_CLOSE_MS + 2000,
      holdStartMs: ETH_CLOSE_MS - 3_600_000,
      holdEndMs: ETH_CLOSE_MS + 2000,
    });
    expect(out.pnlRowCount).toBe(0);
    expect(out.realizedPnl).toBe(0);
  });
});
