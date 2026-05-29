/**
 * polo_reward_ledger_hardening.test.ts — money-path semantic tests for
 * the Polo-authoritative reward-ledger composition (#1024).
 *
 * Replaces the prior round of string-presence tests (e.g.
 * `expect(LOOP_TS).toContain('Math.abs(feeAmt)')`) which Cascade
 * 2026-05-29 correctly flagged as lint, not money-path correctness
 * coverage. The pure helper `computePoloAuthoritativeReward` is now
 * directly testable; the money-path semantics are pinned here.
 *
 * # Pinned semantics
 *
 *   1. Close fees only complete → `pnl_source = 'polo_gross_minus_close_fees'`
 *      and `poloRealized = grossSum - totalCloseFees`. Falls back when
 *      open-side fees or funding is incomplete.
 *   2. Open fees + funding both complete → `pnl_source = 'polo_net_full'`
 *      and `poloRealized = grossSum - closeFees - openFees + signedFunding`.
 *      Note the `+` on funding — signed flow already carries direction.
 *   3. Funding PAID (negative signed) reduces net pnl.
 *   4. Funding RECEIVED (positive signed) increases net pnl.
 *   5. Either component missing → fall back to close-fees-only with
 *      explicit `polo_gross_minus_close_fees` provenance; do NOT
 *      mis-label as full net.
 *   6. Funding-sign discrepancy detector: surfaces rows where the
 *      `fundingFee` sign disagrees with the direction implied by
 *      (position side, rate sign) per the kernel's existing
 *      pre-entry funding gate convention. Used to surface API drift
 *      in production logs.
 *
 * # Migration test
 *
 * The migration test now references `064_polo_reward_ledger_full_net.sql`
 * after the #1022 → #1024 number collision was resolved by renumbering.
 *
 * Citations: poloniex-trading-platform#1015 + #1024 + Cascade
 * 2026-05-29 review (funding sign + money-path tests).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computePoloAuthoritativeReward,
  detectFundingSignDiscrepancies,
} from '../polo_reward_ledger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('computePoloAuthoritativeReward — money-path semantics', () => {
  it('close fees only complete → polo_gross_minus_close_fees provenance', () => {
    const r = computePoloAuthoritativeReward({
      grossSum: 10.0,
      totalCloseFees: 0.5,
      totalOpenFees: 0.3,
      openFeesComplete: false,         // open fees not indexed
      fundingFlowsSigned: 0,
      fundingComplete: false,          // funding not fetched
    });
    expect(r.pnlNetCloseFeesOnly).toBeCloseTo(9.5);
    expect(r.hasFullNet).toBe(false);
    expect(r.pnlSource).toBe('polo_gross_minus_close_fees');
    expect(r.poloRealized).toBeCloseTo(9.5);
  });

  it('open fees + funding both complete → polo_net_full provenance', () => {
    const r = computePoloAuthoritativeReward({
      grossSum: 10.0,
      totalCloseFees: 0.5,
      totalOpenFees: 0.3,
      openFeesComplete: true,
      fundingFlowsSigned: 0,           // no funding events in window
      fundingComplete: true,
    });
    expect(r.pnlNetCloseFeesOnly).toBeCloseTo(9.5);
    expect(r.pnlNetFull).toBeCloseTo(9.2); // 10.0 - 0.5 - 0.3 + 0
    expect(r.hasFullNet).toBe(true);
    expect(r.pnlSource).toBe('polo_net_full');
    expect(r.poloRealized).toBeCloseTo(9.2);
  });

  it('funding PAID (negative signed) REDUCES net pnl', () => {
    // User paid $0.20 of funding during the hold window.
    // gross 10 − closeFees 0.5 − openFees 0.3 + funding(-0.20) = 9.00
    const r = computePoloAuthoritativeReward({
      grossSum: 10.0,
      totalCloseFees: 0.5,
      totalOpenFees: 0.3,
      openFeesComplete: true,
      fundingFlowsSigned: -0.20,
      fundingComplete: true,
    });
    expect(r.pnlNetFull).toBeCloseTo(9.0);
    expect(r.poloRealized).toBeCloseTo(9.0);
  });

  it('funding RECEIVED (positive signed) INCREASES net pnl', () => {
    // User received $0.20 of funding during the hold window.
    // gross 10 − closeFees 0.5 − openFees 0.3 + funding(+0.20) = 9.40
    const r = computePoloAuthoritativeReward({
      grossSum: 10.0,
      totalCloseFees: 0.5,
      totalOpenFees: 0.3,
      openFeesComplete: true,
      fundingFlowsSigned: 0.20,
      fundingComplete: true,
    });
    expect(r.pnlNetFull).toBeCloseTo(9.4);
    expect(r.poloRealized).toBeCloseTo(9.4);
  });

  it('open fees complete but funding fetch failed → falls back to gross-minus-close-fees', () => {
    const r = computePoloAuthoritativeReward({
      grossSum: 10.0,
      totalCloseFees: 0.5,
      totalOpenFees: 0.3,
      openFeesComplete: true,
      fundingFlowsSigned: 0,
      fundingComplete: false,          // funding fetch errored
    });
    expect(r.hasFullNet).toBe(false);
    expect(r.pnlSource).toBe('polo_gross_minus_close_fees');
    // poloRealized uses the close-fees-only fallback — do NOT
    // mis-attribute partial as full net.
    expect(r.poloRealized).toBeCloseTo(9.5);
  });

  it('funding complete but open fees missing → falls back', () => {
    const r = computePoloAuthoritativeReward({
      grossSum: 10.0,
      totalCloseFees: 0.5,
      totalOpenFees: 0,
      openFeesComplete: false,
      fundingFlowsSigned: 0.10,
      fundingComplete: true,
    });
    expect(r.hasFullNet).toBe(false);
    expect(r.pnlSource).toBe('polo_gross_minus_close_fees');
    expect(r.poloRealized).toBeCloseTo(9.5);
  });

  it('losing close: gross negative, fees still subtracted as costs', () => {
    // gross -2.0 (loss) − closeFees 0.5 − openFees 0.3 + funding(-0.10) = -2.90
    const r = computePoloAuthoritativeReward({
      grossSum: -2.0,
      totalCloseFees: 0.5,
      totalOpenFees: 0.3,
      openFeesComplete: true,
      fundingFlowsSigned: -0.10,
      fundingComplete: true,
    });
    expect(r.pnlNetCloseFeesOnly).toBeCloseTo(-2.5);
    expect(r.pnlNetFull).toBeCloseTo(-2.9);
    expect(r.poloRealized).toBeCloseTo(-2.9);
  });

  it('tiny gross win netted out by fees: positive gross becomes negative net', () => {
    // gross 0.05 − closeFees 0.05 − openFees 0.05 = -0.05
    // catches the sign-preservation comment bug Cascade flagged
    const r = computePoloAuthoritativeReward({
      grossSum: 0.05,
      totalCloseFees: 0.05,
      totalOpenFees: 0.05,
      openFeesComplete: true,
      fundingFlowsSigned: 0,
      fundingComplete: true,
    });
    expect(r.pnlNetCloseFeesOnly).toBeCloseTo(0);   // gross - closeFees = 0
    expect(r.pnlNetFull).toBeCloseTo(-0.05);        // 0 - openFees + 0
    expect(r.poloRealized).toBeCloseTo(-0.05);
    // A gross win became a net loss after fees. Confirmed economically.
  });
});

describe('detectFundingSignDiscrepancies — API convention drift detector', () => {
  it('long + positive rate + negative fee (user paid) → no discrepancy', () => {
    const d = detectFundingSignDiscrepancies('long', [
      { fundingFee: -0.10, rate: 0.0001 }, // long pays positive rate
    ]);
    expect(d).toHaveLength(0);
  });

  it('long + negative rate + positive fee (user received) → no discrepancy', () => {
    const d = detectFundingSignDiscrepancies('long', [
      { fundingFee: 0.10, rate: -0.0001 }, // long receives on negative rate
    ]);
    expect(d).toHaveLength(0);
  });

  it('short + positive rate + positive fee (user received) → no discrepancy', () => {
    const d = detectFundingSignDiscrepancies('short', [
      { fundingFee: 0.10, rate: 0.0001 },  // short receives on positive rate
    ]);
    expect(d).toHaveLength(0);
  });

  it('short + negative rate + negative fee (user paid) → no discrepancy', () => {
    const d = detectFundingSignDiscrepancies('short', [
      { fundingFee: -0.10, rate: -0.0001 }, // short pays on negative rate
    ]);
    expect(d).toHaveLength(0);
  });

  it('long + positive rate + positive fee (wrong direction) → discrepancy', () => {
    // Should be paid (negative) but Polo returned positive
    const d = detectFundingSignDiscrepancies('long', [
      { fundingFee: 0.10, rate: 0.0001 },
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]?.expectedSign).toBe('paid');
    expect(d[0]?.actualSign).toBe('received');
  });

  it('zero rate or zero fee → ignored (no discrepancy)', () => {
    const d = detectFundingSignDiscrepancies('long', [
      { fundingFee: 0, rate: 0.0001 },
      { fundingFee: -0.10, rate: 0 },
    ]);
    expect(d).toHaveLength(0);
  });

  it('NaN inputs → ignored', () => {
    const d = detectFundingSignDiscrepancies('long', [
      { fundingFee: NaN, rate: 0.0001 },
      { fundingFee: -0.10, rate: NaN },
    ]);
    expect(d).toHaveLength(0);
  });
});

describe('migration 064 — pnl_source enum + telemetry columns', () => {
  const MIGRATION_064 = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '064_polo_reward_ledger_full_net.sql'),
    'utf8',
  );

  it('adds the four telemetry columns', () => {
    expect(MIGRATION_064).toContain('pnl_net_close_fees_only');
    expect(MIGRATION_064).toContain('pnl_net_full');
    expect(MIGRATION_064).toContain('open_fees_paid');
    expect(MIGRATION_064).toContain('funding_paid');
  });

  it('expands the pnl_source enum to include polo_gross_minus_close_fees + polo_net_full', () => {
    expect(MIGRATION_064).toContain("'polo_gross_minus_close_fees'");
    expect(MIGRATION_064).toContain("'polo_net_full'");
  });

  it('backfills existing polo_history rows to polo_gross_minus_close_fees', () => {
    expect(MIGRATION_064).toContain("SET pnl_source = 'polo_gross_minus_close_fees'");
  });
});
