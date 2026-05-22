/**
 * qigramV2Consolidate.test.ts — QIGRAMv2State.consolidate() (PR4).
 *
 * The sovereignty/sizing bug: loop.ts integrates a fresh basin every tick
 * with a unique `${symbol}|tick=N` key and decays all weights, but nothing
 * ever REMOVES decayed-dead entries. So `_entries.size` (the sovereignty
 * denominator) grows unboundedly with session uptime — sovereignty decays
 * ~90/tickCount toward 0, and `baseFrac = Φ × sovereignty × maturity`
 * collapses position size ~17× too small.
 *
 * consolidate() is the canonical fix — the sleep-cycle's CONSOLIDATING-phase
 * memory pass (mirrors qig-core 2.8.0 SleepCycleManager.consolidate(), which
 * prunes low-mass entries). It is SEPARATE from decayAll(): decay reduces
 * weight every tick; consolidate removes entries decay has already killed.
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

  test('sovereignty recovers from a decayed ratio to ~1.0 after consolidate', () => {
    const store = new QIGRAMv2State();
    for (let i = 0; i < 5; i++) {
      store.integrate(`old|${i}`, B, { weight: 1.0, correct: true });
    }
    decayToDeath(store);
    for (let i = 0; i < 3; i++) {
      store.integrate(`fresh|${i}`, B, { weight: 1.0, correct: true });
    }
    // The bug: 3 active / 8 total = 0.375 — depressed by dead tombstones.
    expect(store.sovereignty).toBeCloseTo(3 / 8, 6);

    store.consolidate();

    // After consolidation the denominator is the active set — sovereignty
    // reflects kernel health, not session uptime.
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
});
