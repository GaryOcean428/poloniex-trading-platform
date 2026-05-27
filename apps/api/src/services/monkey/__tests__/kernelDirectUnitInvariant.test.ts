/**
 * kernelDirectUnitInvariant.test.ts — Commit 5 (Cascade brief 2026-05-27).
 *
 * Regression guard pinning the kernel-direct INSERT path's unit invariant:
 * `formattedSize` is BASE ASSET (BTC, ETH, ...) and `entryPrice * formattedSize`
 * is USDT notional. The contracts/base-asset boundary lives in
 * `poloniexFuturesService.placeOrder` — the kernel never sees contracts.
 *
 * If a future change accidentally stores contracts in `quantity` (the
 * historic phantom-PnL 100×/1000× class of bug), Commit 1's
 * checkNotionalConsistency assertion immediately catches it. These tests
 * pin the catch behavior at the unit boundary on realistic Polo-scale inputs.
 */

import { describe, it, expect } from 'vitest';
import { checkNotionalConsistency } from '../safePnlSql.js';

describe('Commit 5 — kernel-direct INSERT unit invariant (regression guard)', () => {
  describe('correct base-asset quantity passes the gate', () => {
    it('ETH 0.5 base-asset at $2080 → notional $1040 matches intended', () => {
      const c = checkNotionalConsistency(2080, 0.5, 1040);
      expect(c.consistent).toBe(true);
    });

    it('BTC 0.012 base-asset at $80000 → notional $960 matches intended', () => {
      const c = checkNotionalConsistency(80000, 0.012, 960);
      expect(c.consistent).toBe(true);
    });

    it('typical Polo slippage (0.05%) stays consistent', () => {
      // Intended notional $1000; actual fill at slightly worse price.
      // entry $2080 × 0.4805 = $999.44 (0.056% drift) — within tolerance.
      const c = checkNotionalConsistency(2080, 0.4805, 1000);
      expect(c.consistent).toBe(true);
    });
  });

  describe('contracts-stored-as-base-asset regression patterns are rejected', () => {
    it('ETH lot=0.01 contracts-as-quantity → 100× inflation rejected', () => {
      // Bug: writer wrote 13 contracts (≈0.13 ETH) into the base-asset column.
      // entry $2080 × 13 = $27,040 vs intended $270.4 → 100× ratio.
      const c = checkNotionalConsistency(2080, 13, 270.4);
      expect(c.consistent).toBe(false);
      expect(c.diagnostic).toMatch(/unit mismatch/);
    });

    it('BTC lot=0.001 contracts-as-quantity → 1000× inflation rejected', () => {
      // Bug: 4 contracts (≈0.004 BTC) stored as base-asset.
      // entry $80000 × 4 = $320,000 vs intended $320 → 1000× ratio.
      const c = checkNotionalConsistency(80000, 4, 320);
      expect(c.consistent).toBe(false);
      expect(c.diagnostic).toMatch(/unit mismatch/);
    });

    it('historic +$374.12 phantom on +$0.0026 real (~144000× ratio)', () => {
      // Reconciler scalp_exit phantom from the 2026-05-26 audit. Such
      // ratios are absurd by construction; the assertion catches them
      // wherever they originate.
      const c = checkNotionalConsistency(2080, 100, 0.005);
      expect(c.consistent).toBe(false);
      expect(c.divergencePct).toBeGreaterThan(1000);
    });
  });

  describe('the partial-fill / slippage band — caught when > 0.1%', () => {
    it('0.05% drift (within slippage band) → consistent', () => {
      const c = checkNotionalConsistency(2080, 0.4998, 1040);
      expect(c.consistent).toBe(true);
    });

    it('0.15% drift (above tolerance) → caught', () => {
      // entry $2080 × 0.49925 = $1038.44 vs $1040 → 0.15% drift.
      const c = checkNotionalConsistency(2080, 0.49925, 1040);
      expect(c.consistent).toBe(false);
    });
  });
});
