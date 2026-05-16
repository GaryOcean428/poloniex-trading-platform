/**
 * agent_L_classifier_v2.test.ts — pure tests for the QIGRAMv2 port.
 *
 * Covers the v2 spec lifted from `qig-applied/src/qig_applied/inference/qigram.py`
 * (lines 228-348, class QIGRAMv2):
 *   - weighted basins (weight=0 excluded from recall)
 *   - decay (DECAY_FACTOR=0.95 per step)
 *   - wrong-answer handling (correct=false zeroes weight)
 *   - recall_by_category (highest-weighted active match)
 *   - κ tacking (oscillates [32,128] around 64 with 0.1 drift)
 *   - default-off invariant (env flag unset → behavior identical)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  agentLDecide,
  DECAY_FACTOR,
  DEFAULT_AGENT_L_CONFIG,
  KAPPA_FIXED_POINT,
  KAPPA_MAX,
  KAPPA_MIN,
  MIN_ACTIVE_WEIGHT,
  QIGRAMv2State,
  isQigramV2Enabled,
  makeBasinEntryV2,
  type Basin,
} from '../agent_L_classifier.js';
import { BASIN_DIM } from '../basin.js';

// ─── Test fixtures ───────────────────────────────────────────────────

function uniform(): Basin {
  const b = new Float64Array(BASIN_DIM);
  b.fill(1 / BASIN_DIM);
  return b as unknown as Basin;
}

/** Concentrate probability mass in a half-band of the simplex.
 *  Reused from agent_L_classifier.test.ts pattern. */
function biased(half: 'low' | 'high', strength = 0.8): Basin {
  const b = new Float64Array(BASIN_DIM);
  const halfDim = BASIN_DIM / 2;
  const inHalfMass = strength / halfDim;
  const outHalfMass = (1 - strength) / halfDim;
  for (let i = 0; i < BASIN_DIM; i++) {
    const isLowHalf = i < halfDim;
    const wantedLow = half === 'low';
    b[i] = isLowHalf === wantedLow ? inHalfMass : outHalfMass;
  }
  return b as unknown as Basin;
}

/** Bias the momentum band so basinDirection() returns +1 (long). */
function longBiased(strength = 0.7): Basin {
  const b = new Float64Array(BASIN_DIM);
  const bandMass = strength;
  const offMass = 1 - strength;
  for (let i = 0; i < BASIN_DIM; i++) {
    if (i >= 7 && i <= 14) b[i] = bandMass / 8;
    else b[i] = offMass / 56;
  }
  return b as unknown as Basin;
}

/** Suppress the momentum band so basinDirection() returns -1 (short). */
function shortBiased(strength = 0.7): Basin {
  const b = new Float64Array(BASIN_DIM);
  const bandMass = (1 - strength) * 0.5;
  const offMass = strength + 0.5 * (1 - strength);
  for (let i = 0; i < BASIN_DIM; i++) {
    if (i >= 7 && i <= 14) b[i] = bandMass / 8;
    else b[i] = offMass / 56;
  }
  return b as unknown as Basin;
}

/** Build a synthetic alternating long/short history with enough
 *  samples for the FR-KNN classifier to warm up (≥480 + horizon). */
function syntheticHistory(n: number): Basin[] {
  const h: Basin[] = [];
  for (let i = 0; i < n; i++) {
    h.push(i % 2 === 0 ? longBiased(0.6) : shortBiased(0.6));
  }
  return h;
}

// ─── Env-flag scaffolding ─────────────────────────────────────────────

const ENV_FLAG = 'L_QIGRAM_V2_ENABLED';

let prevEnv: string | undefined;
beforeEach(() => {
  prevEnv = process.env[ENV_FLAG];
  delete process.env[ENV_FLAG];
});
afterEach(() => {
  if (prevEnv === undefined) delete process.env[ENV_FLAG];
  else process.env[ENV_FLAG] = prevEnv;
});

// ─── Constants ───────────────────────────────────────────────────────

