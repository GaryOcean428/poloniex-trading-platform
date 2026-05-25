/**
 * qigramV2BoundedWindow.test.ts — bounded-window sovereignty (post-PR906 follow-up).
 *
 * The PR906 "consolidate every tick" fix replaced one degenerate-sov pathology
 * with another. activeEntries() filters weight > MIN_ACTIVE_WEIGHT;
 * consolidate() deletes weight ≤ MIN_ACTIVE_WEIGHT. After per-tick
 * consolidate, the two views are bit-identical by construction and
 * sovereignty = active / total = 1.0 deterministically. The downstream
 * baseFrac = Φ × sov × maturity term collapses to baseFrac = Φ × maturity —
 * the sov factor is silently deleted from sizing.
 *
 * The fix: bound _entries at HISTORY_MAX (LRU eviction by insertion order),
 * stop per-tick consolidate. Then sovereignty = (active in last HISTORY_MAX)
 * / HISTORY_MAX ranges meaningfully — responds to decay over time, to
 * wrong-outcome zeroing (when recordOutcome wires), and to activity pauses.
 *
 * The follow-up architectural fix (separate sizing-sovereignty from
 * storage-fraction) is a larger PR. This file pins the LRU-bounded-window
 * contract.
 */
import { describe, test, expect } from 'vitest';
import { QIGRAMv2State, QIGRAMV2_HISTORY_MAX, MIN_ACTIVE_WEIGHT } from '../agent_L_qigram_v2.js';
import { uniformBasin } from '../basin.js';

const B = uniformBasin();

