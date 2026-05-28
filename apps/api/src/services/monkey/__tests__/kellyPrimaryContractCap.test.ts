/**
 * kellyPrimaryContractCap.test.ts — pin Fix B sizing behaviour
 * (operator brief 2026-05-28).
 *
 * Replaces the structurally-collapsing chemistry-only formula
 * `max(0.1, dop × phi × (1-gaba))` with Kelly-from-own-outcomes ×
 * bounded chemistry modulator. Tests pin:
 *   - kellyFraction ≤ 0 → cap = 0 (no edge → no sizing)
 *   - bounded modulator never zeros out a Kelly-justified position
 *   - venue ceiling still respected
 */

import { describe, expect, it } from 'vitest';

import { kellyPrimaryContractCap, VENUE_CONTRACTS_CEILING } from '../positionContractsBound.js';

const observers = (overrides: Record<string, number> = {}) => ({
  availableEquityUsdt: 1000,
  markPrice: 2080,
  contractSize: 0.01,       // ETH lot
  leverage: 10,
  kellyFraction: 0.5,
  chemistryModulator: 1.0,
  ...overrides,
});

describe('kellyPrimaryContractCap — Fix B sizing', () => {
  it('kellyFraction = 0 → cap = 0 (caller falls through to chemistry cap)', () => {
    expect(kellyPrimaryContractCap(observers({ kellyFraction: 0 }))).toBe(0);
  });

  it('kellyFraction negative → cap = 0 (defensive)', () => {
    expect(kellyPrimaryContractCap(observers({ kellyFraction: -0.1 }))).toBe(0);
  });

  it('positive Kelly × neutral chemistry → caps at floor((equity × kelly × lev) / (price × lot))', () => {
    // 1000 × 0.5 × 1.0 × 10 / (2080 × 0.01) = 5000 / 20.8 = 240.4 → floor 240
    expect(kellyPrimaryContractCap(observers())).toBe(240);
  });

  it('chemistry modulator > 1 lifts the cap', () => {
    const baseline = kellyPrimaryContractCap(observers());
    const lifted = kellyPrimaryContractCap(observers({ chemistryModulator: 1.5 }));
    expect(lifted).toBeGreaterThan(baseline);
    // 1000 × 0.5 × 1.5 × 10 / 20.8 = 360.5 → floor 360
    expect(lifted).toBe(360);
  });

  it('chemistry modulator < 1 dampens but does NOT collapse the cap', () => {
    const dampened = kellyPrimaryContractCap(observers({ chemistryModulator: 0.5 }));
    // 1000 × 0.5 × 0.5 × 10 / 20.8 = 120.2 → floor 120
    expect(dampened).toBe(120);
    expect(dampened).toBeGreaterThan(0);  // never zeros out
  });

  it('chemistry modulator outside [0.5, 1.5] is clamped (defensive)', () => {
    const clipLow = kellyPrimaryContractCap(observers({ chemistryModulator: 0.1 }));
    const explicitLow = kellyPrimaryContractCap(observers({ chemistryModulator: 0.5 }));
    expect(clipLow).toBe(explicitLow);

    const clipHigh = kellyPrimaryContractCap(observers({ chemistryModulator: 5.0 }));
    const explicitHigh = kellyPrimaryContractCap(observers({ chemistryModulator: 1.5 }));
    expect(clipHigh).toBe(explicitHigh);
  });

  it('Kelly fraction internally clamps to 1.0 (no leverage beyond unity Kelly)', () => {
    const unityKelly = kellyPrimaryContractCap(observers({ kellyFraction: 1.0 }));
    const overUnity = kellyPrimaryContractCap(observers({ kellyFraction: 2.0 }));
    // riskFraction inside is min(kelly × modulator, 1.0). With modulator=1.0,
    // both 1.0 × 1.0 and 2.0 × 1.0 → 1.0 → identical cap.
    expect(overUnity).toBe(unityKelly);
  });

  it('venue ceiling respected even at full Kelly + max modulator + high equity', () => {
    const cap = kellyPrimaryContractCap(observers({
      availableEquityUsdt: 10_000_000,
      kellyFraction: 1.0,
      chemistryModulator: 1.5,
    }));
    expect(cap).toBeLessThanOrEqual(VENUE_CONTRACTS_CEILING);
  });

  it('zero equity → zero cap (defensive)', () => {
    expect(kellyPrimaryContractCap(observers({ availableEquityUsdt: 0 }))).toBe(0);
  });

  it('legacy formula contrast: the old cap could collapse to 0.1 floor with same chemistry; Kelly-primary stays at edge', () => {
    // Live audit chemistry (dop=0.37, phi=0.60, gaba=0.45):
    //   old riskFraction = max(0.1, 0.37 × 0.60 × 0.55) = max(0.1, 0.12) = 0.12
    //   old cap = floor(1000 × 0.12 × 10 / 20.8) = floor(57.7) = 57
    // Kelly-primary with positive edge 0.5 and matching modulator:
    //   modulator(0.37, 0.45) = 1 + 0.5×tanh((0.37-0.5)-(0.45-0.5)) = 1 + 0.5×tanh(-0.08) ≈ 0.96
    //   riskFraction = 0.5 × 0.96 = 0.48
    //   kellyCap = floor(1000 × 0.48 × 10 / 20.8) = floor(230.8) = 230
    const kellyCap = kellyPrimaryContractCap(observers({
      kellyFraction: 0.5,
      chemistryModulator: 0.96,
    }));
    expect(kellyCap).toBe(230);
    // 4× the old cap at identical chemistry/equity. This is the loop-break.
  });
});
