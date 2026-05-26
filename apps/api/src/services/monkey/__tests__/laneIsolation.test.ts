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
  chooseLane,
  currentPositionSize,
  laneBudgetFraction,
  laneParam,
  shouldDCAAdd,
  shouldExtendBracket,
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
    // Path A (2026-05-26): slPct removed; only tpPct + budgetFrac remain.
    expect(laneParam('scalp', 'tpPct')).toBeLessThan(laneParam('swing', 'tpPct'));
  });

  it('swing envelope tighter than trend', () => {
    expect(laneParam('swing', 'tpPct')).toBeLessThan(laneParam('trend', 'tpPct'));
  });

  it('scalp budget is 1.0 (2026-05-25: per-lane caps stripped)', () => {
    expect(laneBudgetFraction('scalp')).toBe(1.0);
  });

  it('swing budget is 1.0 (2026-05-25: per-lane caps stripped)', () => {
    expect(laneBudgetFraction('swing')).toBe(1.0);
  });

  it('trend budget is 1.0 (2026-05-25: per-lane caps stripped, was 0.10)', () => {
    expect(laneBudgetFraction('trend')).toBe(1.0);
  });

  it('observe budget is 0', () => {
    expect(laneBudgetFraction('observe')).toBe(0);
  });

  it('LANE_PARAMETER_DEFAULTS exposes the three position-bearing lanes', () => {
    expect(Object.keys(LANE_PARAMETER_DEFAULTS).sort()).toEqual(['scalp', 'swing', 'trend']);
  });
});


