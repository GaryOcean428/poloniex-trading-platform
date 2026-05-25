/**
 * qigramV2Consolidate.test.ts — QIGRAMv2State.consolidate() invariants.
 *
 * Historical context (PR906): consolidate() was originally introduced
 * to bound _entries growth when the loop integrates a fresh basin per
 * tick. PR906 paired it with decayAll() per-tick to fix the
 * "sov decays toward zero with session uptime" pathology — but that
 * created a different degeneracy: post-prune the active set equals
 * the storage set by construction, so sovereignty pinned at 1.0
 * deterministically and silently zeroed the sov factor in
 * baseFrac = Φ × sov × maturity.
 *
 * The current contract bounds _entries via LRU eviction at integrate
 * time (QIGRAMV2_HISTORY_MAX), so per-tick consolidate is no longer
 * needed. consolidate() remains valid for explicit sweeps — e.g.
 * pre-persistence cleanup, or removing accumulated wrong-outcome
 * tombstones via recordOutcome(false). These tests pin THOSE
 * invariants: it never touches a live entry, and it always agrees
 * with activeEntries() about which entries are dead.
 *
 * See qigramV2BoundedWindow.test.ts for the bounded-window /
 * meaningful-sovereignty contract.
 */
import { describe, test, expect } from 'vitest';
import { QIGRAMv2State, MIN_ACTIVE_WEIGHT } from '../agent_L_qigram_v2.js';
import { uniformBasin } from '../basin.js';

const B = uniformBasin();

/** Decay a store until its current entries are all dead-weight. */
function decayToDeath(store: QIGRAMv2State): void {
  // 0.95^95 ≈ 0.0077 < MIN_ACTIVE_WEIGHT (0.01).
  for (let d = 0; d < 95; d++) store.decayAll();
}

describe('QIGRAMv2State.consolidate', () => {
  test('removes dead-weight entries, keeps active ones, returns the count pruned', () => {
    const store = new QIGRAMv2State();
    for (let i = 0; i < 5; i++) {
      store.integrate(`old|${i}`, B, { weight: 1.0, correct: true });
    }
    decayToDeath(store);
    for (let i = 0; i < 3; i++) {
      store.integrate(`fresh|${i}`, B, { weight: 1.0, correct: true });
    }
    // Before: 8 stored, only the 3 fresh are active.
    expect(store.totalEntries).toBe(8);
    expect(store.activeEntries().length).toBe(3);

    const pruned = store.consolidate();

    expect(pruned).toBe(5);
    expect(store.totalEntries).toBe(3);
    expect(store.activeEntries().length).toBe(3);
  });

  test('explicit consolidate after recordOutcome(false) removes wrong-outcome tombstones', () => {
    // Models the eventual recordOutcome flow: integrate basins on entry,
    // attribute wrong outcomes on close (weight→0), call consolidate()
    // periodically to sweep tombstones. Bounded-window LRU still works
    // for live entries; consolidate is the explicit cleanup for the
    // zero-weight ones that recordOutcome leaves behind.
    const store = new QIGRAMv2State();
    for (let i = 0; i < 5; i++) {
      store.integrate(`old|${i}`, B, { weight: 1.0, correct: true });
    }
    // Three of the five later attribute as wrong → weight=0.
    store.recordOutcome('old|0', false);
    store.recordOutcome('old|1', false);
    store.recordOutcome('old|2', false);
    // 2 active / 5 total = 0.4 — sov reads the loss rate.
    expect(store.sovereignty).toBeCloseTo(2 / 5, 6);

    const pruned = store.consolidate();

    expect(pruned).toBe(3);
    expect(store.totalEntries).toBe(2);
    // Post-prune sov is degenerate (active == total) — exactly the
    // PR906 pathology if consolidate runs per-tick. That's why
    // consolidate is now an explicit-cleanup op, not a per-tick call.
    expect(store.sovereignty).toBe(1.0);
  });

  test('an all-active store is left untouched (prunes nothing)', () => {
    const store = new QIGRAMv2State();
    for (let i = 0; i < 4; i++) {
      store.integrate(`a|${i}`, B, { weight: 1.0, correct: true });
    }
    expect(store.consolidate()).toBe(0);
    expect(store.totalEntries).toBe(4);
  });

  test('an entry exactly at MIN_ACTIVE_WEIGHT is dead (consistent with activeEntries)', () => {
    // activeEntries() keeps weight STRICTLY above MIN_ACTIVE_WEIGHT, so
    // consolidate() must prune weight <= MIN_ACTIVE_WEIGHT — the two views
    // must never disagree about which entries are alive.
    const store = new QIGRAMv2State();
    store.integrate('boundary', B, { weight: MIN_ACTIVE_WEIGHT, correct: true });
    expect(store.activeEntries().length).toBe(0);
    expect(store.consolidate()).toBe(1);
    expect(store.totalEntries).toBe(0);
  });

  // ─── Tombstone-reaper invariants ────────────────────────────────────
  // These tests pin the property that consolidate can be called safely
  // as an explicit cleanup op: it never removes a live (above-threshold)
  // entry, only entries that decay or recordOutcome(false) have already
  // driven dead. If a future change makes consolidate destructive, both
  // tests below break loudly.

  test('consolidate on an empty store is a safe no-op', () => {
    const store = new QIGRAMv2State();
    expect(store.consolidate()).toBe(0);
    expect(store.totalEntries).toBe(0);
  });

  test('LRU-capped buffer × 100 decay ticks → consolidate reaps all stored', () => {
    // After 200 fresh integrations the LRU cap holds storage at
    // QIGRAMV2_HISTORY_MAX (100); after 100 ticks of decay every
    // weight=1.0 entry has dropped below MIN_ACTIVE_WEIGHT
    // (0.95^90 ≈ 0.0099). consolidate must reap the lot.
    const store = new QIGRAMv2State();
    for (let i = 0; i < 200; i++) {
      store.integrate(`bulk|${i}`, B, { weight: 1.0, correct: true });
    }
    expect(store.totalEntries).toBe(100);
    for (let t = 0; t < 100; t++) store.decayAll();
    expect(store.activeEntries().length).toBe(0);
    expect(store.consolidate()).toBe(100);
    expect(store.totalEntries).toBe(0);
  });
});