describe('QIGRAMv2 constants — canonical parity', () => {
  it('DECAY_FACTOR matches canonical 0.95', () => {
    expect(DECAY_FACTOR).toBe(0.95);
  });
  it('MIN_ACTIVE_WEIGHT matches canonical 0.01', () => {
    expect(MIN_ACTIVE_WEIGHT).toBe(0.01);
  });
  it('KAPPA_FIXED_POINT matches canonical 64.0', () => {
    expect(KAPPA_FIXED_POINT).toBe(64.0);
  });
  it('κ bounds match canonical [32, 128]', () => {
    expect(KAPPA_MIN).toBe(32.0);
    expect(KAPPA_MAX).toBe(128.0);
  });
});

// ─── Weighted basins ─────────────────────────────────────────────────

describe('weighted basins', () => {
  it('weight=0 basin is excluded from recall', () => {
    const store = new QIGRAMv2State();
    store.integrate('alive', biased('high'), { weight: 1.0, correct: true });
    store.integrate('dead', biased('low'), { weight: 1.0, correct: false });

    // Query close to the dead basin; recall must still return the
    // alive one (or null), never the dead one.
    const result = store.recall(biased('low'));
    expect(result).not.toBeNull();
    expect(result!.source).toBe('alive');
  });

  it('all-dead store returns null on recall', () => {
    const store = new QIGRAMv2State();
    store.integrate('a', biased('high'), { weight: 1.0, correct: false });
    store.integrate('b', biased('low'), { weight: 0.001, correct: true }); // below MIN_ACTIVE_WEIGHT
    expect(store.recall(uniform())).toBeNull();
  });

  it('activeEntries reflects MIN_ACTIVE_WEIGHT threshold', () => {
    const store = new QIGRAMv2State();
    store.integrate('a', biased('high'), { weight: 1.0, correct: true });
    store.integrate('b', biased('low'), { weight: 0.005, correct: true });
    store.integrate('c', biased('high'), { weight: 0.5, correct: true });
    const active = store.activeEntries();
    expect(active.map((e) => e.id).sort()).toEqual(['a', 'c']);
  });
});

// ─── Decay ───────────────────────────────────────────────────────────

describe('decay', () => {
  it('10 decay steps drop weight from 1.0 to ~0.5987 (0.95^10)', () => {
    const store = new QIGRAMv2State();
    store.integrate('x', biased('high'), { weight: 1.0, correct: true });
    for (let i = 0; i < 10; i++) store.decayAll();
    const active = store.activeEntries();
    expect(active).toHaveLength(1);
    const w = active[0]!.weight;
    // 0.95^10 = 0.5987369392
    expect(w).toBeCloseTo(0.95 ** 10, 6);
    expect(w).toBeGreaterThan(0.59);
    expect(w).toBeLessThan(0.60);
  });

  it('decay below MIN_ACTIVE_WEIGHT removes basin from recall', () => {
    const store = new QIGRAMv2State();
    store.integrate('x', biased('high'), { weight: 1.0, correct: true });
    // 0.95^k < 0.01 ⇒ k > log(0.01)/log(0.95) ≈ 89.78
    for (let i = 0; i < 100; i++) store.decayAll();
    expect(store.recall(biased('high'))).toBeNull();
  });
});

// ─── Wrong-answer attribution ────────────────────────────────────────

describe('wrong-answer attribution', () => {
  it('integrating with correct=false zeros the weight', () => {
    const store = new QIGRAMv2State();
    store.integrate('x', biased('high'), { weight: 0.9, correct: false });
    expect(store.activeEntries()).toHaveLength(0);
  });

  it('recordOutcome(false) zeros the weight of an existing entry', () => {
    const store = new QIGRAMv2State();
    store.store('x', biased('high'));
    expect(store.activeEntries()).toHaveLength(1);
    const ok = store.recordOutcome('x', false);
    expect(ok).toBe(true);
    expect(store.activeEntries()).toHaveLength(0);
  });

  it('recordOutcome on unknown id returns false', () => {
    const store = new QIGRAMv2State();
    expect(store.recordOutcome('missing', true)).toBe(false);
  });

  it('correct overwrite preserves max weight (no downgrade)', () => {
    const store = new QIGRAMv2State();
    store.integrate('x', biased('high'), { weight: 0.8, correct: true });
    store.integrate('x', biased('high'), { weight: 0.5, correct: true });
    const entry = store.activeEntries().find((e) => e.id === 'x')!;
    expect(entry.weight).toBeCloseTo(0.8, 6);
  });
});

