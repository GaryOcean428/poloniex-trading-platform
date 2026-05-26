/**
 * oceanReward.test.ts — Issue #948 (Matrix tier-3 directive 2026-05-26).
 *
 * Pins the Fibonacci reward shape and the 1% noise floor — the
 * structural learning-signal that teaches the kernel "small wins
 * aren't worth chasing."
 *
 * These tests are RESTRICTIVE on purpose. If a future PR widens the
 * 1% floor or changes the Fibonacci sequence, it must change these
 * tests deliberately — the doctrine ("reward shape, not knob") makes
 * the sequence load-bearing.
 */

import { describe, it, expect } from 'vitest';
import {
  fibonacciRewardCoefficient,
  fibonacciRewardTier,
  oceanTrailRetracement,
  oceanTrailTierIndex,
  TRAIL_TIERS,
} from '../ocean_reward.js';

describe('fibonacciRewardCoefficient — the structural reward shape', () => {
  describe('the 1% noise floor', () => {
    it('emits ZERO reward below 1% ROI', () => {
      expect(fibonacciRewardCoefficient(0)).toBe(0);
      expect(fibonacciRewardCoefficient(0.001)).toBe(0); // 0.1%
      expect(fibonacciRewardCoefficient(0.005)).toBe(0); // 0.5%
      expect(fibonacciRewardCoefficient(0.0099)).toBe(0); // 0.99%
    });

    it('emits ZERO reward on negative ROI (losses fall through to gaba path)', () => {
      expect(fibonacciRewardCoefficient(-0.01)).toBe(0);
      expect(fibonacciRewardCoefficient(-0.5)).toBe(0);
    });

    it('emits ZERO reward on NaN / non-finite (defensive — caller shouldn\'t pass these)', () => {
      expect(fibonacciRewardCoefficient(NaN)).toBe(0);
      expect(fibonacciRewardCoefficient(Infinity)).toBe(0);
      expect(fibonacciRewardCoefficient(-Infinity)).toBe(0);
    });

    it('first non-zero tier is exactly at 1.00% ROI', () => {
      expect(fibonacciRewardCoefficient(0.01)).toBe(1);
    });
  });

  describe('the Fibonacci bucket boundaries', () => {
    it('bucket [1%, 2%) → coefficient 1', () => {
      expect(fibonacciRewardCoefficient(0.01)).toBe(1);
      expect(fibonacciRewardCoefficient(0.015)).toBe(1);
      expect(fibonacciRewardCoefficient(0.019)).toBe(1);
    });

    it('bucket [2%, 3%) → coefficient 2', () => {
      expect(fibonacciRewardCoefficient(0.02)).toBe(2);
      expect(fibonacciRewardCoefficient(0.025)).toBe(2);
    });

    it('bucket [3%, 5%) → coefficient 3', () => {
      expect(fibonacciRewardCoefficient(0.03)).toBe(3);
      expect(fibonacciRewardCoefficient(0.045)).toBe(3);
    });

    it('bucket [5%, 8%) → coefficient 5', () => {
      expect(fibonacciRewardCoefficient(0.05)).toBe(5);
      expect(fibonacciRewardCoefficient(0.075)).toBe(5);
    });

    it('bucket [8%, 13%) → coefficient 8', () => {
      expect(fibonacciRewardCoefficient(0.08)).toBe(8);
      expect(fibonacciRewardCoefficient(0.12)).toBe(8);
    });

    it('bucket [13%, 21%) → coefficient 13', () => {
      expect(fibonacciRewardCoefficient(0.13)).toBe(13);
      expect(fibonacciRewardCoefficient(0.20)).toBe(13);
    });

    it('bucket [21%, 34%) → coefficient 21', () => {
      expect(fibonacciRewardCoefficient(0.21)).toBe(21);
      expect(fibonacciRewardCoefficient(0.33)).toBe(21);
    });

    it('bucket [34%, ∞) → coefficient 34 (capped — outliers don\'t over-train)', () => {
      expect(fibonacciRewardCoefficient(0.34)).toBe(34);
      expect(fibonacciRewardCoefficient(0.50)).toBe(34);
      expect(fibonacciRewardCoefficient(1.00)).toBe(34);
      expect(fibonacciRewardCoefficient(10.00)).toBe(34);
    });
  });

  describe('the sequence IS Fibonacci', () => {
    it('coefficients form the Fibonacci sequence (1, 2, 3, 5, 8, 13, 21, 34)', () => {
      const coeffs = [
        fibonacciRewardCoefficient(0.01),
        fibonacciRewardCoefficient(0.02),
        fibonacciRewardCoefficient(0.03),
        fibonacciRewardCoefficient(0.05),
        fibonacciRewardCoefficient(0.08),
        fibonacciRewardCoefficient(0.13),
        fibonacciRewardCoefficient(0.21),
        fibonacciRewardCoefficient(0.34),
      ];
      expect(coeffs).toEqual([1, 2, 3, 5, 8, 13, 21, 34]);
    });

    it('each tier boundary is itself a Fibonacci percentage (the boundaries and the magnitudes share the sequence)', () => {
      // The boundary VALUE (1, 2, 3, 5, 8, 13, 21, 34) equals the coefficient
      // at the bucket OPENING — the kernel feels a 1% win as 1× reward, a 2%
      // win as 2× reward, etc. This is the structural identity.
      expect(fibonacciRewardCoefficient(0.01)).toBe(1);
      expect(fibonacciRewardCoefficient(0.02)).toBe(2);
      expect(fibonacciRewardCoefficient(0.03)).toBe(3);
      expect(fibonacciRewardCoefficient(0.05)).toBe(5);
      expect(fibonacciRewardCoefficient(0.08)).toBe(8);
      expect(fibonacciRewardCoefficient(0.13)).toBe(13);
      expect(fibonacciRewardCoefficient(0.21)).toBe(21);
      expect(fibonacciRewardCoefficient(0.34)).toBe(34);
    });
  });
});

