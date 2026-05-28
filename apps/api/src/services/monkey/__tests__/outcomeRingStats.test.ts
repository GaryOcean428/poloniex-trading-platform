/**
 * outcomeRingStats.test.ts — pin the three observer-derived helpers
 * against the live numbers from the 2026-05-28 6h audit window.
 */

import { describe, expect, it } from 'vitest';

import {
  computeBreakEvenNotionalFloor,
  computeKellyFraction,
  chemistryBoundedModulator,
  computeObserverLossFloorRoi,
  _FEE_SAFETY_MARGIN,
  _COMMENSURATE_K,
  type OutcomeRingStats,
} from '../outcomeRingStats.js';

const liveAuditStats = (overrides: Partial<OutcomeRingStats> = {}): OutcomeRingStats => ({
  n: 182,
  winRate: 0.665,
  avgWin: 0.120,
  avgLoss: -0.242,
  avgWinRoiNotional: 0.000826,        // 0.083% on notional
  medianLossRoiNotional: 0.001799,    // 0.180% on notional
  avgFeePerRoundTrip: 0.150,          // observed Polo round-trip fee on $146 notional fills
  avgNotional: 146,
  ...overrides,
});

describe('Fix A — computeBreakEvenNotionalFloor', () => {
  it('null stats → 0 (caller falls back to chemistry-driven cap)', () => {
    expect(computeBreakEvenNotionalFloor(null)).toBe(0);
  });

  it('live-audit numbers → ~$272 floor (fee 0.15 / win-roi 0.083% × 1.5)', () => {
    const floor = computeBreakEvenNotionalFloor(liveAuditStats());
    // 0.150 / 0.000826 × 1.5 = 272.4
    expect(floor).toBeGreaterThan(265);
    expect(floor).toBeLessThan(280);
  });

  it('returns 0 when no wins yet (kernel has not earned an edge)', () => {
    expect(computeBreakEvenNotionalFloor(liveAuditStats({ avgWinRoiNotional: 0 }))).toBe(0);
  });

  it('returns 0 when no fee data (gross_pnl missing on all rows)', () => {
    expect(computeBreakEvenNotionalFloor(liveAuditStats({ avgFeePerRoundTrip: 0 }))).toBe(0);
  });

  it('applies the FEE_SAFETY_MARGIN (1.5) multiplier exactly', () => {
    const stats = liveAuditStats({ avgFeePerRoundTrip: 0.10, avgWinRoiNotional: 0.001 });
    const floor = computeBreakEvenNotionalFloor(stats);
    expect(floor).toBeCloseTo(0.10 / 0.001 * _FEE_SAFETY_MARGIN, 1);
  });

  it('self-deactivating: if win-roi grows, floor falls', () => {
    const low = computeBreakEvenNotionalFloor(liveAuditStats({ avgWinRoiNotional: 0.0005 }));
    const high = computeBreakEvenNotionalFloor(liveAuditStats({ avgWinRoiNotional: 0.005 }));
    expect(high).toBeLessThan(low);
  });
});

describe('Fix B — computeKellyFraction', () => {
  it('null stats → 0 (no data yet)', () => {
    expect(computeKellyFraction(null)).toBe(0);
  });

  it('live-audit numbers → 0 (current edge is structurally negative)', () => {
    // edge = 0.665 × 0.120 − 0.335 × 0.242 = 0.0798 − 0.0810 ≈ −0.0012
    expect(computeKellyFraction(liveAuditStats())).toBe(0);
  });

  it('positive edge → positive fraction', () => {
    // wr 0.7, win 0.30, loss -0.20 → edge = 0.7*0.3 - 0.3*0.2 = 0.21 - 0.06 = 0.15
    // kelly = 0.15 / 0.20 = 0.75
    const k = computeKellyFraction(liveAuditStats({
      winRate: 0.7, avgWin: 0.30, avgLoss: -0.20,
    }));
    expect(k).toBeCloseTo(0.75, 2);
  });

  it('caps at 1.0 (no leveraging the Kelly fraction beyond unity)', () => {
    // wr 0.9, win 1.0, loss -0.10 → edge ~ 0.89, kelly = 8.9 → capped to 1.0
    const k = computeKellyFraction(liveAuditStats({
      winRate: 0.9, avgWin: 1.0, avgLoss: -0.10,
    }));
    expect(k).toBe(1.0);
  });

  it('no losses observed yet → cold-start 0.25 (bounded entry)', () => {
    expect(computeKellyFraction(liveAuditStats({
      avgLoss: 0, winRate: 1.0, avgWin: 0.5,
    }))).toBe(0.25);
  });
});