// ─── recall_by_category ──────────────────────────────────────────────

describe('recallByCategory — wormhole shortcut', () => {
  it('returns highest-weighted active basin matching category', () => {
    const store = new QIGRAMv2State();
    store.integrate('trend-a', biased('high'),
      { weight: 0.4, correct: true, category: 'trend' });
    store.integrate('trend-b', biased('high'),
      { weight: 0.8, correct: true, category: 'trend' });
    store.integrate('chop-a', biased('low'),
      { weight: 0.9, correct: true, category: 'chop' });

    const r = store.recallByCategory('trend');
    expect(r).not.toBeNull();
    expect(r!.source).toBe('trend-b');
    expect(r!.weight).toBeCloseTo(0.8, 6);
    expect(r!.category).toBe('trend');
  });

  it('returns null when no active entry matches category', () => {
    const store = new QIGRAMv2State();
    store.integrate('a', biased('high'),
      { weight: 0.5, correct: true, category: 'trend' });
    expect(store.recallByCategory('reversal')).toBeNull();
  });

  it('ignores dead-weight matches', () => {
    const store = new QIGRAMv2State();
    store.integrate('alive', biased('high'),
      { weight: 0.5, correct: true, category: 'trend' });
    store.integrate('dead', biased('high'),
      { weight: 1.0, correct: false, category: 'trend' }); // wrong→dead
    const r = store.recallByCategory('trend');
    expect(r).not.toBeNull();
    expect(r!.source).toBe('alive');
  });
});

// ─── κ tacking ───────────────────────────────────────────────────────

describe('κ tacking', () => {
  it('starts at the fixed point (64.0)', () => {
    const store = new QIGRAMv2State();
    expect(store.kappa).toBe(KAPPA_FIXED_POINT);
  });

  it('dominance>0.7 + correct → κ increases (capped at 128)', () => {
    const store = new QIGRAMv2State();
    // Bump κ up far above 64 first, so the +2 step is visible against
    // the drift toward 64. Start by repeating tack many times.
    for (let i = 0; i < 200; i++) store.tack(0.9, true);
    expect(store.kappa).toBeGreaterThan(KAPPA_FIXED_POINT);
    expect(store.kappa).toBeLessThanOrEqual(KAPPA_MAX);
  });

  it('wrong outcome → κ decreases (floor 32)', () => {
    const store = new QIGRAMv2State();
    for (let i = 0; i < 200; i++) store.tack(0.5, false);
    expect(store.kappa).toBeLessThan(KAPPA_FIXED_POINT);
    expect(store.kappa).toBeGreaterThanOrEqual(KAPPA_MIN);
  });

  it('always drifts toward κ*=64', () => {
    const store = new QIGRAMv2State();
    // Start at κ=64. Apply a "correct + high confidence" tack — the
    // raw update would be +2 then drift 0.1 toward 64. Net result
    // should be (64 + 2) + (64 - 66)*0.1 = 66 - 0.2 = 65.8.
    store.tack(0.9, true);
    expect(store.kappa).toBeCloseTo(65.8, 6);
  });

  it('low-confidence correct outcome does NOT bump κ up', () => {
    const store = new QIGRAMv2State();
    // confidence below 0.7 threshold + correct → only drift applies.
    // Starting κ=64, drift = (64 - 64) * 0.1 = 0, so κ stays at 64.
    store.tack(0.5, true);
    expect(store.kappa).toBeCloseTo(64.0, 6);
  });

  it('κ converges to fixed point under neutral repeated tacks', () => {
    const store = new QIGRAMv2State();
    // Push κ to an extreme.
    for (let i = 0; i < 20; i++) store.tack(0.9, true);
    // Now apply low-confidence-correct tacks (only drift applies).
    for (let i = 0; i < 200; i++) store.tack(0.5, true);
    expect(store.kappa).toBeCloseTo(KAPPA_FIXED_POINT, 4);
  });
});

// ─── Sovereignty ─────────────────────────────────────────────────────

