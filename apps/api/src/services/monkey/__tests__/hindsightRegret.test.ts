/**
 * hindsightRegret.test.ts — counterfactual-regret reward signal.
 *
 * Semantic cases (operator spec 2026-05-29):
 *   - held-would-have-won  → aversive regret scaled by foregone gain
 *   - held-would-have-lost → no regret / mild positive (good close)
 *   - regret bounded        → huge foregone gain doesn't blow up chemistry
 *   - flag OFF              → isHindsightRegretLive() false by default
 *
 * The asymmetry (regret ONLY when holding would have won) is the property
 * that stops the signal from making the kernel scared to ever close.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  counterfactualPnlUsdt,
  advanceWatch,
  resolveRegret,
  medianAbsoluteDeviation,
  isHindsightRegretLive,
  REGRET_DOP_CAP,
  GOOD_CLOSE_DOP,
  type HindsightWatch,
} from '../hindsightRegret.js';

function watch(overrides: Partial<HindsightWatch> = {}): HindsightWatch {
  return {
    symbol: 'BTC_USDT_PERP',
    sideSign: -1, // closed short (the operator's −$36 short into a downtrend)
    qty: 1,
    exitPrice: 100,
    realizedPnlUsdt: -36,
    marginUsdt: 100,
    closedAtMs: 0,
    expiresAtMs: 30 * 60 * 1000,
    bestCounterfactualPnlUsdt: -36, // seeded to realized
    ...overrides,
  };
}

describe('counterfactualPnlUsdt', () => {
  it('closed short gains when price falls after exit', () => {
    // short qty=1 exit=100, price drops to 90 → marginal = (90-100)*-1*1 = +10
    // total = realized(-36) + 10 = -26
    const cf = counterfactualPnlUsdt(
      { sideSign: -1, qty: 1, exitPrice: 100, realizedPnlUsdt: -36 },
      90,
    );
    expect(cf).toBeCloseTo(-26, 9);
  });

  it('closed short loses when price rises after exit', () => {
    // price rises to 110 → marginal = (110-100)*-1*1 = -10 → total = -46
    const cf = counterfactualPnlUsdt(
      { sideSign: -1, qty: 1, exitPrice: 100, realizedPnlUsdt: -36 },
      110,
    );
    expect(cf).toBeCloseTo(-46, 9);
  });

  it('closed long gains when price rises after exit', () => {
    const cf = counterfactualPnlUsdt(
      { sideSign: 1, qty: 2, exitPrice: 50, realizedPnlUsdt: 5 },
      55,
    );
    // marginal = (55-50)*1*2 = 10 → total = 15
    expect(cf).toBeCloseTo(15, 9);
  });

  it('fails closed on invalid input (returns null)', () => {
    expect(counterfactualPnlUsdt({ sideSign: -1, qty: 1, exitPrice: 100, realizedPnlUsdt: -36 }, NaN)).toBeNull();
    expect(counterfactualPnlUsdt({ sideSign: -1, qty: 1, exitPrice: 100, realizedPnlUsdt: -36 }, -1)).toBeNull();
    expect(counterfactualPnlUsdt({ sideSign: -1, qty: 0, exitPrice: 100, realizedPnlUsdt: -36 }, 90)).toBeNull();
    expect(counterfactualPnlUsdt({ sideSign: 0 as 1, qty: 1, exitPrice: 100, realizedPnlUsdt: -36 }, 90)).toBeNull();
  });
});

describe('advanceWatch', () => {
  it('tracks the BEST (most favourable) counterfactual over a window', () => {
    let w = watch(); // short, exit=100, realized=-36, best=-36
    w = advanceWatch(w, 95); // cf = -36 + (95-100)*-1 = -36+5 = -31
    expect(w.bestCounterfactualPnlUsdt).toBeCloseTo(-31, 9);
    w = advanceWatch(w, 90); // cf = -26 (better for holding the short)
    expect(w.bestCounterfactualPnlUsdt).toBeCloseTo(-26, 9);
    w = advanceWatch(w, 98); // cf = -34 (worse) → best unchanged
    expect(w.bestCounterfactualPnlUsdt).toBeCloseTo(-26, 9);
  });

  it('leaves best unchanged on invalid price', () => {
    let w = watch();
    w = advanceWatch(w, NaN);
    expect(w.bestCounterfactualPnlUsdt).toBe(-36);
  });
});

describe('resolveRegret — held-would-have-won (aversive)', () => {
  it('emits negative dopamine scaled by foregone gain', () => {
    // short closed at -36, but price kept falling: best counterfactual -10.
    // foregone gain = -10 - (-36) = 26. margin 100 → regretFrac 0.26.
    const d = resolveRegret(
      { bestCounterfactualPnlUsdt: -10, realizedPnlUsdt: -36, marginUsdt: 100 },
      [],
    );
    expect(d.source).toBe('hindsight_regret');
    expect(d.foregoneGainUsdt).toBeCloseTo(26, 9);
    expect(d.dopamineDelta).toBeLessThan(0);
    // -tanh(0.26)*0.5 ≈ -0.127
    expect(d.dopamineDelta).toBeCloseTo(-Math.tanh(0.26) * REGRET_DOP_CAP, 6);
  });

  it('bigger foregone gain stings more (monotone), up to the cap', () => {
    const small = resolveRegret(
      { bestCounterfactualPnlUsdt: -30, realizedPnlUsdt: -36, marginUsdt: 100 }, [],
    );
    const big = resolveRegret(
      { bestCounterfactualPnlUsdt: 50, realizedPnlUsdt: -36, marginUsdt: 100 }, [],
    );
    expect(Math.abs(big.dopamineDelta)).toBeGreaterThan(Math.abs(small.dopamineDelta));
  });
});

describe('resolveRegret — held-would-have-lost (good close)', () => {
  it('no regret + mild positive when counterfactual <= realized', () => {
    // short closed at -36; if held it would have been -46 (price rose).
    const d = resolveRegret(
      { bestCounterfactualPnlUsdt: -46, realizedPnlUsdt: -36, marginUsdt: 100 }, [],
    );
    expect(d.source).toBe('hindsight_good_close');
    expect(d.foregoneGainUsdt).toBe(0);
    expect(d.dopamineDelta).toBe(GOOD_CLOSE_DOP);
    expect(d.dopamineDelta).toBeGreaterThan(0);
  });

  it('break-even (best == realized) is a good close, not regret', () => {
    const d = resolveRegret(
      { bestCounterfactualPnlUsdt: -36, realizedPnlUsdt: -36, marginUsdt: 100 }, [],
    );
    expect(d.source).toBe('hindsight_good_close');
  });
});

describe('resolveRegret — bounded (cannot paralyse)', () => {
  it('a huge foregone gain stays within the dopamine cap', () => {
    const d = resolveRegret(
      { bestCounterfactualPnlUsdt: 1_000_000, realizedPnlUsdt: -36, marginUsdt: 100 }, [],
    );
    // tanh asymptotes to 1.0 → delta is bounded AT (never beyond) the cap.
    expect(d.dopamineDelta).toBeGreaterThanOrEqual(-REGRET_DOP_CAP);
    expect(d.dopamineDelta).toBeLessThanOrEqual(0);
    expect(Math.abs(d.dopamineDelta)).toBeLessThanOrEqual(REGRET_DOP_CAP);
  });

  it('observer normalisation: MAD scales the sting to the kernel\'s own pnl band', () => {
    // With a tight pnl_frac history (small MAD) the same regretFrac maps to a
    // larger normalised value → larger (still bounded) sting.
    const tightHistory = [0.001, 0.002, -0.001, 0.0, 0.0015];
    const wideHistory = [0.5, -0.5, 0.3, -0.3, 0.0];
    const tight = resolveRegret(
      { bestCounterfactualPnlUsdt: -30, realizedPnlUsdt: -36, marginUsdt: 100 }, tightHistory,
    );
    const wide = resolveRegret(
      { bestCounterfactualPnlUsdt: -30, realizedPnlUsdt: -36, marginUsdt: 100 }, wideHistory,
    );
    expect(Math.abs(tight.dopamineDelta)).toBeGreaterThan(Math.abs(wide.dopamineDelta));
    expect(Math.abs(tight.dopamineDelta)).toBeLessThanOrEqual(REGRET_DOP_CAP);
  });

  it('fails closed on invalid margin / non-finite', () => {
    expect(resolveRegret({ bestCounterfactualPnlUsdt: 10, realizedPnlUsdt: -5, marginUsdt: 0 }, []).dopamineDelta).toBe(0);
    expect(resolveRegret({ bestCounterfactualPnlUsdt: NaN, realizedPnlUsdt: -5, marginUsdt: 100 }, []).dopamineDelta).toBe(0);
  });
});

describe('medianAbsoluteDeviation', () => {
  it('matches the pushReward MAD shape', () => {
    expect(medianAbsoluteDeviation([])).toBe(0);
    expect(medianAbsoluteDeviation([1, 1, 1])).toBe(0);
    // [1,2,3,4,5] median 3, devs [2,1,0,1,2] sorted [0,1,1,2,2] median 1
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1);
  });
});

describe('flag — default OFF', () => {
  const prev = process.env.MONKEY_HINDSIGHT_REGRET_LIVE;
  afterEach(() => {
    if (prev === undefined) delete process.env.MONKEY_HINDSIGHT_REGRET_LIVE;
    else process.env.MONKEY_HINDSIGHT_REGRET_LIVE = prev;
  });

  it('is false when unset', () => {
    delete process.env.MONKEY_HINDSIGHT_REGRET_LIVE;
    expect(isHindsightRegretLive()).toBe(false);
  });

  it('is false for any value other than "true"', () => {
    process.env.MONKEY_HINDSIGHT_REGRET_LIVE = 'false';
    expect(isHindsightRegretLive()).toBe(false);
    process.env.MONKEY_HINDSIGHT_REGRET_LIVE = '1';
    expect(isHindsightRegretLive()).toBe(false);
  });

  it('is true only for exactly "true"', () => {
    process.env.MONKEY_HINDSIGHT_REGRET_LIVE = 'true';
    expect(isHindsightRegretLive()).toBe(true);
  });
});
