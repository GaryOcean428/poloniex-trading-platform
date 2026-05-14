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
    // maxAbsPnlPerTrade: Infinity — this test exercises the floor
    // mechanism under extreme PnL contrast; the per-trade winsorization
    // clamp would otherwise tame the 100/-100 contrast it relies on.
    const a = new Arbiter({ maxAbsPnlPerTrade: Infinity });
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
    // Infinity clamp — extreme-contrast floor test (see note above).
    const a = new Arbiter({ minShare: 0.20, maxAbsPnlPerTrade: Infinity });
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
    // Infinity clamp — extreme-contrast floor test (see note above).
    const a = new Arbiter({ maxAbsPnlPerTrade: Infinity });
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
    // Infinity clamp — extreme-contrast floor test (see note above).
    const a = new Arbiter({ minShare: 0.05, maxAbsPnlPerTrade: Infinity });
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

// ────────────────────────────────────────────────────────────────────────
// rehydrate — seed the rolling windows from persisted history so a fresh
// instance (every Railway redeploy) doesn't fall back to uniform bootstrap.
// ────────────────────────────────────────────────────────────────────────

describe('Arbiter.rehydrate', () => {
  it('windowSize exposes the rolling-window length', () => {
    expect(new Arbiter().windowSize).toBe(50);
    expect(new Arbiter({ window: 17 }).windowSize).toBe(17);
  });

  it('seeds per-agent windows so the allocator escapes bootstrap immediately', () => {
    const a = new Arbiter();
    // Without rehydrate this is uniform (bootstrap). With history where K
    // loses and M wins, M must get the larger share on the very first call.
    const history: { agent: string; pnl: number }[] = [];
    for (let i = 0; i < 50; i++) {
      history.push({ agent: 'K', pnl: -5 });
      history.push({ agent: 'M', pnl: 5 });
    }
    a.rehydrate(history);
    const alloc = a.allocate(100);
    expect(alloc.m).toBeGreaterThan(alloc.k);
    expect(alloc.k + alloc.m).toBeCloseTo(100);
  });

  it('respects the window cap — only the last N per agent are retained', () => {
    const a = new Arbiter({ window: 3 });
    a.rehydrate([
      { agent: 'K', pnl: -100 }, // rolls off
      { agent: 'K', pnl: -100 }, // rolls off
      { agent: 'K', pnl: 1 },
      { agent: 'K', pnl: 2 },
      { agent: 'K', pnl: 3 },
    ]);
    const snap = a.snapshotMany(100, ['K']);
    expect(snap.K!.tradesInWindow).toBe(3);
    expect(snap.K!.pnlWindowTotal).toBe(6); // 1 + 2 + 3, the old losses rolled off
  });

  it('skips malformed labels instead of throwing (unlike recordSettled)', () => {
    // recordSettled throws on a bad label; rehydrate runs over whatever
    // history the table holds, so it skip-not-throws. (Filtering to real
    // agent labels — K/M/T/L, excluding USER — is the caller query's job.)
    const a = new Arbiter();
    expect(() => a.rehydrate([
      { agent: 'lowercase', pnl: 1 }, // fails /^[A-Z]/ — skipped
      { agent: '', pnl: 1 },          // empty — skipped
      { agent: 'K-2', pnl: 1 },       // hyphen — skipped
      { agent: 'K', pnl: 5 },         // valid — ingested
    ])).not.toThrow();
    const snap = a.snapshotMany(100, ['K']);
    expect(snap.K!.tradesInWindow).toBe(1);
    expect(snap.K!.pnlWindowTotal).toBe(5);
  });

  it('skips non-finite PnL values', () => {
    const a = new Arbiter();
    a.rehydrate([
      { agent: 'K', pnl: Number.NaN },
      { agent: 'K', pnl: Number.POSITIVE_INFINITY },
      { agent: 'K', pnl: 7 },
    ]);
    const snap = a.snapshotMany(100, ['K']);
    expect(snap.K!.tradesInWindow).toBe(1);
    expect(snap.K!.pnlWindowTotal).toBe(7);
  });

  it('rehydrated history composes with subsequent live recordSettled calls', () => {
    const a = new Arbiter({ window: 50 });
    // 49 rehydrated K wins + 1 live K win = 50; M symmetric losses.
    const history: { agent: string; pnl: number }[] = [];
    for (let i = 0; i < 49; i++) {
      history.push({ agent: 'K', pnl: 3 });
      history.push({ agent: 'M', pnl: -3 });
    }
    a.rehydrate(history);
    a.recordSettled('K', 3);
    a.recordSettled('M', -3);
    const snap = a.snapshotMany(100, ['K', 'M']);
    expect(snap.K!.tradesInWindow).toBe(50);
    expect(snap.M!.tradesInWindow).toBe(50);
    expect(snap.K!.share).toBeGreaterThan(0.5);
  });
});

