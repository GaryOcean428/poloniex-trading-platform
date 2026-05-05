/**
 * closeChunker.test.ts — verifies the close-chunking math.
 *
 * Live tape evidence: 2026-05-05 02:08 — BTC scalp_exit hit Poloniex code
 * 21010 because the position was > 10,000 contracts. Pre-chunker, the kernel
 * retried the same oversized close every tick. This module ensures any
 * close → ≤ 9,999 contracts per order with lot-size respected.
 */
import { describe, it, expect } from 'vitest';
import {
  planCloseChunks,
  MAX_CONTRACTS_PER_ORDER,
} from '../closeChunker.js';

describe('planCloseChunks defaults', () => {
  it('MAX_CONTRACTS_PER_ORDER is 9999 (under Poloniex 10000 cap)', () => {
    expect(MAX_CONTRACTS_PER_ORDER).toBe(9999);
  });
});

describe('planCloseChunks — single-chunk cases', () => {
  it('size below cap returns single chunk', () => {
    const out = planCloseChunks(5000, 1);
    expect(out.chunks).toEqual([5000]);
    expect(out.totalCovered).toBe(5000);
    expect(out.residual).toBe(0);
  });

  it('size exactly at cap returns single chunk', () => {
    const out = planCloseChunks(9999, 1);
    expect(out.chunks).toEqual([9999]);
    expect(out.totalCovered).toBe(9999);
  });

  it('size at exchange cap (10000) returns 9999 + 1', () => {
    const out = planCloseChunks(10000, 1);
    expect(out.chunks).toEqual([9999, 1]);
    expect(out.totalCovered).toBe(10000);
  });
});

describe('planCloseChunks — oversized positions', () => {
  it('15000 contracts splits into 9999 + 5001', () => {
    const out = planCloseChunks(15000, 1);
    expect(out.chunks).toEqual([9999, 5001]);
    expect(out.totalCovered).toBe(15000);
  });

  it('30000 contracts splits into 9999 × 3 + 3', () => {
    const out = planCloseChunks(30000, 1);
    expect(out.chunks).toEqual([9999, 9999, 9999, 3]);
    expect(out.totalCovered).toBe(30000);
  });

  it('25000 contracts splits into 9999, 9999, 5002', () => {
    const out = planCloseChunks(25000, 1);
    expect(out.chunks).toEqual([9999, 9999, 5002]);
    expect(out.totalCovered).toBe(25000);
  });
});

describe('planCloseChunks — lot-size respect', () => {
  it('lot=10: chunks rounded down to multiples of 10', () => {
    const out = planCloseChunks(15000, 10);
    expect(out.chunks).toEqual([9990, 5010]);
    expect(out.totalCovered).toBe(15000);
    expect(out.chunks.every((c) => c % 10 === 0)).toBe(true);
  });

  it('lot=100: 15050 → 9900 + 5100 (residual 50 stranded)', () => {
    const out = planCloseChunks(15050, 100);
    expect(out.chunks).toEqual([9900, 5100]);
    expect(out.totalCovered).toBe(15000);
    expect(out.residual).toBe(50);
  });

  it('lot=0 falls back to no rounding', () => {
    const out = planCloseChunks(12345, 0);
    expect(out.chunks).toEqual([9999, 2346]);
    expect(out.totalCovered).toBe(12345);
  });
});

describe('planCloseChunks — degenerate inputs', () => {
  it('zero desired returns empty plan', () => {
    const out = planCloseChunks(0, 1);
    expect(out.chunks).toEqual([]);
    expect(out.totalCovered).toBe(0);
    expect(out.residual).toBe(0);
  });

  it('negative desired returns empty plan', () => {
    const out = planCloseChunks(-100, 1);
    expect(out.chunks).toEqual([]);
    expect(out.totalCovered).toBe(0);
  });

  it('NaN/Infinity desired returns empty plan', () => {
    expect(planCloseChunks(NaN, 1).chunks).toEqual([]);
    expect(planCloseChunks(Infinity, 1).chunks).toEqual([]);
  });

  it('zero maxPerOrder marks everything residual', () => {
    const out = planCloseChunks(5000, 1, 0);
    expect(out.chunks).toEqual([]);
    expect(out.residual).toBe(5000);
  });
});

describe('planCloseChunks — live-tape scenario', () => {
  it('reproduces the 2026-05-05 BTC stale_bleed case (size > 10000, lot=1)', () => {
    // Position size that triggered code 21010 — anything > 10000 contracts.
    // Verify we now produce a valid multi-chunk plan instead of a single
    // oversized order.
    const stuckSize = 12500;
    const out = planCloseChunks(stuckSize, 1);
    expect(out.chunks.length).toBeGreaterThan(1);
    expect(out.chunks.every((c) => c <= MAX_CONTRACTS_PER_ORDER)).toBe(true);
    expect(out.totalCovered).toBe(stuckSize);
  });
});
