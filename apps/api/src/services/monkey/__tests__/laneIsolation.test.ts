/**
 * laneIsolation.test.ts — Proposal #10 lane-isolated position lifecycle
 * (TypeScript parity with ml-worker/tests/monkey_kernel/test_lane_isolation.py).
 *
 * Validates the executive-side promises of proposal #10:
 *   - Lane parameter envelope (scalp tighter than swing tighter than trend)
 *   - currentPositionSize lane-budget shrinkage
 *   - shouldScalpExit lane envelope widening (max(geometric, lane))
 *   - shouldDCAAdd lane scope on the side-mismatch rejection
 *   - Cross-lane non-interference (the core invariant)
 */

import { describe, it, expect } from 'vitest';
import {
  LANE_PARAMETER_DEFAULTS,
  currentPositionSize,
  laneBudgetFraction,
  laneParam,
  shouldDCAAdd,
  shouldScalpExit,
} from '../executive.js';
import { BASIN_DIM } from '../basin.js';
import { MonkeyMode } from '../modes.js';

const NEUTRAL_NC = {
  acetylcholine: 0.5, dopamine: 0.5, serotonin: 0.5,
  norepinephrine: 0.5, gaba: 0.5, endorphins: 0.0,
};

function basinState(phi = 0.5, sovereignty = 0.5) {
  const b = new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
  return {
    basin: b as unknown as Float64Array,
    identityBasin: b as unknown as Float64Array,
    phi,
    kappa: 64,
    basinVelocity: 0.05,
    regimeWeights: { quantum: 0.33, efficient: 0.33, equilibrium: 0.34 },
    sovereignty,
    neurochemistry: NEUTRAL_NC,
  } as any;
}

describe('Lane parameter envelope (proposal #10)', () => {
  it('scalp envelope tighter than swing', () => {
    expect(laneParam('scalp', 'slPct')).toBeLessThan(laneParam('swing', 'slPct'));
    expect(laneParam('scalp', 'tpPct')).toBeLessThan(laneParam('swing', 'tpPct'));
  });

  it('swing envelope tighter than trend', () => {
    expect(laneParam('swing', 'slPct')).toBeLessThan(laneParam('trend', 'slPct'));
    expect(laneParam('swing', 'tpPct')).toBeLessThan(laneParam('trend', 'tpPct'));
  });

  it('scalp SL is roughly 0.4%', () => {
    const sl = laneParam('scalp', 'slPct');
    expect(sl).toBeGreaterThanOrEqual(0.002);
    expect(sl).toBeLessThanOrEqual(0.008);
  });

  it('swing SL is roughly 1.5%', () => {
    const sl = laneParam('swing', 'slPct');
    expect(sl).toBeGreaterThanOrEqual(0.010);
    expect(sl).toBeLessThanOrEqual(0.025);
  });

  it('trend SL is 3-5%', () => {
    const sl = laneParam('trend', 'slPct');
    expect(sl).toBeGreaterThanOrEqual(0.025);
    expect(sl).toBeLessThanOrEqual(0.06);
  });

  it('scalp + swing budgets sum to 1', () => {
    expect(
      laneBudgetFraction('scalp') + laneBudgetFraction('swing'),
    ).toBeCloseTo(1.0, 9);
  });

  it('trend budget defaults to 0 (opt-in)', () => {
    expect(laneBudgetFraction('trend')).toBe(0);
  });

  it('observe budget is 0', () => {
    expect(laneBudgetFraction('observe')).toBe(0);
  });

  it('LANE_PARAMETER_DEFAULTS exposes the three position-bearing lanes', () => {
    expect(Object.keys(LANE_PARAMETER_DEFAULTS).sort()).toEqual(['scalp', 'swing', 'trend']);
  });
});


describe('currentPositionSize lane-budget shrinkage', () => {
  it('threads lane and lane budget into derivation', () => {
    const result = currentPositionSize(
      basinState(0.5), 200, 1, 5, 10, MonkeyMode.INVESTIGATION, 'swing',
    );
    expect(result.derivation.laneBudgetFrac).toBeCloseTo(0.5, 9);
  });

  it('scalp + swing both at default 0.5 produce comparable margins', () => {
    const scalp = currentPositionSize(
      basinState(0.6), 100, 1, 10, 20, MonkeyMode.INVESTIGATION, 'scalp',
    );
    const swing = currentPositionSize(
      basinState(0.6), 100, 1, 10, 20, MonkeyMode.INVESTIGATION, 'swing',
    );
    expect(scalp.value).toBeCloseTo(swing.value, 6);
  });

  it('trend budget=0 sizes to zero (opt-in lane)', () => {
    const result = currentPositionSize(
      basinState(0.5), 200, 1, 5, 10, MonkeyMode.INVESTIGATION, 'trend',
    );
    expect(result.value).toBe(0);
  });

  it('scalp lane size never exceeds 50% of lane-budgeted equity', () => {
    const equity = 1000;
    const result = currentPositionSize(
      basinState(0.7, 0.7), equity, 1, 10, 50, MonkeyMode.INVESTIGATION, 'scalp',
    );
    const cap = 0.5 * laneBudgetFraction('scalp') * equity;
    expect(result.value).toBeLessThanOrEqual(cap + 1e-6);
  });
});


