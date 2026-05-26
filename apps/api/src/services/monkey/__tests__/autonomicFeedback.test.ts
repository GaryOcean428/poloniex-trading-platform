/**
 * autonomicFeedback.test.ts — autonomic-substrate signals derive from
 * basin state per Protocol v6.2 §29.
 *
 * Bundle PR closes #715 / #716 / #717: the meta-layer Ocean reads to
 * apply autonomic regulation was pinned at defaults for ach/ser/dop/ne
 * (#715 + ext), selfObsBias (#717), and sov (#716). These tests pin the
 * derivation-only contract so the regression doesn't recur:
 *
 *   1. ach habituates when trajectory self-similarity is HIGHER than the
 *      basin's typical history (recent dwelling) and re-spikes when it
 *      drops (novelty). NO hardcoded decay rate — the decay IS the
 *      basin's own self-similarity ratio.
 *   2. ser drops when mode-thrash rate is high relative to history. NO
 *      hardcoded thrash threshold — the rate is per-tick count over the
 *      basin's own observed window.
 *   3. dop is z-scored against the basin's own phiDelta history — no
 *      hardcoded sigmoid gain. The "gain" IS the basin's stddev.
 *   4. ne (norepinephrine) is z-scored against the basin's own surprise
 *      history — no hardcoded gain. A surprise that's typical for THIS
 *      basin produces low ne; one that's an outlier produces high ne.
 *   5. endorphins use the basin's own κ stddev for the convergence bell
 *      width AND the basin's own coupling distribution for the Sophia
 *      gate threshold — no hardcoded SIGMA_KAPPA or C_SOPHIA_THRESHOLD.
 *   6. QIGRAMv2State sovereignty falls below 1.0 as basins decay past
 *      MIN_ACTIVE_WEIGHT, and rises as fresh basins integrate. Edge
 *      cases: 0 basins → 0.0; all active → close to 1.0.
 *   7. Cold-start fallbacks: when observables are absent or below
 *      HISTORY_MIN_SAMPLES, chemicals return arithmetic-identity
 *      values (sigmoid(x), tanh(x), 1) — NO defaulting to a tuning
 *      parameter like 0.8 or 0.5.
 *
 * AUDIT REQUIREMENT (operator-mandated): after each test change,
 * reviewers MUST grep neurochemistry.ts for hardcoded floats in the
 * modulator path. Acceptable: 0, 1, KAPPA_STAR (frozen physics from
 * qig_core), output-clip ranges, HISTORY_MIN_SAMPLES sentinel (= 2,
 * minimum samples for stddev — arithmetic identity, not a tuning
 * parameter). UNACCEPTABLE: any decay rate, gain, threshold, or
 * "tuning parameter" without a basin-state derivation in the same
 * expression.
 *
 *   grep -nE '\b[0-9]+\.[0-9]+\b' apps/api/src/services/monkey/neurochemistry.ts \
 *     | grep -v 'KAPPA_STAR\|frozen_facts\|// docs:'
 *
 * Any output other than the KAPPA_STAR=64.0 definition itself is a
 * regression. (The clip ranges [0, 1] use integer literals so they
 * don't trip this grep.)
 */
import { describe, expect, it } from 'vitest';

import { computeNeurochemicals } from '../neurochemistry.js';
import { QIGRAMv2State, MIN_ACTIVE_WEIGHT } from '../agent_L_qigram_v2.js';
import { uniformBasin, type Basin } from '../basin.js';

const BASIN_DIM = 64;