describe('sovereignty', () => {
  it('N_active / N_total over stored entries when totalProblems is null', () => {
    const store = new QIGRAMv2State();
    store.integrate('a', biased('high'), { weight: 1.0, correct: true });
    store.integrate('b', biased('low'), { weight: 1.0, correct: false }); // dead
    store.integrate('c', biased('high'), { weight: 0.5, correct: true });
    expect(store.sovereignty).toBeCloseTo(2 / 3, 6);
  });

  it('uses supplied totalProblems as denominator', () => {
    const store = new QIGRAMv2State(10);
    store.integrate('a', biased('high'), { weight: 1.0, correct: true });
    store.integrate('b', biased('high'), { weight: 1.0, correct: true });
    expect(store.sovereignty).toBeCloseTo(2 / 10, 6);
  });
});

// ─── Hydration from legacy persisted rows ────────────────────────────

describe('loadFromLegacy', () => {
  it('defaults missing weight to 1.0 and correct to null', () => {
    const store = new QIGRAMv2State();
    store.loadFromLegacy([
      { id: 'old', basin: biased('high') },
    ]);
    const active = store.activeEntries();
    expect(active).toHaveLength(1);
    expect(active[0]!.weight).toBe(1.0);
    expect(active[0]!.correct).toBeNull();
    expect(active[0]!.category).toBe('');
  });

  it('honors supplied weight/correct/category when present', () => {
    const store = new QIGRAMv2State();
    store.loadFromLegacy([
      { id: 'x', basin: biased('high'), weight: 0.3, correct: true, category: 'trend' },
    ]);
    const active = store.activeEntries();
    expect(active).toHaveLength(1);
    expect(active[0]!.weight).toBeCloseTo(0.3, 6);
    expect(active[0]!.correct).toBe(true);
    expect(active[0]!.category).toBe('trend');
  });
});

// ─── makeBasinEntryV2 ────────────────────────────────────────────────

describe('makeBasinEntryV2', () => {
  it('fills v2 defaults from legacy inputs', () => {
    const e = makeBasinEntryV2('id', biased('high'));
    expect(e.weight).toBe(1.0);
    expect(e.correct).toBeNull();
    expect(e.category).toBe('');
    expect(e.trajectory).toEqual({});
  });
});

// ─── Default-off invariant ───────────────────────────────────────────

describe('default-off invariant', () => {
  it('isQigramV2Enabled is false with env var unset', () => {
    expect(isQigramV2Enabled()).toBe(false);
  });

  it('isQigramV2Enabled is false unless env var is exactly "true"', () => {
    process.env[ENV_FLAG] = '1';
    expect(isQigramV2Enabled()).toBe(false);
    process.env[ENV_FLAG] = 'yes';
    expect(isQigramV2Enabled()).toBe(false);
    process.env[ENV_FLAG] = 'TRUE';
    expect(isQigramV2Enabled()).toBe(false);
    process.env[ENV_FLAG] = 'true';
    expect(isQigramV2Enabled()).toBe(true);
  });

  it('agentLDecide produces no v2 field when flag is unset', () => {
    const history = syntheticHistory(800);
    const store = new QIGRAMv2State();
    store.integrate('x', biased('high'), { weight: 1.0, correct: true });
    const dec = agentLDecide(history, {
      ...DEFAULT_AGENT_L_CONFIG,
      v2Store: store,
      v2Category: 'trend',
    });
    expect(dec.v2).toBeUndefined();
  });

  it('agentLDecide produces no v2 field when flag is set but no store supplied', () => {
    process.env[ENV_FLAG] = 'true';
    const history = syntheticHistory(800);
    const dec = agentLDecide(history, DEFAULT_AGENT_L_CONFIG);
    expect(dec.v2).toBeUndefined();
  });

  it('agentLDecide returns byte-identical decision (sans v2) regardless of flag', () => {
    const history = syntheticHistory(800);

    // Snapshot with flag OFF, no store.
    delete process.env[ENV_FLAG];
    const off = agentLDecide(history, DEFAULT_AGENT_L_CONFIG);

    // Snapshot with flag ON, no store — v2 path skipped (no store).
    process.env[ENV_FLAG] = 'true';
    const onNoStore = agentLDecide(history, DEFAULT_AGENT_L_CONFIG);

    // Snapshot with flag ON, store supplied — v2 telemetry attached
    // but underlying FR-KNN math must be unchanged.
    const store = new QIGRAMv2State();
    store.integrate('x', biased('high'), { weight: 1.0, correct: true });
    const onWithStore = agentLDecide(history, {
      ...DEFAULT_AGENT_L_CONFIG,
      v2Store: store,
    });

    // Core fields must match across all three.
    expect(onNoStore.action).toBe(off.action);
    expect(onNoStore.signedScore).toBe(off.signedScore);
    expect(onNoStore.conviction).toBe(off.conviction);
    expect(onNoStore.neighbors.length).toBe(off.neighbors.length);
    expect(onNoStore.reason).toBe(off.reason);

    expect(onWithStore.action).toBe(off.action);
    expect(onWithStore.signedScore).toBe(off.signedScore);
    expect(onWithStore.conviction).toBe(off.conviction);
    expect(onWithStore.neighbors.length).toBe(off.neighbors.length);
    expect(onWithStore.reason).toBe(off.reason);

    // v2 telemetry presence rules.
    expect(off.v2).toBeUndefined();
    expect(onNoStore.v2).toBeUndefined();
    expect(onWithStore.v2).toBeDefined();
    expect(onWithStore.v2!.kappa).toBe(KAPPA_FIXED_POINT);
    expect(onWithStore.v2!.sovereignty).toBeCloseTo(1.0, 6);
  });
});

