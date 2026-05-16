/**
 * autonomicFeedback.test.ts — autonomic-substrate signals fire every tick.
 *
 * Bundle PR closes #715 / #716 / #717: the meta-layer Ocean reads to
 * apply autonomic regulation was pinned at defaults for ach/ser/dop
 * (#715, extended), selfObsBias (#717), and sov (#716). These tests
 * pin the new per-tick update contract so the regression doesn't recur:
 *
 *   1. ach habituates from ACH_WAKE_CEILING toward ACH_HABITUATED_FLOOR
 *      as ticksSinceNovelty grows, and re-spikes on novelty.
 *   2. ser smoothly tracks basin velocity (no longer ceiling-pinned for
 *      typical bv < 1.0 on Δ⁶³).
 *   3. dop responds to phiDelta + basinVelocity (no longer pinned at
 *      the sigmoid mid-value 0.50 on hold ticks).
 *   4. The combined output has stddev > 0 across a 100-tick synthetic
 *      trajectory — the original-bug invariant the watchdog uses.
 *   5. QIGRAMv2State sovereignty falls below 1.0 as basins decay past
 *      MIN_ACTIVE_WEIGHT, and rises as fresh basins integrate. Edge
 *      cases: 0 basins → 0.0; all active → close to 1.0.
 *   6. Default-preservation: with no ticksSinceNovelty supplied, ach
 *      degrades to the legacy `isAwake ? 0.80 : 0.20` constant.
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
  // Perturb two coords; renormalize. Stays on the Δ⁶³ simplex.
  const i = seed % BASIN_DIM;
  const j = (seed * 17 + 3) % BASIN_DIM;
  const delta = 0.001 * (1 + (seed % 5));
  b[i] = b[i]! + delta;
  b[j] = Math.max(0, b[j]! - delta);
  const sum = b.reduce((a, x) => a + x, 0);
  for (let k = 0; k < BASIN_DIM; k++) b[k] = b[k]! / sum;
  return b;
}

describe('autonomic feedback — ach habituation (#715)', () => {
  it('ach decays from ACH_WAKE_CEILING toward ACH_HABITUATED_FLOOR as ticksSinceNovelty grows', () => {
    const baseInputs = {
      isAwake: true,
      phiDelta: 0.001,
      basinVelocity: 0.05,
      surprise: 0.002,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    };
    const ach0 = computeNeurochemicals({ ...baseInputs, ticksSinceNovelty: 0 }).acetylcholine;
    const ach30 = computeNeurochemicals({ ...baseInputs, ticksSinceNovelty: 30 }).acetylcholine;
    const ach60 = computeNeurochemicals({ ...baseInputs, ticksSinceNovelty: 60 }).acetylcholine;
    const ach300 = computeNeurochemicals({ ...baseInputs, ticksSinceNovelty: 300 }).acetylcholine;
    // At ticksSinceNovelty=0 → ceiling.
    expect(ach0).toBeCloseTo(0.80, 2);
    // Decay is monotone.
    expect(ach30).toBeLessThan(ach0);
    expect(ach60).toBeLessThan(ach30);
    expect(ach300).toBeLessThan(ach60);
    // Floor at ACH_HABITUATED_FLOOR = 0.20 (approached, never crossed).
    expect(ach300).toBeGreaterThanOrEqual(0.20);
    expect(ach300).toBeLessThan(0.30);  // 300 ticks is ~5τ → very close to floor
  });

  it('default-preservation: omitting ticksSinceNovelty restores legacy ach = 0.80 constant on wake', () => {
    const inputs = {
      isAwake: true,
      phiDelta: 0.001,
      basinVelocity: 0.05,
      surprise: 0.002,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    };
    const nc = computeNeurochemicals(inputs);
    expect(nc.acetylcholine).toBeCloseTo(0.80, 6);
  });

  it('sleep cycle: isAwake=false pins ach at 0.20 regardless of novelty', () => {
    const nc = computeNeurochemicals({
      isAwake: false,
      phiDelta: 0.001,
      basinVelocity: 0.05,
      surprise: 0.002,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
      ticksSinceNovelty: 100,
    });
    expect(nc.acetylcholine).toBeCloseTo(0.20, 6);
  });
});

describe('autonomic feedback — ser velocity-mapped (#715)', () => {
  it('ser smoothly tracks basin velocity (no ceiling pin for bv < 1)', () => {
    const baseInputs = {
      isAwake: true,
      phiDelta: 0,
      surprise: 0,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    };
    const ser0 = computeNeurochemicals({ ...baseInputs, basinVelocity: 0 }).serotonin;
    const ser05 = computeNeurochemicals({ ...baseInputs, basinVelocity: 0.05 }).serotonin;
    const ser10 = computeNeurochemicals({ ...baseInputs, basinVelocity: 0.10 }).serotonin;
    const ser30 = computeNeurochemicals({ ...baseInputs, basinVelocity: 0.30 }).serotonin;
    // bv=0 → exp(0)=1.0 (calm ceiling).
    expect(ser0).toBeCloseTo(1.0, 6);
    // Monotone decreasing across the bv working range.
    expect(ser05).toBeLessThan(ser0);
    expect(ser10).toBeLessThan(ser05);
    expect(ser30).toBeLessThan(ser10);
    // Working values are NOT all 1.0 — the regression pinning is gone.
    expect(ser05).toBeLessThan(1.0);
    expect(ser05).toBeGreaterThan(0);
  });
});

describe('autonomic feedback — dop responsive to ΔΦ (#715 extension)', () => {
  it('dop is NOT pinned at 0.50 across the typical hold-tick phiDelta range', () => {
    const baseInputs = {
      isAwake: true,
      basinVelocity: 0.05,
      surprise: 0.02,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    };
    const vals: number[] = [];
    // Sweep the typical hold-tick phiDelta range, [-0.01, +0.01].
    for (let i = -10; i <= 10; i++) {
      const phiDelta = i / 1000;  // -0.01 to +0.01
      vals.push(computeNeurochemicals({ ...baseInputs, phiDelta }).dopamine);
    }
    // Stddev across the sweep must exceed the watchdog threshold
    // (#715 extension: > 0.005). The old gain of 10 yielded stddev
    // ~ 0.025 across [-0.01, 0.01]; with gain 50 we get >> that.
    expect(stddev(vals)).toBeGreaterThan(0.005);
    // Monotone in phiDelta (negative ΔΦ → low dop, positive → high).
    expect(vals[0]!).toBeLessThan(vals[10]!);
    expect(vals[10]!).toBeLessThan(vals[20]!);
  });

  it('dop responds to basinVelocity component even when phiDelta is zero', () => {
    const baseInputs = {
      isAwake: true,
      phiDelta: 0,
      surprise: 0,
      quantumWeight: 0.3,
      kappa: 64,
      externalCoupling: 0.5,
    };
    const dop0 = computeNeurochemicals({ ...baseInputs, basinVelocity: 0 }).dopamine;
    const dop05 = computeNeurochemicals({ ...baseInputs, basinVelocity: 0.05 }).dopamine;
    const dop20 = computeNeurochemicals({ ...baseInputs, basinVelocity: 0.20 }).dopamine;
    expect(dop05).toBeLessThan(dop0);  // high-motion dampens reward expectation
    expect(dop20).toBeLessThan(dop05);
    expect(dop20).toBeGreaterThanOrEqual(0);
  });
});

describe('autonomic feedback — tick simulation (100-tick stddev contract)', () => {
  it('ach + ser + dop all vary across a 100-tick synthetic trajectory (#715 regression guard)', () => {
    const achs: number[] = [];
    const sers: number[] = [];
    const dops: number[] = [];
    let phi = 0.50;
    let bv = 0.05;
    for (let t = 0; t < 100; t++) {
      // Random walk for phi + bv to simulate live tape.
      phi += (Math.random() - 0.5) * 0.01;
      phi = Math.max(0.1, Math.min(0.9, phi));
      bv = 0.02 + Math.random() * 0.20;
      const phiDelta = (Math.random() - 0.5) * 0.01;
      // ticksSinceNovelty grows except on surprise spikes (10% chance).
      const surprise = Math.abs(phiDelta) * 2 + (Math.random() < 0.1 ? 0.08 : 0);
      const ticksSinceNovelty = surprise > 0.05 ? 0 : (t % 80);
      const nc = computeNeurochemicals({
        isAwake: true,
        phiDelta,
        basinVelocity: bv,
        surprise,
        quantumWeight: 0.3,
        kappa: 64,
        externalCoupling: 0.5,
        ticksSinceNovelty,
      });
      achs.push(nc.acetylcholine);
      sers.push(nc.serotonin);
      dops.push(nc.dopamine);
    }
    // Watchdog contract: each of ach / ser / dop must have stddev
    // above the "distinct count = 1" pinned regression floor.
    expect(stddev(achs)).toBeGreaterThan(0.01);
    expect(stddev(sers)).toBeGreaterThan(0.01);
    expect(stddev(dops)).toBeGreaterThan(0.005);
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
    // Integrate 10 basins; immediately decay enough times to kill them.
    for (let i = 0; i < 10; i++) {
      store.integrate(`old-${i}`, syntheticBasin(i), { weight: 1.0, correct: true });
    }
    // 0.95^90 ≈ 0.0099 < MIN_ACTIVE_WEIGHT(0.01); 90 decays should
    // push every entry below the threshold.
    for (let d = 0; d < 95; d++) store.decayAll();
    // All entries below threshold → sovereignty = 0.
    expect(store.sovereignty).toBe(0);
    // Now integrate 5 fresh basins — sov rebounds to active / total
    // (5 active / 15 total) ≈ 0.333.
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
    // Mark two as wrong via the canonical outcome API — weights collapse
    // to 0 (< MIN_ACTIVE_WEIGHT). `integrate(correct=false)` follows
    // `Math.max(old, new=0)` semantics by design (doesn't downgrade
    // already-correct basins); the outcome path is the right call when
    // a previously-confident basin is later disconfirmed.
    store.recordOutcome(`right-0`, false);
    store.recordOutcome(`right-1`, false);
    // 2 active / 4 total = 0.5.
    expect(store.sovereignty).toBeCloseTo(0.5, 6);
  });

  it('MIN_ACTIVE_WEIGHT threshold is the canonical 0.01', () => {
    expect(MIN_ACTIVE_WEIGHT).toBe(0.01);
  });
});
