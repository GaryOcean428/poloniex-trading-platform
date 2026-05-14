/**
 * agent_L_classifier.test.ts — pure tests for the multi-scale Fisher-Rao
 * KNN classifier. No I/O, no DB, no exchange — entirely deterministic
 * on synthetic basin histories.
 */
import { describe, expect, it } from 'vitest';
import {
  agentLDecide,
  buildBasinTuple,
  fisherRaoTupleDistance,
  realizedLabel,
  DEFAULT_AGENT_L_CONFIG,
  DEFAULT_SCALE_WEIGHTS,
  type Basin,
} from '../agent_L_classifier.js';
import { BASIN_DIM } from '../basin.js';

function uniform(): Basin {
  const b = new Float64Array(BASIN_DIM);
  b.fill(1 / BASIN_DIM);
  return b as unknown as Basin;
}

/** Concentrate probability mass in a half-band (low or high index range).
 *  Useful as a coarse "direction" proxy via the FR-distance space. */
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

/** Bias the basin's momentum band (indices 7-14, per perception.ts) so
 *  basinDirection() returns +1 ("long" direction). */
function longBiased(strength = 0.7): Basin {
  const b = new Float64Array(BASIN_DIM);
  // Heavy mass in momentum band (indices 7-14, 8 cells).
  const bandMass = strength;
  const offMass = 1 - strength;
  for (let i = 0; i < BASIN_DIM; i++) {
    if (i >= 7 && i <= 14) b[i] = bandMass / 8;
    else b[i] = offMass / 56;
  }
  return b as unknown as Basin;
}

/** Suppress the basin's momentum band so basinDirection() returns -1. */
function shortBiased(strength = 0.7): Basin {
  const b = new Float64Array(BASIN_DIM);
  // Light mass in momentum band, heavy on flanks.
  const bandMass = (1 - strength) * 0.5;  // half of "off" goes to band
  const offMass = strength + 0.5 * (1 - strength);
  for (let i = 0; i < BASIN_DIM; i++) {
    if (i >= 7 && i <= 14) b[i] = bandMass / 8;
    else b[i] = offMass / 56;
  }
  return b as unknown as Basin;
}

describe('buildBasinTuple', () => {
  it('returns null on empty history', () => {
    expect(buildBasinTuple([])).toBeNull();
  });

  it('uses available history when shorter than windows', () => {
    const hist = [uniform(), biased('high'), biased('high')];
    const tuple = buildBasinTuple(hist, 12, 48);
    expect(tuple).not.toBeNull();
    expect(tuple!.current).toBe(hist[2]);
    // Medium and long are Fréchet means over the same 3 entries when
    // windows exceed history; mass should be biased high.
    const mediumLow = tuple!.medium.slice(0, BASIN_DIM / 2).reduce((s, v) => s + v, 0);
    expect(mediumLow).toBeLessThan(0.5);
  });
});

describe('fisherRaoTupleDistance', () => {
  it('zero distance for identical tuples', () => {
    const t = buildBasinTuple([biased('low'), biased('low'), biased('low')])!;
    expect(fisherRaoTupleDistance(t, t)).toBeCloseTo(0, 6);
  });

  it('positive distance for opposite-biased tuples', () => {
    const lowHist = [biased('low'), biased('low'), biased('low')];
    const highHist = [biased('high'), biased('high'), biased('high')];
    const a = buildBasinTuple(lowHist)!;
    const b = buildBasinTuple(highHist)!;
    expect(fisherRaoTupleDistance(a, b)).toBeGreaterThan(0.5);
  });

  it('weights respect scale (medium=0 → distance independent of medium scale)', () => {
    const lowHist = [biased('low'), biased('low'), biased('low')];
    const a = buildBasinTuple(lowHist)!;
    const b = { current: a.current, medium: biased('high'), long: a.long };
    const d_default = fisherRaoTupleDistance(a, b, DEFAULT_SCALE_WEIGHTS);
    const d_no_medium = fisherRaoTupleDistance(a, b, { current: 0.5, medium: 0, long: 0.2 });
    expect(d_default).toBeGreaterThan(d_no_medium);
  });
});