// ─── v2 telemetry through agentLDecide ───────────────────────────────

describe('agentLDecide v2 telemetry', () => {
  beforeEach(() => { process.env[ENV_FLAG] = 'true'; });

  it('attaches recall result when store has active entries', () => {
    const history = syntheticHistory(800);
    const store = new QIGRAMv2State();
    store.integrate('analog', longBiased(0.6), { weight: 0.8, correct: true });
    const dec = agentLDecide(history, {
      ...DEFAULT_AGENT_L_CONFIG,
      v2Store: store,
    });
    expect(dec.v2).toBeDefined();
    expect(dec.v2!.recall).not.toBeNull();
    expect(dec.v2!.recall!.source).toBe('analog');
  });

  it('attaches null recall when store is all-dead', () => {
    const history = syntheticHistory(800);
    const store = new QIGRAMv2State();
    store.integrate('dead', longBiased(0.6), { weight: 1.0, correct: false });
    const dec = agentLDecide(history, {
      ...DEFAULT_AGENT_L_CONFIG,
      v2Store: store,
    });
    expect(dec.v2).toBeDefined();
    expect(dec.v2!.recall).toBeNull();
  });

  it('attaches categoryRecall when v2Category set', () => {
    const history = syntheticHistory(800);
    const store = new QIGRAMv2State();
    store.integrate('best', biased('high'),
      { weight: 0.9, correct: true, category: 'bull' });
    store.integrate('other', biased('high'),
      { weight: 0.5, correct: true, category: 'bear' });
    const dec = agentLDecide(history, {
      ...DEFAULT_AGENT_L_CONFIG,
      v2Store: store,
      v2Category: 'bull',
    });
    expect(dec.v2).toBeDefined();
    expect(dec.v2!.categoryRecall).not.toBeNull();
    expect(dec.v2!.categoryRecall!.source).toBe('best');
  });

  it('v2 telemetry present on all return paths (empty history)', () => {
    const store = new QIGRAMv2State();
    store.integrate('x', biased('high'), { weight: 1.0, correct: true });
    const dec = agentLDecide([], { ...DEFAULT_AGENT_L_CONFIG, v2Store: store });
    expect(dec.action).toBe('hold');
    expect(dec.v2).toBeDefined();
    // No current basin to query; recall should be null.
    expect(dec.v2!.recall).toBeNull();
  });

  it('v2 telemetry present on insufficient-candidates path', () => {
    // Very short history → cannot build enough KNN candidates.
    const history = syntheticHistory(485); // just above minTupleStart, below candidate floor
    const store = new QIGRAMv2State();
    store.integrate('x', longBiased(0.6), { weight: 1.0, correct: true });
    const dec = agentLDecide(history, { ...DEFAULT_AGENT_L_CONFIG, v2Store: store });
    expect(dec.action).toBe('hold');
    expect(dec.v2).toBeDefined();
  });
});
