/**
 * qigramv2WakeReconstruction.test.ts — Matrix tier-4 Phase D verification.
 *
 * The doctrine ([[polytrade-knob-free-recursive-doctrine]]):
 *   "QIGRAM basins persist with weights through sleep; wake reconstructs
 *    basin_0 from QIGRAM, not blank."
 *
 * These tests pin the contract: after snapshot → wipe → restore, the
 * full observable behavior (active entries, weights, kappa, sovereignty,
 * recall geometry) is BIT-IDENTICAL to the pre-sleep state.
 *
 * If a future change breaks the snapshot round-trip, this test file is
 * the doctrine boundary that catches it.
 */
import { describe, it, expect } from 'vitest';
import {
  QIGRAMv2State,
  QIGRAMv2Partition,
  makeBasinEntryV2,
  type Basin,
} from '../agent_L_qigram_v2.js';

function basinAt(i: number): Basin {
  // Generate a uniform-mass basin perturbed by index — distinct
  // basins for distinct indices, valid Δ⁶³ probability simplex.
  const v = new Float64Array(64);
  for (let k = 0; k < 64; k++) {
    v[k] = 1 / 64 + (k === i ? 0.001 : -0.001 / 63);
  }
  return v as Basin;
}

function populated(): QIGRAMv2State {
  const state = new QIGRAMv2State(100);
  for (let i = 0; i < 5; i++) {
    const e = makeBasinEntryV2(`basin-${i}`, basinAt(i), {
      weight: 1.0 - i * 0.15,
      correct: i % 2 === 0,
      category: i < 3 ? 'TREND' : 'CHOP',
      trajectory: { tickId: i * 100, mark: i * 50 },
    });
    state.loadFromLegacy([e]);
  }
  return state;
}

describe('QIGRAMv2State snapshot/restore — bit-identical state round-trip', () => {
  it('round-trips kappa exactly', () => {
    const a = new QIGRAMv2State(50);
    // Force kappa off the fixed point.
    a.tack(0.9, true);  // up-step
    a.tack(0.9, true);  // up-step
    const snap = a.snapshot();

    const b = new QIGRAMv2State(50);
    b.restoreFromSnapshot(snap);
    expect(b.kappa).toBe(a.kappa);
  });

  it('round-trips all entries with weights preserved', () => {
    const a = populated();
    const snap = a.snapshot();
    const b = new QIGRAMv2State(100);
    b.restoreFromSnapshot(snap);

    expect(b.totalEntries).toBe(a.totalEntries);
    const aActive = a.activeEntries().sort((x, y) => x.id.localeCompare(y.id));
    const bActive = b.activeEntries().sort((x, y) => x.id.localeCompare(y.id));
    expect(bActive.length).toBe(aActive.length);
    for (let i = 0; i < aActive.length; i++) {
      expect(bActive[i]!.id).toBe(aActive[i]!.id);
      expect(bActive[i]!.weight).toBe(aActive[i]!.weight);
      expect(bActive[i]!.correct).toBe(aActive[i]!.correct);
      expect(bActive[i]!.category).toBe(aActive[i]!.category);
      expect(bActive[i]!.basin).toEqual(aActive[i]!.basin);
      expect(bActive[i]!.trajectory).toEqual(aActive[i]!.trajectory);
    }
  });

  it('round-trips sovereignty', () => {
    const a = populated();
    const snap = a.snapshot();
    const b = new QIGRAMv2State(100);
    b.restoreFromSnapshot(snap);
    expect(b.sovereignty).toBe(a.sovereignty);
  });

  it('snapshot is deep — mutating the snapshot does NOT affect the source state', () => {
    const a = populated();
    const snap = a.snapshot();
    snap.entries[0]!.weight = 999;
    (snap.entries[0]!.basin as Float64Array)[0] = 999;
    snap.entries[0]!.trajectory.tickId = 9999;

    // Source untouched.
    const aActive = a.activeEntries().find((e) => e.id === 'basin-0');
    expect(aActive!.weight).toBe(1.0);
    expect(aActive!.basin[0]).not.toBe(999);
    expect(aActive!.trajectory.tickId).toBe(0);
  });

  it('restore is deep — mutating restored state does NOT affect the snapshot', () => {
    const a = populated();
    const snap = a.snapshot();
    const b = new QIGRAMv2State(100);
    b.restoreFromSnapshot(snap);

    // Decay in b should not reach back into the snapshot.
    b.decayAll();
    const sourceEntry = snap.entries.find((e) => e.id === 'basin-0');
    expect(sourceEntry!.weight).toBe(1.0);
  });

  it('restore REPLACES, not merges (post-sleep noise is discarded)', () => {
    const a = populated();
    const snap = a.snapshot();

    const b = new QIGRAMv2State(100);
    b.loadFromLegacy([{ id: 'post-sleep-noise', basin: basinAt(20), weight: 0.8 }]);
    expect(b.totalEntries).toBe(1);

    b.restoreFromSnapshot(snap);
    // Noise gone; only snapshot entries remain.
    expect(b.totalEntries).toBe(a.totalEntries);
    expect(b.activeEntries().some((e) => e.id === 'post-sleep-noise')).toBe(false);
  });

  it('recall geometry survives the round-trip', () => {
    const a = populated();
    const queryBasin = basinAt(2);
    const aRecall = a.recall(queryBasin);

    const snap = a.snapshot();
    const b = new QIGRAMv2State(100);
    b.restoreFromSnapshot(snap);
    const bRecall = b.recall(queryBasin);

    expect(bRecall).not.toBeNull();
    expect(aRecall).not.toBeNull();
    expect(bRecall!.source).toBe(aRecall!.source);
    expect(bRecall!.d_FR).toBeCloseTo(aRecall!.d_FR, 12);
    expect(bRecall!.weight).toBe(aRecall!.weight);
  });

  it('empty state round-trips to empty state', () => {
    const a = new QIGRAMv2State(50);
    const snap = a.snapshot();
    expect(snap.entries.length).toBe(0);

    const b = new QIGRAMv2State(50);
    b.restoreFromSnapshot(snap);
    expect(b.totalEntries).toBe(0);
  });
});

