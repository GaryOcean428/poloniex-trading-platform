import { describe, it, expect } from 'vitest';
import { Arbiter } from '../arbiter.js';

describe('Arbiter', () => {
  it('splits 50/50 with insufficient data', () => {
    const a = new Arbiter();
    const alloc = a.allocate(100);
    expect(alloc.k).toBeCloseTo(50);
    expect(alloc.m).toBeCloseTo(50);
  });

  it('still 50/50 with only 4 trades each (below warmup)', () => {
    const a = new Arbiter();
    for (let i = 0; i < 4; i++) {
      a.recordSettled('K', 10);
      a.recordSettled('M', -10);
    }
    const alloc = a.allocate(100);
    expect(alloc.k).toBeCloseTo(50);
    expect(alloc.m).toBeCloseTo(50);
  });

  it('floors at 10% even when one agent dominates', () => {
    const a = new Arbiter();
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 100);
      a.recordSettled('M', -100);
    }
    const alloc = a.allocate(100);
    expect(alloc.m).toBeCloseTo(10, 5);
    expect(alloc.k).toBeCloseTo(90, 5);
    expect(alloc.k + alloc.m).toBeCloseTo(100);
  });

  it('skews toward winner without saturating', () => {
    const a = new Arbiter();
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 2);
      a.recordSettled('M', -1);
    }
    const alloc = a.allocate(100);
    expect(alloc.k).toBeGreaterThan(50);
    expect(alloc.m).toBeLessThan(50);
    expect(alloc.k).toBeLessThan(90); // not saturated
    expect(alloc.k + alloc.m).toBeCloseTo(100);
  });

  it('rolls window — only last N trades count', () => {
    const a = new Arbiter({ window: 50 });
    // Old K losses, then 50 wins push them out of the rolling window.
    for (let i = 0; i < 50; i++) a.recordSettled('K', -10);
    for (let i = 0; i < 50; i++) a.recordSettled('K', 10);
    for (let i = 0; i < 50; i++) a.recordSettled('M', 0);
    const alloc = a.allocate(100);
    expect(alloc.k).toBeGreaterThan(alloc.m); // K's losses rolled off
  });

  it('returns 0/0 when total capital is zero', () => {
    const a = new Arbiter();
    expect(a.allocate(0)).toEqual({ k: 0, m: 0 });
  });

  it('snapshot reports current state', () => {
    const a = new Arbiter();
    a.recordSettled('K', 5);
    a.recordSettled('M', -3);
    const s = a.snapshot();
    expect(s.kPnlWindowTotal).toBe(5);
    expect(s.mPnlWindowTotal).toBe(-3);
    expect(s.kTradesInWindow).toBe(1);
    expect(s.mTradesInWindow).toBe(1);
    expect(s.kShare).toBe(0.5);  // below warmup
    expect(s.mShare).toBe(0.5);
  });

  it('snapshot reflects post-warmup allocation', () => {
    const a = new Arbiter();
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 1);
      a.recordSettled('M', -1);
    }
    const s = a.snapshot(100);
    expect(s.kShare).toBeGreaterThan(0.5);
    expect(s.mShare).toBeLessThan(0.5);
    expect(s.kShare + s.mShare).toBeCloseTo(1);
  });

  it('configurable minShare', () => {
    const a = new Arbiter({ minShare: 0.20 });
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 100);
      a.recordSettled('M', -100);
    }
    const alloc = a.allocate(100);
    // floor at 20% — allow tiny float precision tolerance
    expect(alloc.m).toBeCloseTo(20, 5);
    expect(alloc.k).toBeCloseTo(80, 5);
  });

  it('handles equal performance with 50/50', () => {
    const a = new Arbiter();
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 5);
      a.recordSettled('M', 5);
    }
    const alloc = a.allocate(100);
    expect(alloc.k).toBeCloseTo(50);
    expect(alloc.m).toBeCloseTo(50);
  });
});
