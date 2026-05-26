/**
 * positionContractsBound.test.ts — pure-helper tests for the per-position
 * contracts cap.
 *
 * Phase 9 (2026-05-27): MONKEY_MAX_CONTRACTS_PER_POSITION env knob and
 * `getMaxContractsPerPosition()` removed. The venue-derived ceiling
 * `VENUE_CONTRACTS_CEILING` (8000 = 10000 venue cap − 2000 chunker buffer)
 * remains as a structural wall. The typical operating cap is now
 * `kernelDerivedContractCap()`, computed from observables.
 */
import { describe, it, expect } from 'vitest';
import {
  VENUE_CONTRACTS_CEILING,
  kernelDerivedContractCap,
  headroomContracts,
  clampNewContractsToCap,
} from '../positionContractsBound.js';

describe('VENUE_CONTRACTS_CEILING', () => {
  it('is 8000 (venue 10000 − 2000 chunker buffer)', () => {
    expect(VENUE_CONTRACTS_CEILING).toBe(8000);
  });
});

describe('kernelDerivedContractCap', () => {
  const baseObservers = {
    availableEquityUsdt: 1000,
    markPrice: 2000,    // ETH-ish
    contractSize: 0.01, // ETH contract size
    leverage: 10,
    dopamine: 0.5,
    phi: 0.5,
    gaba: 0.5,
  };

  it('scales with risk fraction × equity × leverage / (mark × contractSize)', () => {
    // risk_fraction = max(0.1, 0.5 × 0.5 × 0.5) = max(0.1, 0.125) = 0.125
    // cap = floor((1000 × 0.125 × 10) / (2000 × 0.01)) = floor(1250 / 20) = 62
    expect(kernelDerivedContractCap(baseObservers)).toBe(62);
  });

  it('floors risk fraction at 0.1 SAFETY_BOUND', () => {
    // gaba=0.95 → (1 - 0.95) = 0.05 → 0.5 × 0.5 × 0.05 = 0.0125 → clamped to 0.1
    // cap = floor((1000 × 0.1 × 10) / (2000 × 0.01)) = floor(1000 / 20) = 50
    expect(kernelDerivedContractCap({ ...baseObservers, gaba: 0.95 })).toBe(50);
  });

  it('caps at VENUE_CONTRACTS_CEILING regardless of kernel envelope', () => {
    // Huge equity + max risk-fraction → kernel cap exceeds venue ceiling.
    // Result: clamped to 8000.
    expect(kernelDerivedContractCap({
      ...baseObservers,
      availableEquityUsdt: 1_000_000,
      dopamine: 1, phi: 1, gaba: 0,
    })).toBe(VENUE_CONTRACTS_CEILING);
  });

  it('zero equity → zero cap (kernel cannot open anything)', () => {
    expect(kernelDerivedContractCap({ ...baseObservers, availableEquityUsdt: 0 }))
      .toBe(0);
  });

  it('higher dopamine → larger cap (kernel willing to expose more)', () => {
    const low = kernelDerivedContractCap({ ...baseObservers, dopamine: 0.2 });
    const high = kernelDerivedContractCap({ ...baseObservers, dopamine: 0.9 });
    expect(high).toBeGreaterThan(low);
  });

  it('higher gaba → smaller cap (kernel more inhibited)', () => {
    const calm = kernelDerivedContractCap({ ...baseObservers, gaba: 0.1 });
    const anxious = kernelDerivedContractCap({ ...baseObservers, gaba: 0.8 });
    expect(anxious).toBeLessThan(calm);
  });
});

describe('headroomContracts', () => {
  it('returns full cap when no contracts are open', () => {
    expect(headroomContracts(0, 8000)).toBe(8000);
  });

  it('returns difference when within cap', () => {
    expect(headroomContracts(3000, 8000)).toBe(5000);
  });

  it('returns zero at cap', () => {
    expect(headroomContracts(8000, 8000)).toBe(0);
  });

  it('floors at zero when over cap (does not return negative)', () => {
    expect(headroomContracts(12000, 8000)).toBe(0);
  });

  it('returns full cap on negative current (defensive)', () => {
    expect(headroomContracts(-100, 8000)).toBe(8000);
  });

  it('returns zero on degenerate cap', () => {
    expect(headroomContracts(0, 0)).toBe(0);
    expect(headroomContracts(0, NaN)).toBe(0);
    expect(headroomContracts(0, -10)).toBe(0);
  });
});

describe('clampNewContractsToCap', () => {
  it('returns desired when fully within headroom', () => {
    expect(clampNewContractsToCap(2000, 3000, 8000)).toBe(2000);
  });

  it('clamps to headroom when desired exceeds it', () => {
    expect(clampNewContractsToCap(6000, 5000, 8000)).toBe(3000);
  });

  it('returns zero when at cap', () => {
    expect(clampNewContractsToCap(2000, 8000, 8000)).toBe(0);
  });

  it('returns zero when over cap', () => {
    expect(clampNewContractsToCap(2000, 12000, 8000)).toBe(0);
  });

  it('returns zero on degenerate desired', () => {
    expect(clampNewContractsToCap(0, 0, 8000)).toBe(0);
    expect(clampNewContractsToCap(-100, 0, 8000)).toBe(0);
    expect(clampNewContractsToCap(NaN, 0, 8000)).toBe(0);
  });
});

describe('positionContractsBound — live-tape scenario', () => {
  it('reproduces the 2026-05-06 BTC stale_bleed prevention case', () => {
    // 12 BTC trend rows had cumulative quantity > 10,000 contracts.
    // With the cap at 8,000, the 9th pyramid unit would have been clamped
    // before crossing — closeChunker stays as the safety net for edge
    // cases (manual entries, hot reloads), but normal operation never
    // produces a position the kernel can't close in one order.
    const currentContracts = 7900;
    const desiredAdd = 1500;
    const clamped = clampNewContractsToCap(desiredAdd, currentContracts, 8000);
    expect(clamped).toBe(100);  // exactly the headroom remaining
    expect(currentContracts + clamped).toBe(8000);
  });

  it('full-cap rejection — no entry placed when at-cap', () => {
    const currentContracts = 8000;
    const desiredAdd = 500;
    const clamped = clampNewContractsToCap(desiredAdd, currentContracts, 8000);
    expect(clamped).toBe(0);
  });
});
