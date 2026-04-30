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

describe('Arbiter N-agent (proposal #6)', () => {
  it('allocateMany with N=2 matches legacy allocate', () => {
    const a = new Arbiter();
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 2);
      a.recordSettled('M', -1);
    }
    const legacy = a.allocate(100);
    const many = a.allocateMany(100, ['K', 'M']);
    expect(many.K).toBeCloseTo(legacy.k, 8);
    expect(many.M).toBeCloseTo(legacy.m, 8);
    expect(many.K! + many.M!).toBeCloseTo(100);
  });

  it('bootstraps to uniform 1/N when any agent below warmup (N=3)', () => {
    const a = new Arbiter();
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 1);
      a.recordSettled('M', 1);
    }
    // K2 hasn't accumulated trades yet -> uniform.
    const m = a.allocateMany(120, ['K', 'M', 'K2']);
    expect(m.K).toBeCloseTo(40, 5);
    expect(m.M).toBeCloseTo(40, 5);
    expect(m.K2).toBeCloseTo(40, 5);
  });

  it('post-warmup softmax with N=3 — winner gets larger share', () => {
    const a = new Arbiter({ minShare: 0.0 });  // disable floor for clean ordering
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 5);
      a.recordSettled('M', -1);
      a.recordSettled('K2', 0);
    }
    const m = a.allocateMany(100, ['K', 'M', 'K2']);
    expect(m.K).toBeGreaterThan(m.K2!);
    expect(m.K2).toBeGreaterThan(m.M!);
    const total = m.K! + m.M! + m.K2!;
    expect(total).toBeCloseTo(100, 4);
  });

  it('respects min-share floor with N=5', () => {
    const a = new Arbiter();
    const labels = ['K', 'M', 'K2', 'K3', 'K4'];
    // Saturate K with wins; everyone else loses.
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 100);
      a.recordSettled('M', -100);
      a.recordSettled('K2', -100);
      a.recordSettled('K3', -100);
      a.recordSettled('K4', -100);
    }
    const m = a.allocateMany(100, labels);
    // Each laggard must be at least the adaptive floor 0.5/5 = 0.10.
    for (const label of labels.slice(1)) {
      expect(m[label]).toBeGreaterThanOrEqual(0.10 * 100 - 1e-6);
    }
    const total = labels.reduce((s, l) => s + (m[l] ?? 0), 0);
    expect(total).toBeCloseTo(100, 4);
  });

  it('bootstrap with non-uniform completion is uniform until all warm', () => {
    const a = new Arbiter({ warmupTrades: 5 });
    // K reaches warmup, M does not.
    for (let i = 0; i < 5; i++) a.recordSettled('K', 10);
    for (let i = 0; i < 4; i++) a.recordSettled('M', 10);
    const m = a.allocateMany(100, ['K', 'M']);
    expect(m.K).toBeCloseTo(50);
    expect(m.M).toBeCloseTo(50);
  });

  it('returns 0 for every agent when total capital is zero', () => {
    const a = new Arbiter();
    const m = a.allocateMany(0, ['K', 'M', 'K2']);
    expect(m.K).toBe(0);
    expect(m.M).toBe(0);
    expect(m.K2).toBe(0);
  });

  it('returns empty record for empty agent list', () => {
    const a = new Arbiter();
    const m = a.allocateMany(100, []);
    expect(Object.keys(m).length).toBe(0);
  });

  it('rejects invalid agent labels at recordSettled', () => {
    const a = new Arbiter();
    expect(() => a.recordSettled('lowercase', 1)).toThrow();
    expect(() => a.recordSettled('1NUM', 1)).toThrow();
    expect(() => a.recordSettled('', 1)).toThrow();
    expect(() => a.recordSettled('K-2', 1)).toThrow();  // hyphen rejected
    expect(() => a.recordSettled('K2', 1)).not.toThrow();
    expect(() => a.recordSettled('K_VAR_2', 1)).not.toThrow();
  });

  it('snapshotMany reports per-agent stats', () => {
    const a = new Arbiter();
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 1);
      a.recordSettled('M', -1);
      a.recordSettled('K2', 0);
    }
    const snap = a.snapshotMany(100, ['K', 'M', 'K2']);
    expect(snap.K!.tradesInWindow).toBe(50);
    expect(snap.K!.pnlWindowTotal).toBeCloseTo(50);
    expect(snap.M!.pnlWindowTotal).toBeCloseTo(-50);
    expect(snap.K2!.pnlWindowTotal).toBeCloseTo(0);
    const totalShare = snap.K!.share + snap.M!.share + snap.K2!.share;
    expect(totalShare).toBeCloseTo(1, 4);
  });

  it('agents() lists tracked labels', () => {
    const a = new Arbiter();
    a.recordSettled('K2', 1);
    const labels = a.agents();
    expect(labels).toContain('K');
    expect(labels).toContain('M');
    expect(labels).toContain('K2');
  });

  it('window rolls per-label independently', () => {
    const a = new Arbiter({ window: 3 });
    for (let i = 0; i < 5; i++) a.recordSettled('K2', i);
    const snap = a.snapshotMany(100, ['K2']);
    // Only the last 3 (2 + 3 + 4 = 9) survive.
    expect(snap.K2!.tradesInWindow).toBe(3);
    expect(snap.K2!.pnlWindowTotal).toBe(9);
  });

  it('configurable explicit minShare is honored', () => {
    const a = new Arbiter({ minShare: 0.05 });
    const labels = ['K', 'M', 'K2', 'K3'];
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 100);
      for (const lab of labels.slice(1)) a.recordSettled(lab, -100);
    }
    const m = a.allocateMany(100, labels);
    // Each laggard at least 0.05 * 100 = 5 USDT.
    for (const lab of labels.slice(1)) {
      expect(m[lab]).toBeGreaterThanOrEqual(5 - 1e-6);
    }
  });
});