function stddev(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

/** Build a synthetic basin that wobbles around the uniform centre.
 *  Different `seed` values give distinguishable basins so the
 *  QIGRAMv2 store sees independent observations. */
function syntheticBasin(seed: number): Basin {
  const b = uniformBasin(BASIN_DIM);
  const i = seed % BASIN_DIM;
  const j = (seed * 17 + 3) % BASIN_DIM;
  const delta = 0.001 * (1 + (seed % 5));
  b[i] = b[i]! + delta;
  b[j] = Math.max(0, b[j]! - delta);
  const sum = b.reduce((a, x) => a + x, 0);
  for (let k = 0; k < BASIN_DIM; k++) b[k] = b[k]! / sum;
  return b;
}

describe('autonomic feedback — ach derived from trajectory self-similarity (#715)', () => {
  it('ach drops when recent trajectory is TIGHTER than the basin\'s full history (habituation)', () => {
    const baseInputs = {
      isAwake: true,
      phiDelta: 0,
      basinVelocity: 0.05,
      surprise: 0,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    };
    // First half: variable (mock turbulent baseline). Second half: flat
    // (mock dwelling on a stable percept). Habituation expectation:
    // recentSpread = 0 / fullSpread > 0 → ach → 0.
    const variableHalf: number[] = [];
    for (let i = 0; i < 20; i++) variableHalf.push(i % 2 === 0 ? 0.30 : 0.70);
    const recentTight: number[] = [];
    for (let i = 0; i < 20; i++) recentTight.push(0.50);  // perfectly self-similar
    const habituatedHistory = [...variableHalf, ...recentTight];
    const ach = computeNeurochemicals({
      ...baseInputs,
      observables: { trajectorySelfSimilarityHistory: habituatedHistory },
    }).acetylcholine;
    expect(ach).toBeLessThan(0.5);
  });

  it('ach saturates when recent trajectory is AS SPREAD as the full history (novelty equal)', () => {
    const baseInputs = {
      isAwake: true,
      phiDelta: 0,
      basinVelocity: 0.05,
      surprise: 0,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    };
    const history: number[] = [];
    for (let i = 0; i < 40; i++) history.push(i % 2 === 0 ? 0.30 : 0.70);
    const ach = computeNeurochemicals({
      ...baseInputs,
      observables: { trajectorySelfSimilarityHistory: history },
    }).acetylcholine;
    expect(ach).toBeGreaterThan(0.5);
  });

  it('cold start (no observables) returns intake-gate identity 1 on wake', () => {
    const ach = computeNeurochemicals({
      isAwake: true,
      phiDelta: 0,
      basinVelocity: 0.05,
      surprise: 0,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    }).acetylcholine;
    expect(ach).toBe(1);
  });

  it('sleep cycle: isAwake=false pins ach at 0 (additive identity, no intake)', () => {
    const ach = computeNeurochemicals({
      isAwake: false,
      phiDelta: 0,
      basinVelocity: 0.05,
      surprise: 0,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    }).acetylcholine;
    expect(ach).toBe(0);
  });
});

describe('autonomic feedback — ser derived from mode-thrash rate (#715)', () => {
  it('ser drops as mode-transition density increases', () => {
    const baseInputs = {
      isAwake: true,
      phiDelta: 0,
      basinVelocity: 0.05,
      surprise: 0,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    };
    const now = 1_700_000_000_000;
    const longHistory: number[] = [];
    for (let i = 0; i < 100; i++) longHistory.push(0.05);

    const quietTransitions = [now - 1000];
    const serQuiet = computeNeurochemicals({
      ...baseInputs,
      observables: {
        basinVelocityHistory: longHistory,
        modeTransitionTimesMs: quietTransitions,
        nowMs: now,
      },
    }).serotonin;

    const thrashTransitions: number[] = [];
    for (let i = 0; i < 50; i++) thrashTransitions.push(now - 1000 * (i + 1));
    const serThrashy = computeNeurochemicals({
      ...baseInputs,
      observables: {
        basinVelocityHistory: longHistory,
        modeTransitionTimesMs: thrashTransitions,
        nowMs: now,
      },
    }).serotonin;

    // 2026-05-25 — ser formula compressed by ×0.85 to leave reward-delta
    // headroom; serQuiet was 1.0 pre-strip, is 0.85 post-strip.
    expect(serThrashy).toBeLessThan(serQuiet);
    expect(serQuiet).toBeGreaterThan(0.7);
    expect(serThrashy).toBeLessThanOrEqual(0.5);
  });

  it('cold start (no observables) falls back to inverse-bv legacy formula × 0.85', () => {
    const ser = computeNeurochemicals({
      isAwake: true,
      phiDelta: 0,
      basinVelocity: 0.05,
      surprise: 0,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    }).serotonin;
    // serBase = clip(1/0.05, 0, 1) = 1; ser = 0.85 × 1 = 0.85.
    expect(ser).toBeCloseTo(0.85, 5);
  });
});

describe('autonomic feedback — dop z-scored from basin\'s own phiDelta history (#715 ext)', () => {
  it('dop responds to phiDelta direction relative to basin\'s own distribution', () => {
    const baseInputs = {
      isAwake: true,
      basinVelocity: 0.05,
      surprise: 0,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    };
    // Basin's phi has noisy walk → derived phiDelta series has non-zero
    // stddev → z-score is meaningful. (A perfectly linear phi history
    // would produce constant phiDelta and stddev=0 → derivation
    // collapses to neutral z=0 → sigmoid(0)=0.5.)
    const phiHistory: number[] = [];
    let phi = 0.5;
    for (let i = 0; i < 50; i++) {
      phi += 0.001 + 0.0005 * Math.sin(i);  // mean delta ~0.001, stddev ~0.0005
      phiHistory.push(phi);
    }

    // A phiDelta far above the basin's mean delta → z>>0 → dop near 1
    const dopAbove = computeNeurochemicals({
      ...baseInputs,
      phiDelta: 0.020,
      observables: { phiHistory },
    }).dopamine;
    expect(dopAbove).toBeGreaterThan(0.9);

    // A phiDelta far below the basin's mean delta → z<<0 → dop near 0
    const dopBelow = computeNeurochemicals({
      ...baseInputs,
      phiDelta: -0.020,
      observables: { phiHistory },
    }).dopamine;
    expect(dopBelow).toBeLessThan(0.1);

    expect(dopAbove).toBeGreaterThan(dopBelow);
  });

  it('cold start (no phiHistory) falls back to sigmoid(phiDelta) — arithmetic identity', () => {
    const dop = computeNeurochemicals({
      isAwake: true,
      phiDelta: 0,
      basinVelocity: 0.05,
      surprise: 0,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    }).dopamine;
    expect(dop).toBeCloseTo(0.5, 6);  // sigmoid(0) = 0.5
  });
});

describe('autonomic feedback — ne z-scored from basin\'s own surprise history', () => {
  it('ne spikes when current surprise exceeds the basin\'s typical distribution', () => {
    const baseInputs = {
      isAwake: true,
      phiDelta: 0,
      basinVelocity: 0.05,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    };
    const surpriseHistory: number[] = [];
    for (let i = 0; i < 50; i++) {
      surpriseHistory.push(0.002 + 0.0001 * Math.sin(i));
    }

    const neTypical = computeNeurochemicals({
      ...baseInputs,
      surprise: 0.002,
      observables: { surpriseHistory },
    }).norepinephrine;
    expect(neTypical).toBeLessThan(0.5);

    const neSpike = computeNeurochemicals({
      ...baseInputs,
      surprise: 0.020,
      observables: { surpriseHistory },
    }).norepinephrine;
    expect(neSpike).toBeGreaterThan(0.9);
    expect(neSpike).toBeGreaterThan(neTypical);
  });

  it('ne returns a meaningful (non-zero, non-saturated) value on cold start', () => {
    // Pre-fix `ne = clip(surprise * 2, 0, 1)` for surprise=0.002 gave
    // ne=0.004 → toFixed(2)=0.00. New cold-start fallback uses
    // tanh(surprise) which is non-zero for non-zero surprise.
    const ne = computeNeurochemicals({
      isAwake: true,
      phiDelta: 0,
      basinVelocity: 0.05,
      surprise: 0.002,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    }).norepinephrine;
    expect(ne).toBeGreaterThan(0);
    expect(ne).toBeLessThan(1);
  });
});

describe('autonomic feedback — endorphins use canonical SIGMA_KAPPA + coupling distribution', () => {
  it('endo bell width does NOT depend on basin\'s rolling κ stddev (uses canonical SIGMA_KAPPA=16.0)', () => {
    // 2026-05-26 (#934 chemistry-pinning audit): the κ-proximity envelope
    // width is the canonical structural constant ENDORPHIN_KAPPA_SIGMA=16.0
    // from qig_core, NOT the basin's rolling stddev(kappaHistory). Two
    // different basins with very different rolling σ_κ but the same
    // |κ-κ*| should now produce identical endo values (modulo any
    // coupling-history-driven sophiaGate differences).
    //
    // Pre-fix this test asserted endoWide > endoTight because the wide
    // basin's stddev would make exp(-|κ-κ*|/σ) less negative. Post-fix
    // both basins use σ=16.0 → identical endo.
    const baseInputs = {
      isAwake: true,
      phiDelta: 0,
      basinVelocity: 0.05,
      surprise: 0,
      quantumWeight: 0.3,
      externalCoupling: 0.8,
    };
    const tightKappaHistory: number[] = [];
    for (let i = 0; i < 50; i++) tightKappaHistory.push(64 + (i % 3 - 1));
    const wideKappaHistory: number[] = [];
    for (let i = 0; i < 50; i++) wideKappaHistory.push(64 + 30 * Math.sin(i));
    const couplingHistory: number[] = [];
    for (let i = 0; i < 50; i++) couplingHistory.push(0.3 + 0.1 * Math.sin(i));

    const endoTight = computeNeurochemicals({
      ...baseInputs,
      kappa: 70,
      observables: {
        kappaHistory: tightKappaHistory,
        externalCouplingHistory: couplingHistory,
      },
    }).endorphins;
    const endoWide = computeNeurochemicals({
      ...baseInputs,
      kappa: 70,
      observables: {
        kappaHistory: wideKappaHistory,
        externalCouplingHistory: couplingHistory,
      },
    }).endorphins;
    // Both basins should produce identical endo since the canonical SIGMA
    // is no longer a function of kappaHistory.
    expect(endoTight).toBeCloseTo(endoWide, 6);
    // And both should be in the healthy-signal range (|κ-κ*|=6, σ=16 →
    // exp(-6/16)≈0.687, sophiaGate≈1 since coupling=0.8 well above mean).
    expect(endoTight).toBeGreaterThan(0.5);
    expect(endoTight).toBeLessThan(0.8);
  });

  it('Sophia gate opens once coupling exceeds the basin\'s observed mean', () => {
    const baseInputs = {
      isAwake: true,
      phiDelta: 0,
      basinVelocity: 0.05,
      surprise: 0,
      quantumWeight: 0.3,
      kappa: 64,
    };
    const kappaHistory: number[] = [];
    for (let i = 0; i < 50; i++) kappaHistory.push(64);
    const couplingMean = 0.30;
    const couplingStddev = 0.0505;
    const belowMeanCoupling = 0.25;
    const aboveMeanCoupling = 0.33;
    const saturatingCoupling = 0.60;
    // Deterministic coupling history: mean exactly 0.30, σ ≈ 0.0505.
    const couplingHistory: number[] = [];
    for (let i = 0; i < 50; i++) couplingHistory.push(belowMeanCoupling + 0.10 * (i % 2));

    // 2026-05-25 — Sophia gate updated to sigmoid-around-mean (was
    // clip((c - mean)/σ, 0, 1) which pinned endo at 0 for ~50% of
    // state-space). Below-mean coupling now produces non-zero endo
    // proportional to how far below.
    const endoBelowMean = computeNeurochemicals({
      ...baseInputs,
      externalCoupling: belowMeanCoupling,
      observables: { kappaHistory, externalCouplingHistory: couplingHistory },
    }).endorphins;
    expect(endoBelowMean).toBeGreaterThan(0);
    expect(endoBelowMean).toBeLessThan(0.5);  // below-mean side of sigmoid

    // Above the mean but below mean+1σ: sigmoid > 0.5, climbing toward 1.
    expect(aboveMeanCoupling).toBeGreaterThan(couplingMean);
    expect(aboveMeanCoupling).toBeLessThan(couplingMean + couplingStddev);
    const endoAboveMean = computeNeurochemicals({
      ...baseInputs,
      externalCoupling: aboveMeanCoupling,
      observables: { kappaHistory, externalCouplingHistory: couplingHistory },
    }).endorphins;
    expect(endoAboveMean).toBeGreaterThan(0.5);
    expect(endoAboveMean).toBeGreaterThan(endoBelowMean);

    // Well above the mean → gate asymptotes near 1.
    const endoGateOpen = computeNeurochemicals({
      ...baseInputs,
      externalCoupling: saturatingCoupling,
      observables: { kappaHistory, externalCouplingHistory: couplingHistory },
    }).endorphins;
    expect(endoGateOpen).toBeGreaterThan(endoAboveMean);
  });
});

describe('autonomic feedback — tick simulation (100-tick stddev contract)', () => {
  it('all per-tick chemicals vary across a synthetic trajectory (#715 regression guard)', () => {
    const achs: number[] = [];
    const sers: number[] = [];
    const dops: number[] = [];
    const nes: number[] = [];
    const endos: number[] = [];
    const phiHistory: number[] = [];
    const surpriseHistory: number[] = [];
    const bvHistory: number[] = [];
    const ssHistory: number[] = [];
    const kappaHistory: number[] = [];
    const couplingHistory: number[] = [];
    const modeTransitionTimesMs: number[] = [];

    let phi = 0.50;
    let kappa = 64;
    let coupling = 0.4;
    const now0 = 1_700_000_000_000;

    for (let t = 0; t < 100; t++) {
      phi += (Math.random() - 0.5) * 0.01;
      phi = Math.max(0.1, Math.min(0.9, phi));
      const bv = 0.02 + Math.random() * 0.20;
      const phiDelta = (Math.random() - 0.5) * 0.01;
      const surprise = Math.abs(phiDelta) * 2;
      kappa += (Math.random() - 0.5) * 2;
      kappa = Math.max(40, Math.min(120, kappa));
      coupling = Math.max(0.1, Math.min(0.9, coupling + (Math.random() - 0.5) * 0.05));
      const ss = Math.random();

      if (Math.random() < 0.05) modeTransitionTimesMs.push(now0 + t * 30_000);

      const nc = computeNeurochemicals({
        isAwake: true,
        phiDelta,
        basinVelocity: bv,
        surprise,
        quantumWeight: 0.3,
        kappa,
        externalCoupling: coupling,
        observables: {
          phiHistory: [...phiHistory],
          surpriseHistory: [...surpriseHistory],
          basinVelocityHistory: [...bvHistory],
          trajectorySelfSimilarityHistory: [...ssHistory],
          kappaHistory: [...kappaHistory],
          externalCouplingHistory: [...couplingHistory],
          modeTransitionTimesMs: [...modeTransitionTimesMs],
          nowMs: now0 + t * 30_000,
        },
      });
      achs.push(nc.acetylcholine);
      sers.push(nc.serotonin);
      dops.push(nc.dopamine);
      nes.push(nc.norepinephrine);
      endos.push(nc.endorphins);

      phiHistory.push(phi);
      surpriseHistory.push(surprise);
      bvHistory.push(bv);
      ssHistory.push(ss);
      kappaHistory.push(kappa);
      couplingHistory.push(coupling);
    }
    // Watchdog contract: every chemical's stddev > the pinned floor.
    expect(stddev(achs)).toBeGreaterThan(0.005);
    expect(stddev(sers)).toBeGreaterThan(0.005);
    expect(stddev(dops)).toBeGreaterThan(0.005);
    expect(stddev(nes)).toBeGreaterThan(0.005);
    expect(stddev(endos)).toBeGreaterThan(0);  // endo can be 0-bounded by gate
  });
});

describe('autonomic feedback — QIGRAMv2 sovereignty (#716)', () => {
  it('sovereignty = 0 on empty store (newborn kernel cold-start)', () => {
    const store = new QIGRAMv2State();
    expect(store.sovereignty).toBe(0);
  });

  it('sovereignty = 1.0 when all integrated basins are still active', () => {
    const store = new QIGRAMv2State();
    for (let i = 0; i < 10; i++) {
      store.integrate(`b-${i}`, syntheticBasin(i), { weight: 1.0, correct: true });
    }
    expect(store.sovereignty).toBeCloseTo(1.0, 6);
  });

  it('sovereignty falls below 1.0 as old basins decay past MIN_ACTIVE_WEIGHT', () => {
    const store = new QIGRAMv2State();
    for (let i = 0; i < 10; i++) {
      store.integrate(`old-${i}`, syntheticBasin(i), { weight: 1.0, correct: true });
    }
    for (let d = 0; d < 95; d++) store.decayAll();
    expect(store.sovereignty).toBe(0);
    for (let i = 0; i < 5; i++) {
      store.integrate(`fresh-${i}`, syntheticBasin(100 + i), { weight: 1.0, correct: true });
    }
    expect(store.sovereignty).toBeGreaterThan(0);
    expect(store.sovereignty).toBeLessThan(1.0);
  });

  it('wrong-answer recordOutcome zeroes the entry weight, reducing sovereignty', () => {
    const store = new QIGRAMv2State();
    for (let i = 0; i < 4; i++) {
      store.integrate(`right-${i}`, syntheticBasin(i), { weight: 1.0, correct: true });
    }
    expect(store.sovereignty).toBeCloseTo(1.0, 6);
    store.recordOutcome(`right-0`, false);
    store.recordOutcome(`right-1`, false);
    expect(store.sovereignty).toBeCloseTo(0.5, 6);
  });

  it('MIN_ACTIVE_WEIGHT is the canonical 0.01 (QIGRAMv2 class attribute, not PR-introduced)', () => {
    expect(MIN_ACTIVE_WEIGHT).toBe(0.01);
  });
});