// ────────────────────────────────────────────────────────────────────────
// maxAbsPnlPerTrade — per-trade winsorization. One catastrophic trade (e.g.
// a pre-fix-era position that couldn't be exited) must not define an agent;
// the broad consistency signal must survive intact (failure not rewarded).
// ────────────────────────────────────────────────────────────────────────

describe('Arbiter — per-trade PnL winsorization (maxAbsPnlPerTrade)', () => {
  it('clamps a catastrophic loss in recordSettled (default cap 10)', () => {
    const a = new Arbiter();
    a.recordSettled('K', -24.49); // the 2026-05-13 whipsaw-cascade trade
    const snap = a.snapshotMany(100, ['K']);
    expect(snap.K!.pnlWindowTotal).toBe(-10); // clamped from -24.49
  });

  it('clamps a windfall symmetrically — no over-reward for one lucky trade', () => {
    const a = new Arbiter();
    a.recordSettled('L', 99);
    const snap = a.snapshotMany(100, ['L']);
    expect(snap.L!.pnlWindowTotal).toBe(10);
  });

  it('clamps in rehydrate too — startup is treated identically to live', () => {
    const a = new Arbiter();
    a.rehydrate([
      { agent: 'K', pnl: -24.49 },
      { agent: 'K', pnl: -19.19 },
      { agent: 'K', pnl: -15.20 },
      { agent: 'K', pnl: -0.5 }, // a routine small loss — untouched
    ]);
    const snap = a.snapshotMany(100, ['K']);
    // -10 -10 -10 -0.5 = -30.5, NOT the raw -59.38
    expect(snap.K!.pnlWindowTotal).toBeCloseTo(-30.5, 6);
    expect(snap.K!.tradesInWindow).toBe(4);
  });

  it('leaves routine trades untouched — only extremes are tamed', () => {
    const a = new Arbiter();
    for (const pnl of [-0.99, 2.1, -3.4, 0.5, -8.65, 9.9]) {
      a.recordSettled('K', pnl);
    }
    const snap = a.snapshotMany(100, ['K']);
    // none exceed ±10 — sum is exact
    expect(snap.K!.pnlWindowTotal).toBeCloseTo(-0.99 + 2.1 - 3.4 + 0.5 - 8.65 + 9.9, 6);
  });

  it('preserves the consistency signal — a steady small loser is still down-weighted', () => {
    // 50 small -1 losses for K, 50 small +1 wins for L. None hit the clamp,
    // so the broad "K is a drag" signal flows through fully.
    const a = new Arbiter();
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', -1);
      a.recordSettled('L', 1);
    }
    const m = a.allocateMany(100, ['K', 'L']);
    expect(m.L).toBeGreaterThan(m.K!); // failure still penalised
  });

  it('one catastrophe does not flip an otherwise-fine agent (clamp vs no clamp)', () => {
    // K: 49 small wins + 1 catastrophic -24.49. With the clamp the
    // catastrophe is bounded to -10, so K's window stays net-positive
    // and K is NOT down-weighted below an all-flat peer.
    const clamped = new Arbiter();
    const raw = new Arbiter({ maxAbsPnlPerTrade: Infinity });
    for (const a of [clamped, raw]) {
      for (let i = 0; i < 49; i++) { a.recordSettled('K', 1); a.recordSettled('M', 0); }
      a.recordSettled('K', -24.49);
      a.recordSettled('M', 0);
    }
    // clamped: K window = 49 - 10 = +39 → K still beats flat M
    expect(clamped.allocateMany(100, ['K', 'M']).K!).toBeGreaterThan(50);
    // raw: K window = 49 - 24.49 = +24.5 → still positive here, but the
    // catastrophe ate half of K's edge. The clamp preserves more of it.
    expect(clamped.sumPnl('K')).toBeGreaterThan(raw.sumPnl('K'));
  });
});