describe('fibonacciRewardTier — telemetry index', () => {
  it('tier 0 means "below the 1% noise floor"', () => {
    expect(fibonacciRewardTier(0)).toBe(0);
    expect(fibonacciRewardTier(0.005)).toBe(0);
  });

  it('tiers 1..8 map to the eight Fibonacci buckets', () => {
    expect(fibonacciRewardTier(0.01)).toBe(1);
    expect(fibonacciRewardTier(0.02)).toBe(2);
    expect(fibonacciRewardTier(0.03)).toBe(3);
    expect(fibonacciRewardTier(0.05)).toBe(4);
    expect(fibonacciRewardTier(0.08)).toBe(5);
    expect(fibonacciRewardTier(0.13)).toBe(6);
    expect(fibonacciRewardTier(0.21)).toBe(7);
    expect(fibonacciRewardTier(0.34)).toBe(8);
    expect(fibonacciRewardTier(1.00)).toBe(8);
  });
});

describe('oceanTrailRetracement — Matrix tier-3 doctrine extension', () => {
  // The trail-eligible Fibonacci subset is structurally defined:
  // - Tier 1 (1%) and tier 2 (2%) excluded as noise-band / too-tight
  // - Tier 8 (34%) excluded — harvest gate would fire first
  // - Remaining {3%, 5%, 8%, 13%, 21%} is the operational range
  it('exposes the trail-eligible Fibonacci subset as the canonical TRAIL_TIERS const', () => {
    expect(TRAIL_TIERS).toEqual([0.03, 0.05, 0.08, 0.13, 0.21]);
  });

  describe('coherence-streak → tier mapping (Mechanism B — pure count, no formula)', () => {
    it('streak=0 → tightest tier (3%) — fresh entry has no coherent-tick history', () => {
      expect(oceanTrailRetracement(0)).toBe(0.03);
      expect(oceanTrailTierIndex(0)).toBe(0);
    });

    it('streak=1 → 5%', () => {
      expect(oceanTrailRetracement(1)).toBe(0.05);
      expect(oceanTrailTierIndex(1)).toBe(1);
    });

    it('streak=2 → 8%', () => {
      expect(oceanTrailRetracement(2)).toBe(0.08);
      expect(oceanTrailTierIndex(2)).toBe(2);
    });

    it('streak=3 → 13%', () => {
      expect(oceanTrailRetracement(3)).toBe(0.13);
      expect(oceanTrailTierIndex(3)).toBe(3);
    });

    it('streak=4 → 21% (loosest tier)', () => {
      expect(oceanTrailRetracement(4)).toBe(0.21);
      expect(oceanTrailTierIndex(4)).toBe(4);
    });

    it('streak ≥ 5 → capped at the loosest tier (21%)', () => {
      // Sustained coherence beyond 5 ticks doesn't widen further —
      // the kernel's harvest gate owns the upper bound; trail caps here.
      expect(oceanTrailRetracement(5)).toBe(0.21);
      expect(oceanTrailRetracement(100)).toBe(0.21);
      expect(oceanTrailRetracement(1e9)).toBe(0.21);
    });
  });

  describe('defensive input handling — never throws, never returns junk', () => {
    it('negative streak (defensive — caller should never pass this) → tightest tier', () => {
      expect(oceanTrailRetracement(-1)).toBe(0.03);
      expect(oceanTrailRetracement(-100)).toBe(0.03);
    });

    it('NaN streak → tightest tier (telemetry tier index = 0)', () => {
      expect(oceanTrailRetracement(NaN)).toBe(0.03);
      expect(oceanTrailTierIndex(NaN)).toBe(0);
    });

    it('Infinity streak → tightest tier (defensive — non-finite treated as unknown)', () => {
      // Conservative default: a non-finite streak means the caller is
      // in an undefined state. Falling back to the tightest tier (3%)
      // is safer than the loosest (21%) — over-tight SL gets harvested
      // quickly via the normal exit path; over-loose SL exposes the
      // position to a deeper drawdown before the kernel can react.
      expect(oceanTrailRetracement(Infinity)).toBe(0.03);
      expect(oceanTrailTierIndex(Infinity)).toBe(0);
    });

    it('fractional streak rounds down (streak counts whole ticks)', () => {
      expect(oceanTrailRetracement(1.9)).toBe(0.05);
      expect(oceanTrailRetracement(3.99)).toBe(0.13);
    });
  });

  describe('structural identity — the trail subset is Fibonacci, not arbitrary', () => {
    it('the five tier values are consecutive Fibonacci numbers expressed as percentages', () => {
      // F(4)=3, F(5)=5, F(6)=8, F(7)=13, F(8)=21. The trail subset
      // is Fibonacci indices 4..8 of the canonical sequence, mapped
      // to percentages. This is the structural identity that makes
      // "Fibonacci" load-bearing here.
      const asPercents = TRAIL_TIERS.map((t) => Math.round(t * 100));
      expect(asPercents).toEqual([3, 5, 8, 13, 21]);
    });

    it('no in-between values — discrete selection only (no interpolation)', () => {
      // Matrix tier-3 recommendation: discrete preserves the
      // "no in-between values" purity from PR #950. Continuous
      // interpolation would reintroduce a free parameter (the
      // interpolation function shape) and break the doctrine.
      const allOutputs = new Set<number>();
      for (let s = 0; s < 20; s++) {
        allOutputs.add(oceanTrailRetracement(s));
      }
      // Exactly five distinct outputs — one per tier in TRAIL_TIERS.
      expect(allOutputs.size).toBe(TRAIL_TIERS.length);
      for (const t of TRAIL_TIERS) {
        expect(allOutputs.has(t)).toBe(true);
      }
    });
  });
});