describe('shouldScalpExit lane envelope (proposal #10)', () => {
  it('scalp lane = current geometric behavior (max keeps geometric)', () => {
    const bs = basinState(0.5);
    // 1% loss exceeds geometric SL for INVESTIGATION mode.
    const result = shouldScalpExit(-1.0, 100, bs, MonkeyMode.INVESTIGATION, 'scalp');
    expect(result.value).toBe(true);
    expect(String(result.reason)).toContain('stop_loss[scalp]');
  });

  it('swing lane absorbs a loss the scalp lane would exit on', () => {
    const bs = basinState(0.5);
    // 1% loss: scalp exits, swing holds (lane envelope 1.5% > geometric).
    const scalp = shouldScalpExit(-1.0, 100, bs, MonkeyMode.INVESTIGATION, 'scalp');
    const swing = shouldScalpExit(-1.0, 100, bs, MonkeyMode.INVESTIGATION, 'swing');
    expect(scalp.value).toBe(true);
    expect(swing.value).toBe(false);
    expect(String(swing.reason)).toContain('scalp hold[swing]');
  });

  it('trend lane absorbs a loss the swing lane would exit on', () => {
    const bs = basinState(0.5);
    // 2.5% loss exceeds swing SL but fits inside trend envelope.
    const swing = shouldScalpExit(-2.5, 100, bs, MonkeyMode.INVESTIGATION, 'swing');
    const trend = shouldScalpExit(-2.5, 100, bs, MonkeyMode.INVESTIGATION, 'trend');
    expect(swing.value).toBe(true);
    expect(trend.value).toBe(false);
  });

  it('lane name surfaces into derivation', () => {
    const bs = basinState(0.5);
    const result = shouldScalpExit(0.05, 100, bs, MonkeyMode.INVESTIGATION, 'scalp');
    expect(result.derivation.laneTpPct).toBe(laneParam('scalp', 'tpPct'));
    expect(result.derivation.laneSlPct).toBe(laneParam('scalp', 'slPct'));
  });

  it('default lane is swing (back-compat with pre-#10 callers)', () => {
    const bs = basinState(0.5);
    const result = shouldScalpExit(-1.0, 100, bs, MonkeyMode.INVESTIGATION);
    // Same as explicit swing — 1% loss holds in swing's wider envelope.
    expect(result.value).toBe(false);
  });
});


describe('shouldDCAAdd lane scope (proposal #10)', () => {
  it('same-lane mismatch rejects with rule 1 + lane in reason', () => {
    const result = shouldDCAAdd({
      heldSide: 'long', sideCandidate: 'short',
      currentPrice: 100, initialEntryPrice: 100,
      addCount: 0, lastAddAtMs: 0, nowMs: 10_000_000,
      sovereignty: 0.5, lane: 'swing',
    });
    expect(result.value).toBe(false);
    expect(result.derivation.rule).toBe(1);
    expect(String(result.reason)).toContain('lane swing');
  });

  it('same-side same-lane DCA allowed with lane in reason', () => {
    // Held long at 100, current 98 (-2%, satisfies BETTER_PRICE_FRAC=0.01),
    // cooldown elapsed, sovereignty above floor.
    const result = shouldDCAAdd({
      heldSide: 'long', sideCandidate: 'long',
      currentPrice: 98, initialEntryPrice: 100,
      addCount: 0, lastAddAtMs: 0, nowMs: 1e12,
      sovereignty: 0.5, lane: 'scalp',
    });
    expect(result.value).toBe(true);
    expect(String(result.reason)).toContain('DCA_OK[scalp]');
  });

  it('lane defaults to swing when omitted', () => {
    const result = shouldDCAAdd({
      heldSide: 'long', sideCandidate: 'short',
      currentPrice: 100, initialEntryPrice: 100,
      addCount: 0, lastAddAtMs: 0, nowMs: 10_000_000,
      sovereignty: 0.5,
    });
    expect(String(result.reason)).toContain('lane swing');
  });
});


describe('Cross-lane non-interference (proposal #10 invariant)', () => {
  it('swing-long envelope does not exit on a loss scalp would close on', () => {
    const bs = basinState(0.5);
    // 1% loss — between geometric SL (~0.67%) and swing's 1.5%
    const swingLong = shouldScalpExit(-1.0, 100, bs, MonkeyMode.INVESTIGATION, 'swing');
    const scalpShort = shouldScalpExit(-1.0, 100, bs, MonkeyMode.INVESTIGATION, 'scalp');
    expect(swingLong.value).toBe(false);
    expect(scalpShort.value).toBe(true);
  });

  it('lane budgets partition capital (sum <= 1.0)', () => {
    const total =
      laneBudgetFraction('scalp')
      + laneBudgetFraction('swing')
      + laneBudgetFraction('trend');
    expect(total).toBeLessThanOrEqual(1.0 + 1e-9);
  });

  it('scalp size never eats swing capital — lane budget caps separately', () => {
    const equity = 1000;
    const scalp = currentPositionSize(
      basinState(0.7, 0.7), equity, 1, 10, 50, MonkeyMode.INVESTIGATION, 'scalp',
    );
    const cap = 0.5 * laneBudgetFraction('scalp') * equity;
    expect(scalp.value).toBeLessThanOrEqual(cap + 1e-6);
  });

  it('lane parameter constants match the user-spec ranges', () => {
    // Sanity: this catches accidental edits to LANE_PARAMETER_DEFAULTS
    // that would drift away from the proposal #10 spec.
    expect(LANE_PARAMETER_DEFAULTS.scalp.slPct).toBeGreaterThanOrEqual(0.002);
    expect(LANE_PARAMETER_DEFAULTS.scalp.slPct).toBeLessThanOrEqual(0.008);
    expect(LANE_PARAMETER_DEFAULTS.swing.slPct).toBeGreaterThanOrEqual(0.010);
    expect(LANE_PARAMETER_DEFAULTS.swing.slPct).toBeLessThanOrEqual(0.025);
    expect(LANE_PARAMETER_DEFAULTS.trend.slPct).toBeGreaterThanOrEqual(0.025);
    expect(LANE_PARAMETER_DEFAULTS.trend.slPct).toBeLessThanOrEqual(0.06);
  });
});