describe('Fix B — chemistryBoundedModulator', () => {
  it('neutral dop / neutral gaba → 1.0 (no modulation)', () => {
    expect(chemistryBoundedModulator(0.5, 0.5)).toBeCloseTo(1.0, 6);
  });

  it('high dopamine + low gaba → modulator > 1 (lift, bounded by 1.5)', () => {
    const m = chemistryBoundedModulator(1.0, 0.0);
    expect(m).toBeGreaterThan(1.0);
    expect(m).toBeLessThanOrEqual(1.5);
  });

  it('low dopamine + high gaba → modulator < 1 (damp, bounded by 0.5)', () => {
    const m = chemistryBoundedModulator(0.0, 1.0);
    expect(m).toBeLessThan(1.0);
    expect(m).toBeGreaterThanOrEqual(0.5);
  });

  it('NEVER collapses to zero — the old multiplicative bug is structurally impossible', () => {
    // Cover the chemistry corner: any combination in [0,1]².
    for (let d = 0; d <= 1; d += 0.2) {
      for (let g = 0; g <= 1; g += 0.2) {
        const m = chemistryBoundedModulator(d, g);
        expect(m).toBeGreaterThanOrEqual(0.5);
        expect(m).toBeLessThanOrEqual(1.5);
      }
    }
  });
});

describe('Fix C — computeObserverLossFloorRoi', () => {
  it('null stats → 0 (no floor → harvest unrestricted)', () => {
    expect(computeObserverLossFloorRoi(null)).toBe(0);
  });

  it('live-audit numbers → ~0.27% on notional', () => {
    // median loss 0.18% × 1.5 = 0.27% (commensurate beats fee floor here)
    const floor = computeObserverLossFloorRoi(liveAuditStats());
    expect(floor).toBeCloseTo(0.001799 * _COMMENSURATE_K, 5);
  });

  it('when fee floor exceeds commensurate, fee floor wins', () => {
    const stats = liveAuditStats({
      medianLossRoiNotional: 0.0001,    // tiny losses
      avgFeePerRoundTrip: 0.30,          // heavy fees
      avgNotional: 100,                  // fee/notional = 0.3% >> commensurate 0.015%
    });
    const floor = computeObserverLossFloorRoi(stats);
    expect(floor).toBeCloseTo(0.003, 4);
  });

  it('returns commensurate when both floors are present and commensurate is larger', () => {
    const stats = liveAuditStats({
      medianLossRoiNotional: 0.01,       // 1% losses
      avgFeePerRoundTrip: 0.05,          // light fees
      avgNotional: 1000,                 // fee/notional = 0.005%, commensurate = 1.5%
    });
    const floor = computeObserverLossFloorRoi(stats);
    expect(floor).toBeCloseTo(0.015, 4);
  });

  it('self-relaxing: smaller median losses → smaller floor', () => {
    const high = computeObserverLossFloorRoi(liveAuditStats({ medianLossRoiNotional: 0.01 }));
    const low = computeObserverLossFloorRoi(liveAuditStats({ medianLossRoiNotional: 0.001 }));
    expect(low).toBeLessThan(high);
  });
});