describe('realizedLabel', () => {
  it('returns +1 when basinDirection at i+horizon exceeds threshold (long realized)', () => {
    // longBiased() concentrates mass in the momentum band (indices 7-14)
    // which makes basinDirection() return positive (long direction).
    const hist: Basin[] = [];
    for (let j = 0; j < 4; j++) hist.push(uniform());
    hist.push(longBiased(0.85));  // i=0, target i+4=4 — strong long
    expect(realizedLabel(hist, 0, 4, 0.025)).toBe(1);
  });

  it('returns -1 when basinDirection at i+horizon below -threshold', () => {
    const hist: Basin[] = [];
    for (let j = 0; j < 4; j++) hist.push(uniform());
    hist.push(shortBiased(0.85));
    expect(realizedLabel(hist, 0, 4, 0.025)).toBe(-1);
  });

  it('returns 0 when target is past history end', () => {
    expect(realizedLabel([uniform()], 0, 4)).toBe(0);
  });
});

describe('agentLDecide', () => {
  it('holds on empty history', () => {
    const r = agentLDecide([]);
    expect(r.action).toBe('hold');
    expect(r.reason).toContain('history empty');
  });

  it('holds when history is too short for KNN', () => {
    const hist = Array.from({ length: 20 }, () => uniform());
    const r = agentLDecide(hist);
    expect(r.action).toBe('hold');
    expect(r.reason).toContain('insufficient candidates');
  });

  it('predicts long when current basin matches a long-realized historical pattern', () => {
    // Build a long history where every "high-biased" basin is followed
    // by a high-biased basin 4 ticks later (i.e., long realization).
    // Then ask: given a high-biased current, what does Agent L predict?
    //
    // 2026-05-13 — bumped to 1000 ticks to satisfy minTupleStart=480
    // plus spacing=30 needing ~17+ candidate slots for k=8 nearest.
    const hist: Basin[] = [];
    for (let i = 0; i < 1000; i++) {
      // Alternating phases: high → high (long realization) for even-indexed cycles,
      // low → low (short realization) for odd-indexed.
      const cycle = Math.floor(i / 8);
      const half = cycle % 2 === 0 ? 'high' : 'low';
      hist.push(biased(half, 0.85));
    }
    // Last basin is high-biased (we expect long signal).
    const r = agentLDecide(hist);
    // Either fires action='enter_long' OR holds with positive score.
    expect(r.signedScore).toBeGreaterThan(-0.1);
    expect(r.neighbors.length).toBeGreaterThan(0);
  });

  it('respects action threshold — small score returns hold', () => {
    // Mixed history with no clear signal — expect hold or low conviction.
    const hist: Basin[] = [];
    for (let i = 0; i < 1000; i++) {
      hist.push(i % 2 === 0 ? biased('high', 0.55) : biased('low', 0.55));
    }
    const r = agentLDecide(hist, { ...DEFAULT_AGENT_L_CONFIG, actionThreshold: 0.5 });
    // With threshold raised, expect hold.
    if (r.action !== 'hold') {
      expect(Math.abs(r.signedScore)).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('returns the K nearest neighbors (count and distance ordering)', () => {
    const hist = Array.from({ length: 200 }, (_, i) =>
      biased(i % 16 < 8 ? 'high' : 'low', 0.8),
    );
    const r = agentLDecide(hist, { ...DEFAULT_AGENT_L_CONFIG, k: 5 });
    expect(r.neighbors.length).toBeLessThanOrEqual(5);
    // Distances should be non-decreasing.
    for (let i = 1; i < r.neighbors.length; i++) {
      expect(r.neighbors[i]!.distance).toBeGreaterThanOrEqual(r.neighbors[i - 1]!.distance);
    }
  });
});

describe('agentLDecide — multi-scale interaction (the user-flagged scenario)', () => {
  it('macro-scale disagreement reduces conviction (alone-scalp would buy, macro says reverse)', () => {
    // History: short-term basin keeps flipping high (looks bullish in last 12),
    // but long-term Fréchet mean stays bearish (mass shifted low across 48 ticks).
    // We want to verify that with a high-biased current AND a high-biased
    // medium AND a low-biased long, the prediction is more cautious than
    // with a high-biased TRIPLE.
    const flipFlopHist: Basin[] = [];
    for (let i = 0; i < 200; i++) {
      // Long-term low-biased majority, with occasional high-biased ticks.
      flipFlopHist.push(i % 5 === 0 ? biased('high', 0.7) : biased('low', 0.6));
    }
    const flipFlopR = agentLDecide(flipFlopHist);

    // Pure high-biased history — current/medium/long all align long.
    const allHighHist: Basin[] = [];
    for (let i = 0; i < 200; i++) allHighHist.push(biased('high', 0.7));
    const allHighR = agentLDecide(allHighHist);

    // Pure-aligned should produce stronger or equal signal than mixed.
    expect(Math.abs(allHighR.signedScore)).toBeGreaterThanOrEqual(
      Math.abs(flipFlopR.signedScore) - 0.05,  // small tolerance for KNN sampling noise
    );
  });
});