describe('currentPositionSize lane-budget cap (post fix/lane-budget-size-zero-regression)', () => {
  it('threads lane and lane budget into derivation (2026-05-25: all lanes now 1.0)', () => {
    const result = currentPositionSize(
      basinState(0.5), 200, 1, 5, 10, MonkeyMode.INVESTIGATION, 'swing',
    );
    expect(result.derivation.laneBudgetFrac).toBeCloseTo(1.0, 9);
    expect(result.derivation.laneMarginCap).toBeCloseTo(1.0 * 200, 6);
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

  it('trend lane sizes within its budget cap (live since 2026-05-05)', () => {
    const equity = 200;
    const result = currentPositionSize(
      basinState(0.5), equity, 1, 5, 10, MonkeyMode.INVESTIGATION, 'trend',
    );
    // Trend is now 10% of equity. Margin must not exceed that cap.
    const cap = laneBudgetFraction('trend') * equity;
    expect(result.value).toBeLessThanOrEqual(cap + 1e-6);
    expect(result.value).toBeGreaterThan(0);
  });

  it('scalp lane margin never exceeds the lane budget cap', () => {
    const equity = 1000;
    const result = currentPositionSize(
      basinState(0.7, 0.7), equity, 1, 10, 50, MonkeyMode.INVESTIGATION, 'scalp',
    );
    // Cap is laneBudgetFraction × equity (margin cap, not equity haircut).
    const cap = laneBudgetFraction('scalp') * equity;
    expect(result.value).toBeLessThanOrEqual(cap + 1e-6);
  });
});


describe('shouldScalpExit lane envelope (Path A: TP-only)', () => {
  // Path A (2026-05-26): hard SL leg removed from shouldScalpExit.
  // The function is now take-profit-only. Adverse exits flow through
  // shouldExit (Fisher-Rao disagreement) and shouldAutoFlatten (P15).
  it('does NOT fire on losses (SL leg removed)', () => {
    const bs = basinState(0.5);
    // Pre-Path-A: raw -1% × lev 15 = ROI -15% would have fired scalp SL.
    // Post-Path-A: same input holds (no SL leg in this gate).
    const result = shouldScalpExit(-1.0, 100, bs, MonkeyMode.INVESTIGATION, 'scalp', 15);
    expect(result.value).toBe(false);
    expect(String(result.reason)).toContain('scalp hold');
  });

  it('does NOT fire on heavy losses across all lanes (SL leg removed)', () => {
    const bs = basinState(0.5);
    // Pre-Path-A: raw -1.5% × lev 15 = ROI -22.5%, past swing's 15% SL.
    // Post-Path-A: no lane fires SL on a loss.
    expect(shouldScalpExit(-1.5, 100, bs, MonkeyMode.INVESTIGATION, 'scalp', 15).value).toBe(false);
    expect(shouldScalpExit(-1.5, 100, bs, MonkeyMode.INVESTIGATION, 'swing', 15).value).toBe(false);
    expect(shouldScalpExit(-1.5, 100, bs, MonkeyMode.INVESTIGATION, 'trend', 15).value).toBe(false);
  });

  it('still fires take-profit at positive ROI above lane TP threshold', () => {
    const bs = basinState(0.5);
    // raw 1% × lev 15 = ROI 15% — at scalp's 3% TP. TP leg still fires.
    const result = shouldScalpExit(1.0, 100, bs, MonkeyMode.INVESTIGATION, 'scalp', 15);
    expect(result.value).toBe(true);
    expect(String(result.reason)).toContain('take_profit[scalp]');
    expect(result.derivation.exitTypeBit).toBe(1);
  });

  it('lane TP name surfaces into derivation (laneSlPct dropped by Path A)', () => {
    const bs = basinState(0.5);
    const result = shouldScalpExit(0.05, 100, bs, MonkeyMode.INVESTIGATION, 'scalp', 10);
    expect(result.derivation.laneTpPct).toBe(laneParam('scalp', 'tpPct'));
    expect(result.derivation.laneSlPct).toBeUndefined();
    expect(result.derivation.leverage).toBeCloseTo(10, 9);
  });

  it('default lane is swing (back-compat with pre-#10 callers)', () => {
    const bs = basinState(0.5);
    // No leverage → defaults to 1, ROI == raw. Negative ROI → holds (no SL leg).
    const result = shouldScalpExit(-1.0, 100, bs, MonkeyMode.INVESTIGATION);
    expect(result.value).toBe(false);
  });
});


describe('shouldExtendBracket trail gate (2026-05-25 strip)', () => {
  it('ratchets SL on any positive profit — meaningful-profit gate removed', () => {
    // Pre-strip: sub-dime / sub-1% profit gated trail off. Post-strip:
    // minTrailRoi = 0 and minTrailProfitUsdt = 0, so any inProfit
    // position with conviction permits ratchet. Chemistry learns
    // whether early trailing protects or over-tightens.
    const result = shouldExtendBracket({
      heldSide: 'long',
      entryPrice: 100,
      markPrice: 100.40,
      currentTp: 102,
      currentSl: 99,
      freshTpDistance: 3,
      freshSlDistance: 0.20,
      conviction: 0.4,
      currentRoiFrac: 0.004,
      currentPnlUsdt: 0.05,
    });

    // newSl candidate = 100.40 - 0.20 = 100.20 > currentSl 99 → ratchet.
    expect(result.changed).toBe(true);
    expect(result.newSl).toBeCloseTo(100.20, 6);
  });

  it('ratchets SL once profit clears the meaningful floor', () => {
    const result = shouldExtendBracket({
      heldSide: 'long',
      entryPrice: 100,
      markPrice: 101.50,
      currentTp: 102,
      currentSl: 99,
      freshTpDistance: 1,
      freshSlDistance: 0.20,
      conviction: 0.4,
      currentRoiFrac: 0.015,
      currentPnlUsdt: 0.25,
    });

    expect(result.changed).toBe(true);
    expect(result.newTp).toBeNull();
    expect(result.newSl).toBeCloseTo(101.30, 9);
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
    // v0.8.6: at lev=15x, raw -0.5% → ROI -7.5%. Past scalp's 5% SL,
    // inside swing's 15% SL. Same input, different lane decisions.
    // Path A (2026-05-26): both lanes hold on losses (SL leg removed).
    const swingLong = shouldScalpExit(-0.5, 100, bs, MonkeyMode.INVESTIGATION, 'swing', 15);
    const scalpShort = shouldScalpExit(-0.5, 100, bs, MonkeyMode.INVESTIGATION, 'scalp', 15);
    expect(swingLong.value).toBe(false);
    expect(scalpShort.value).toBe(false);
  });

  it('lane budgets are sized so simultaneous max-out cannot exceed notional ceiling', () => {
    // 2026-05-05: trend lane went 0 -> 0.10. Total is now 1.10 across the
    // three position-bearing lanes — by intent. Lanes rarely max out
    // simultaneously, and when they do, the notional ceiling
    // (NOTIONAL_CEILING_RATIO = 4× equity) bounds aggregate exposure
    // anyway. The invariant we care about is: each lane stays bounded,
    // and the SUM stays inside the notional ceiling.
    const total =
      laneBudgetFraction('scalp')
      + laneBudgetFraction('swing')
      + laneBudgetFraction('trend');
    expect(total).toBeLessThanOrEqual(4.0);  // notional ceiling ratio
    expect(laneBudgetFraction('scalp')).toBeGreaterThan(0);
    expect(laneBudgetFraction('swing')).toBeGreaterThan(0);
    expect(laneBudgetFraction('trend')).toBeGreaterThan(0);
  });

  it('scalp size never eats swing capital — lane budget caps separately', () => {
    const equity = 1000;
    const scalp = currentPositionSize(
      basinState(0.7, 0.7), equity, 1, 10, 50, MonkeyMode.INVESTIGATION, 'scalp',
    );
    // Margin cap is laneBudgetFraction × equity = 0.5 × 1000 = 500.
    const cap = laneBudgetFraction('scalp') * equity;
    expect(scalp.value).toBeLessThanOrEqual(cap + 1e-6);
  });

  it('lane parameter constants match the user-spec ROI ranges', () => {
    // v0.8.6: lane SL/TP rescaled to ROI-on-margin. Sanity that
    // LANE_PARAMETER_DEFAULTS hasn't drifted from spec.
    // Path A (2026-05-26): slPct removed — only tpPct + budgetFrac remain.
    expect((LANE_PARAMETER_DEFAULTS.scalp as Record<string, number>).slPct).toBeUndefined();
    expect((LANE_PARAMETER_DEFAULTS.swing as Record<string, number>).slPct).toBeUndefined();
    expect((LANE_PARAMETER_DEFAULTS.trend as Record<string, number>).slPct).toBeUndefined();
    // tpPct still defined and lane-ordered.
    expect(LANE_PARAMETER_DEFAULTS.scalp.tpPct).toBeGreaterThan(0);
    expect(LANE_PARAMETER_DEFAULTS.scalp.tpPct).toBeLessThan(LANE_PARAMETER_DEFAULTS.swing.tpPct);
    expect(LANE_PARAMETER_DEFAULTS.swing.tpPct).toBeLessThan(LANE_PARAMETER_DEFAULTS.trend.tpPct);
  });
});


// ─── fix/lane-budget-size-zero-regression — flat-account regression ───
//
// Pre-fix behaviour (PR #610): currentPositionSize multiplied
// availableEquity by laneBudgetFraction BEFORE the formula and the
// v0.6.6 lift-to-min, halving the pool the sizer had to work with.
// On small accounts (per-symbol exposure cap leaves ~$5 free) this
// pushed required_frac past the 0.5 safety clamp → no lift fired and
// every entry returned size=0. Trend lane (budget=0) collapsed every
// tick where chooseLane picked it.
//
// Post-fix: laneBudgetFraction caps the FINAL margin (after lift-to-
// min); equity is not haircut. Trend (cap=0) still collapses to 0;
// scalp/swing on flat accounts size > 0 down to exchange minimum.
describe('Flat-account sizing regression (fix/lane-budget-size-zero-regression)', () => {
  it('flat account, swing lane, ETH min — sizes > 0 (live alert symptom)', () => {
    const result = currentPositionSize(
      basinState(0.55, 0.5), 90, 22.49, 14, 0, MonkeyMode.INVESTIGATION, 'swing',
    );
    expect(result.value).toBeGreaterThan(0);
    const notional = result.value * 14;
    expect(notional).toBeGreaterThanOrEqual(22.49);
  });

  it('flat account, scalp lane, BTC min — sizes > 0 (live alert symptom)', () => {
    const result = currentPositionSize(
      basinState(0.55, 0.5), 90, 75.78, 14, 0, MonkeyMode.INTEGRATION, 'scalp',
    );
    expect(result.value).toBeGreaterThan(0);
    const notional = result.value * 14;
    expect(notional).toBeGreaterThanOrEqual(75.78);
  });

  it('small account ($5 equity) — explorationFloor itself clears min notional (CC2 F3 unification)', () => {
    // 2026-05-25 (CC2 audit F3): explorationFloor and lift-to-min now
    // share the same formula. With $5 equity at 14× lev for $22.49 min,
    // minClearingFrac = 22.49 × 1.05 / (14 × 5) = 0.337. The
    // explorationFloor at cold-start (maturity=0) is exactly that
    // 0.337 — no separate lift needed because the floor already
    // covers the exchange minimum.
    const result = currentPositionSize(
      basinState(0.55, 0.5), 5, 22.49, 14, 0, MonkeyMode.INVESTIGATION, 'swing',
    );
    expect(result.value).toBeGreaterThan(0);
    // Notional clears the exchange minimum (with 5% buffer).
    const notional = result.value * 14;
    expect(notional).toBeGreaterThanOrEqual(22.49);
  });

  it('cold-start (bank=0, sovereignty=0, low phi) still sizes via exploration floor', () => {
    const result = currentPositionSize(
      basinState(0.20, 0.0), 90, 22.49, 14, 0, MonkeyMode.INVESTIGATION, 'swing',
    );
    expect(result.value).toBeGreaterThan(0);
    const notional = result.value * 14;
    expect(notional).toBeGreaterThanOrEqual(22.49);
  });

  it('trend lane sizes against full equity (2026-05-25 strip)', () => {
    // Pre-strip: budget=0.10 capped trend at 10% of equity. Post-strip:
    // budget=1.0 — trend can use full equity like scalp/swing. The
    // kernel's own chemistry feedback is the differentiator, not a
    // static lane cap.
    const equity = 1000;
    const result = currentPositionSize(
      basinState(0.55, 0.5), equity, 22.49, 14, 20, MonkeyMode.INVESTIGATION, 'trend',
    );
    expect(result.derivation.laneMarginCap).toBeCloseTo(equity * 1.0, 6);
    expect(result.value).toBeGreaterThan(0);
  });

  it('lane margin cap surfaces in derivation', () => {
    const result = currentPositionSize(
      basinState(0.5), 200, 1, 5, 10, MonkeyMode.INVESTIGATION, 'swing',
    );
    expect(result.derivation.laneMarginCap).toBeCloseTo(200, 6);
  });

  it('scalp and swing report identical caps when budgets match', () => {
    const scalp = currentPositionSize(
      basinState(0.6), 400, 1, 5, 20, MonkeyMode.INVESTIGATION, 'scalp',
    );
    const swing = currentPositionSize(
      basinState(0.6), 400, 1, 5, 20, MonkeyMode.INVESTIGATION, 'swing',
    );
    expect(scalp.derivation.laneMarginCap)
      .toBeCloseTo(swing.derivation.laneMarginCap, 6);
  });

  it('chooseLane never returns a zero-budget position lane (fallback still active)', () => {
    // 2026-05-05: trend lane is now 0.10 (live). The structural-zero
    // fallback in chooseLane is preserved for the general case (any
    // position-bearing lane that gets registry-flipped back to 0 must
    // still redirect to a non-zero lane). Verify the invariant holds
    // without depending on trend being zero.
    const bs = basinState(0.9, 0.9);
    const result = chooseLane(bs, 1.0);
    if (result.value !== 'observe') {
      expect(laneBudgetFraction(result.value)).toBeGreaterThan(0);
    }
  });

  it('chooseLane keeps observe (it is decision-only, not capital-bearing)', () => {
    // High basinVelocity should let observe win the softmax. The
    // fallback is restricted to position-bearing lanes; observe must
    // surface so the loop can map it to swing for sizing.
    const bs = { ...basinState(0.4, 0.5), basinVelocity: 0.95 };
    const result = chooseLane(bs as any, 0.0);
    expect(['scalp', 'swing', 'trend', 'observe']).toContain(result.value);
  });

  it('mid-trade sizing on a single lane unaffected by other-lane existence', () => {
    // Sanity: changing leverage on a flat account still yields a sane
    // size; the lane cap binds independently of whatever else is going
    // on for this symbol.
    const bs = basinState(0.55, 0.5);
    const a = currentPositionSize(bs, 90, 22.49, 14, 0, MonkeyMode.INVESTIGATION, 'swing');
    const b = currentPositionSize(bs, 90, 22.49, 20, 0, MonkeyMode.INVESTIGATION, 'swing');
    expect(a.value).toBeGreaterThan(0);
    expect(b.value).toBeGreaterThan(0);
    // Higher leverage doesn't INCREASE margin (formula is leverage-
    // agnostic on the formula side; leverage matters only for notional
    // & lift-to-min). Both should be capped by the same lane cap.
    expect(a.derivation.laneMarginCap).toBe(b.derivation.laneMarginCap);
  });

  it('regression: pre-fix size=0 case from production logs', () => {
    // Direct reproduction of the bug from the production log:
    //   $90 equity, mode=integration, swing lane, ETH min $22.49, lev 14.
    // Pre-fix this returned 0; post-fix it must clear min notional.
    const bs = basinState(0.55, 0.5);
    const result = currentPositionSize(
      bs, 90, 22.49, 14, 0, MonkeyMode.INTEGRATION, 'swing',
    );
    expect(result.value).toBeGreaterThan(0);
    expect(result.value * 14).toBeGreaterThanOrEqual(22.49);
  });
});
