/**
 * oceanReward.test.ts — observer-derived reward shape + trail tier doctrine.
 *
 * The legacy hardcoded 1% Fibonacci floor (fibonacciRewardCoefficient /
 * fibonacciRewardTier) has been DELETED — it never fired at real kernel
 * scale (~0.04% MAD on today's regime; 0/925 tier-1 firings in the
 * 2026-05-27 audit). The canonical reward is now
 * observerFibCoefficient(pnlFrac, history) which derives the threshold
 * from the kernel's own rolling pnlFrac distribution (median + MAD).
 *
 * Trail-tier doctrine (Matrix tier-3) is unchanged — coherence-streak
 * still drives the trail retracement via TRAIL_TIERS.
 */

import { describe, it, expect } from 'vitest';
import {
  observerFibCoefficient,
  oceanTrailRetracement,
  oceanTrailTierIndex,
  TRAIL_TIERS,
} from '../ocean_reward.js';

describe('observerFibCoefficient — observer-derived reward gate (P1)', () => {
  describe('cold-start ramp (history insufficient)', () => {
    it('empty history → gentle positive (1) for any positive pnlFrac', () => {
      expect(observerFibCoefficient(0.001, [])).toBe(1);
      expect(observerFibCoefficient(0.05, [])).toBe(1);
      expect(observerFibCoefficient(1.0, [])).toBe(1);
    });

    it('empty history → 0 for non-positive pnlFrac', () => {
      expect(observerFibCoefficient(0, [])).toBe(0);
      expect(observerFibCoefficient(-0.01, [])).toBe(0);
    });

    it('single-sample history is still cold-start (needs ≥ 2)', () => {
      expect(observerFibCoefficient(0.05, [0.001])).toBe(1);
    });
  });

  describe('observer-derived tier from own pnlFrac distribution', () => {
    it('below own median → 0 reward', () => {
      const history = [0.001, 0.0008, 0.0012, 0.0011, 0.0009];
      expect(observerFibCoefficient(0, history)).toBe(0);
    });

    it('exactly at own median → 0 (positive deviation required)', () => {
      const history = [0.001, 0.0008, 0.0012];
      expect(observerFibCoefficient(0.001, history)).toBe(0);
    });

    it('positive z-deviation → tier 1+ (first non-zero bucket)', () => {
      // history: median ~0.001, MAD ~0.0002; pnlFrac slightly above median
      const history = [0.001, 0.0008, 0.0012, 0.0011, 0.0009];
      const coeff = observerFibCoefficient(0.00115, history);
      expect(coeff).toBeGreaterThanOrEqual(1);
    });

    it('large positive deviation → higher tier (Fibonacci-shaped)', () => {
      const history = [0.001, 0.0008, 0.0012, 0.0011, 0.0009];
      const coeff = observerFibCoefficient(0.5, history);
      expect(coeff).toBeGreaterThanOrEqual(8);
    });
  });

  describe('defensive input handling', () => {
    it('NaN pnlFrac → 0', () => {
      expect(observerFibCoefficient(NaN, [0.001, 0.002])).toBe(0);
    });

    it('zero-MAD history (degenerate constant) → 0 (cannot z-score)', () => {
      expect(observerFibCoefficient(0.05, [0.001, 0.001, 0.001, 0.001])).toBe(0);
    });

    it('legacy fibonacciRewardCoefficient / fibonacciRewardTier are no longer exported', async () => {
      const mod = await import('../ocean_reward.js');
      expect((mod as Record<string, unknown>).fibonacciRewardCoefficient).toBeUndefined();
      expect((mod as Record<string, unknown>).fibonacciRewardTier).toBeUndefined();
    });
  });

  describe('regression guard — no re-introduction of hardcoded 1% floor', () => {
    it('no `roiFrac < 0.01` literal in ocean_reward.ts (legacy gate must stay deleted)', async () => {
      const fs = await import('node:fs');
      const src = fs.readFileSync(
        new URL('../ocean_reward.ts', import.meta.url),
        'utf8',
      );
      expect(src).not.toMatch(/roiFrac\s*<\s*0\.01/);
    });
  });
});

describe('oceanTrailRetracement — Matrix tier-3 doctrine extension', () => {
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
      const allOutputs = new Set<number>();
      for (let s = 0; s < 20; s++) {
        allOutputs.add(oceanTrailRetracement(s));
      }
      expect(allOutputs.size).toBe(TRAIL_TIERS.length);
      for (const t of TRAIL_TIERS) {
        expect(allOutputs.has(t)).toBe(true);
      }
    });
  });
});
