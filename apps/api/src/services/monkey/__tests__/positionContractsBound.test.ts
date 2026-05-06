/**
 * positionContractsBound.test.ts — pure-helper tests for the per-position
 * contracts cap that prevents 21010-class oversized-position bugs at the
 * source rather than via the chunker downstream.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_CONTRACTS_PER_POSITION_DEFAULT,
  getMaxContractsPerPosition,
  headroomContracts,
  clampNewContractsToCap,
} from '../positionContractsBound.js';

describe('MAX_CONTRACTS_PER_POSITION_DEFAULT', () => {
  it('is 8000 (2000-contract buffer below Poloniex 10000 cap)', () => {
    expect(MAX_CONTRACTS_PER_POSITION_DEFAULT).toBe(8000);
  });
});

describe('getMaxContractsPerPosition', () => {
  it('returns default when env var is unset', () => {
    delete process.env.MONKEY_MAX_CONTRACTS_PER_POSITION;
    expect(getMaxContractsPerPosition()).toBe(8000);
  });

  it('honors env var override', () => {
    process.env.MONKEY_MAX_CONTRACTS_PER_POSITION = '5000';
    expect(getMaxContractsPerPosition()).toBe(5000);
    delete process.env.MONKEY_MAX_CONTRACTS_PER_POSITION;
  });

  it('falls back to default on non-numeric env', () => {
    process.env.MONKEY_MAX_CONTRACTS_PER_POSITION = 'abc';
    expect(getMaxContractsPerPosition()).toBe(8000);
    delete process.env.MONKEY_MAX_CONTRACTS_PER_POSITION;
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
