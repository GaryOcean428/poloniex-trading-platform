/**
 * arbiter.test.ts — capital allocation between Agent K and Agent M.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Arbiter, _resetArbiterForTest, getArbiter } from '../index.js';

describe('Arbiter — bootstrap', () => {
  it('returns 50/50 when neither agent has enough closed trades', () => {
    const a = new Arbiter();
    const split = a.allocate(100);
    expect(split.k).toBeCloseTo(50);
    expect(split.m).toBeCloseTo(50);
  });

  it('stays in bootstrap until BOTH agents reach the minimum', () => {
    const a = new Arbiter();
    // Only K has closed trades — M is still empty
    for (let i = 0; i < 10; i++) a.recordSettled('K', 1.0);
    const split = a.allocate(100);
    expect(split.k).toBeCloseTo(50);
    expect(split.m).toBeCloseTo(50);
  });
});

describe('Arbiter — allocation skews to winner', () => {
  it('skews toward K when K wins consistently', () => {
    const a = new Arbiter();
    for (let i = 0; i < 10; i++) a.recordSettled('K', 5.0);
    for (let i = 0; i < 10; i++) a.recordSettled('M', -5.0);
    const split = a.allocate(100);
    expect(split.k).toBeGreaterThan(50);
    expect(split.m).toBeLessThan(50);
  });

  it('skews toward M when M wins consistently', () => {
    const a = new Arbiter();
    for (let i = 0; i < 10; i++) a.recordSettled('K', -5.0);
    for (let i = 0; i < 10; i++) a.recordSettled('M', 5.0);
    const split = a.allocate(100);
    expect(split.m).toBeGreaterThan(50);
    expect(split.k).toBeLessThan(50);
  });

  it('stays balanced when totals are equal', () => {
    const a = new Arbiter();
    for (let i = 0; i < 10; i++) {
      a.recordSettled('K', 2.0);
      a.recordSettled('M', 2.0);
    }
    const split = a.allocate(100);
    expect(split.k).toBeCloseTo(50, 1);
    expect(split.m).toBeCloseTo(50, 1);
  });
});

describe('Arbiter — minimum share floor', () => {
  it('floors loser at 10 % even with extreme PnL gap', () => {
    const a = new Arbiter();
    // K crushes M
    for (let i = 0; i < 50; i++) a.recordSettled('K', 1000);
    for (let i = 0; i < 50; i++) a.recordSettled('M', -1000);
    const split = a.allocate(1000);
    expect(split.k / 1000).toBeCloseTo(0.9, 5);
    expect(split.m / 1000).toBeCloseTo(0.1, 5);
  });

  it('respects custom minShare', () => {
    const a = new Arbiter({ minShare: 0.20 });
    for (let i = 0; i < 50; i++) a.recordSettled('K', 1000);
    for (let i = 0; i < 50; i++) a.recordSettled('M', -1000);
    const split = a.allocate(1000);
    expect(split.k / 1000).toBeCloseTo(0.8, 5);
    expect(split.m / 1000).toBeCloseTo(0.2, 5);
  });
});

describe('Arbiter — window trimming', () => {
  it('trims to window size', () => {
    const a = new Arbiter({ window: 5 });
    for (let i = 0; i < 20; i++) a.recordSettled('K', i);
    const snap = a.snapshot(100);
    expect(snap.k_trades_in_window).toBe(5);
    // Only the last 5 (15..19) should remain
    expect(snap.k_pnl_window_total).toBe(15 + 16 + 17 + 18 + 19);
  });

  it('telemetry reports current window state', () => {
    const a = new Arbiter();
    for (let i = 0; i < 10; i++) a.recordSettled('K', 2);
    for (let i = 0; i < 10; i++) a.recordSettled('M', -1);
    const snap = a.snapshot(100);
    expect(snap.k_trades_in_window).toBe(10);
    expect(snap.m_trades_in_window).toBe(10);
    expect(snap.k_pnl_window_total).toBe(20);
    expect(snap.m_pnl_window_total).toBe(-10);
    expect(snap.k_share + snap.m_share).toBeCloseTo(1, 5);
  });
});

describe('Arbiter — integration: 10-tick simulations', () => {
  it('simulates 10 K-winning ticks, allocation skews to K', () => {
    const a = new Arbiter();
    // Pre-seed enough closed trades to leave bootstrap
    for (let i = 0; i < 5; i++) {
      a.recordSettled('K', 0);
      a.recordSettled('M', 0);
    }
    // 10 K wins + 10 M losses
    for (let tick = 0; tick < 10; tick++) {
      a.recordSettled('K', 1.0);
      a.recordSettled('M', -1.0);
    }
    const split = a.allocate(100);
    expect(split.k).toBeGreaterThan(split.m);
  });

  it('simulates 10 M-winning ticks, allocation skews to M', () => {
    const a = new Arbiter();
    for (let i = 0; i < 5; i++) {
      a.recordSettled('K', 0);
      a.recordSettled('M', 0);
    }
    for (let tick = 0; tick < 10; tick++) {
      a.recordSettled('K', -1.0);
      a.recordSettled('M', 1.0);
    }
    const split = a.allocate(100);
    expect(split.m).toBeGreaterThan(split.k);
  });

  it('simulates 10 tied ticks, allocation stays roughly balanced', () => {
    const a = new Arbiter();
    for (let i = 0; i < 5; i++) {
      a.recordSettled('K', 0);
      a.recordSettled('M', 0);
    }
    for (let tick = 0; tick < 10; tick++) {
      a.recordSettled('K', 0.5);
      a.recordSettled('M', 0.5);
    }
    const split = a.allocate(100);
    expect(Math.abs(split.k - split.m)).toBeLessThan(1);
  });
});

describe('Arbiter — singleton', () => {
  beforeEach(() => _resetArbiterForTest());
  it('getArbiter returns the same instance across calls', () => {
    const a = getArbiter();
    const b = getArbiter();
    expect(a).toBe(b);
  });
  it('singleton reset replaces the instance', () => {
    const a = getArbiter();
    _resetArbiterForTest();
    const b = getArbiter();
    expect(a).not.toBe(b);
  });
});

describe('Arbiter — edge cases', () => {
  it('handles zero capital gracefully', () => {
    const a = new Arbiter();
    const split = a.allocate(0);
    expect(split.k).toBe(0);
    expect(split.m).toBe(0);
  });

  it('handles negative capital gracefully', () => {
    const a = new Arbiter();
    const split = a.allocate(-10);
    expect(split.k).toBe(0);
    expect(split.m).toBe(0);
  });

  it('ignores NaN pnl', () => {
    const a = new Arbiter();
    a.recordSettled('K', NaN);
    const snap = a.snapshot(100);
    expect(snap.k_trades_in_window).toBe(0);
  });
});