describe('QIGRAMv2State bounded window', () => {
  test('_entries.size never exceeds HISTORY_MAX under continuous integration', () => {
    const store = new QIGRAMv2State();
    for (let i = 0; i < QIGRAMV2_HISTORY_MAX * 3; i++) {
      store.integrate(`tick|${i}`, B, { weight: 1.0, correct: true });
    }
    expect(store.totalEntries).toBe(QIGRAMV2_HISTORY_MAX);
  });

  test('oldest entry is evicted (LRU by insertion order) when at capacity', () => {
    const store = new QIGRAMv2State();
    for (let i = 0; i < QIGRAMV2_HISTORY_MAX; i++) {
      store.integrate(`tick|${i}`, B, { weight: 1.0, correct: true });
    }
    expect(store.totalEntries).toBe(QIGRAMV2_HISTORY_MAX);
    // Insert one more — tick|0 should be evicted.
    store.integrate(`tick|${QIGRAMV2_HISTORY_MAX}`, B, { weight: 1.0, correct: true });
    expect(store.totalEntries).toBe(QIGRAMV2_HISTORY_MAX);
    // The recall pool must NOT contain the evicted oldest id.
    const ids = store.activeEntries().map((e) => e.id);
    expect(ids).not.toContain('tick|0');
    expect(ids).toContain(`tick|${QIGRAMV2_HISTORY_MAX}`);
  });

  test('re-integrating an existing id replaces in place — does NOT evict another', () => {
    const store = new QIGRAMv2State();
    for (let i = 0; i < QIGRAMV2_HISTORY_MAX; i++) {
      store.integrate(`tick|${i}`, B, { weight: 1.0, correct: true });
    }
    // Updating an existing entry should not change the storage footprint.
    store.integrate('tick|50', B, { weight: 1.0, correct: true });
    expect(store.totalEntries).toBe(QIGRAMV2_HISTORY_MAX);
    const ids = store.activeEntries().map((e) => e.id);
    expect(ids).toContain('tick|0');  // tick|0 must still be present
    expect(ids).toContain('tick|50');
  });

  test('sovereignty is NOT pinned at 1.0 in steady state — ranges meaningfully', () => {
    // Simulate the loop.ts per-tick pattern: integrate + decayAll every
    // tick, NO per-tick consolidate. Run long enough that decay drives
    // the oldest entries below MIN_ACTIVE_WEIGHT while LRU keeps them
    // stored. Active / total then reads "fraction of last N still hot."
    const store = new QIGRAMv2State();
    const TICKS = QIGRAMV2_HISTORY_MAX * 2;
    for (let i = 0; i < TICKS; i++) {
      store.integrate(`tick|${i}`, B, { weight: 1.0, correct: true });
      store.decayAll();
    }
    const sov = store.sovereignty;
    // Expectation: roughly the proportion of stored entries whose age in
    // ticks puts them above 0.95^age > MIN_ACTIVE_WEIGHT (~0.01), i.e.
    // age < 89.78. With HISTORY_MAX entries of ages 1..HISTORY_MAX, that
    // is min(HISTORY_MAX, 89) / HISTORY_MAX ≈ 0.89 for HISTORY_MAX=100.
    expect(sov).toBeGreaterThan(0.5);
    expect(sov).toBeLessThan(1.0);
    expect(store.totalEntries).toBe(QIGRAMV2_HISTORY_MAX);
  });

  test('sovereignty drops when integration pauses (decay-only window)', () => {
    const store = new QIGRAMv2State();
    for (let i = 0; i < QIGRAMV2_HISTORY_MAX; i++) {
      store.integrate(`tick|${i}`, B, { weight: 1.0, correct: true });
    }
    const sovStart = store.sovereignty;
    expect(sovStart).toBe(1.0);
    // Pause integration; let decay run past the threshold (0.95^90 ≈ 0.0099).
    for (let t = 0; t < 100; t++) store.decayAll();
    // Storage stays at capacity (LRU never evicted these), but the active
    // ratio drops because every entry has decayed below MIN_ACTIVE_WEIGHT.
    expect(store.sovereignty).toBeCloseTo(0, 6);
    expect(store.totalEntries).toBe(QIGRAMV2_HISTORY_MAX);
  });

  test('sovereignty drops when recordOutcome zeroes weights (wrong-outcome signal)', () => {
    const store = new QIGRAMv2State();
    for (let i = 0; i < QIGRAMV2_HISTORY_MAX; i++) {
      store.integrate(`tick|${i}`, B, { weight: 1.0, correct: true });
    }
    expect(store.sovereignty).toBe(1.0);
    // Zero half the buffer via recordOutcome(false).
    for (let i = 0; i < QIGRAMV2_HISTORY_MAX / 2; i++) {
      store.recordOutcome(`tick|${i}`, false);
    }
    // The wrong half drops below MIN_ACTIVE_WEIGHT (zero weight); the
    // sov reading reflects the loss rate, not just storage uptime.
    expect(store.sovereignty).toBeCloseTo(0.5, 6);
    expect(store.totalEntries).toBe(QIGRAMV2_HISTORY_MAX);
  });

  test('consolidate still works for explicit cleanup, but is no longer required per-tick', () => {
    // PR906 paired consolidate with decayAll every tick. With the LRU
    // cap that pairing is unnecessary (storage cannot grow unboundedly),
    // and per-tick consolidate makes sov pin at 1.0. The method itself
    // stays valid for explicit "sweep dead entries" cleanups (e.g. before
    // persistence, or in a teardown path).
    const store = new QIGRAMv2State();
    for (let i = 0; i < 50; i++) {
      store.integrate(`tick|${i}`, B, { weight: 1.0, correct: true });
    }
    for (let t = 0; t < 95; t++) store.decayAll();  // all decay-dead
    expect(store.totalEntries).toBe(50);
    expect(store.activeEntries().length).toBe(0);
    const pruned = store.consolidate();
    expect(pruned).toBe(50);
    expect(store.totalEntries).toBe(0);
  });

  test('HISTORY_MAX is exported and matches the kernel-wide convention (100)', () => {
    // Same value as loop.ts HISTORY_MAX so this isn't a new tuning knob,
    // it's a memory-shape bound consistent with phiHistory / basinHistory /
    // surpriseHistory etc.
    expect(QIGRAMV2_HISTORY_MAX).toBe(100);
    expect(MIN_ACTIVE_WEIGHT).toBe(0.01);
  });
});