describe('QIGRAMv2Partition snapshot/restore — per-symbol isolation', () => {
  it('round-trips multi-symbol partition state', () => {
    const a = new QIGRAMv2Partition(50);
    a.store('BTC', 'btc-1', basinAt(1), { category: 'TREND' });
    a.store('ETH', 'eth-1', basinAt(2), { category: 'CHOP' });
    a.store('ETH', 'eth-2', basinAt(3), { category: 'CHOP' });

    const snap = a.snapshot();
    const b = new QIGRAMv2Partition(50);
    b.restoreFromSnapshot(snap);

    expect(b.totalEntries('BTC')).toBe(1);
    expect(b.totalEntries('ETH')).toBe(2);
    expect(b.symbols().sort()).toEqual(['BTC', 'ETH']);
  });

  it('snapshot ignores symbols not in the partition', () => {
    const a = new QIGRAMv2Partition(50);
    a.store('BTC', 'btc-1', basinAt(1));
    const snap = a.snapshot();
    expect(Object.keys(snap)).toEqual(['BTC']);
  });

  it('partial snapshot does not wipe symbols missing from the payload', () => {
    const a = new QIGRAMv2Partition(50);
    a.store('BTC', 'btc-1', basinAt(1));
    a.store('ETH', 'eth-1', basinAt(2));

    // Only snapshot BTC.
    const partialSnap = { BTC: a.snapshot().BTC! };
    a.restoreFromSnapshot(partialSnap);

    // ETH state remains.
    expect(a.totalEntries('ETH')).toBe(1);
    expect(a.totalEntries('BTC')).toBe(1);
  });
});

describe('Wake-reconstruction simulates the doctrine sleep cycle', () => {
  it('full sleep-cycle round-trip: populate → sleep (snapshot) → wipe → wake (restore)', () => {
    // 1. Pre-sleep kernel — accumulate basins through ticks.
    const pre = new QIGRAMv2Partition(100);
    for (let i = 0; i < 10; i++) {
      pre.store('BTC', `btc-${i}`, basinAt(i % 32), { category: i % 2 ? 'TREND' : 'CHOP' });
    }
    for (let i = 0; i < 5; i++) {
      pre.recordOutcome('BTC', `btc-${i}`, i < 3);  // first 3 correct
    }

    const sov_pre = pre.sovereignty('BTC');
    const active_pre = pre.activeEntries('BTC').length;

    // 2. Sleep entry — snapshot persists.
    const snap = pre.snapshot();

    // 3. Wipe — kernel "sleeps" (in-memory state dissolved).
    // 4. Wake — fresh partition restores from snapshot.
    const post = new QIGRAMv2Partition(100);
    post.restoreFromSnapshot(snap);

    // Contract: basins persist with weights. Sovereignty + active
    // count unchanged. basin_0 is NOT blank.
    expect(post.sovereignty('BTC')).toBe(sov_pre);
    expect(post.activeEntries('BTC').length).toBe(active_pre);
    expect(post.totalEntries('BTC')).toBe(pre.totalEntries('BTC'));
  });
});
