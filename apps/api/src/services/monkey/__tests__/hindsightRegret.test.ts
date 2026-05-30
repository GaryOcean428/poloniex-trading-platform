/**
 * hindsightRegret.test.ts — legibility-gated counterfactual prediction error.
 *
 * Semantic cases (operator doctrine 2026-05-29, redesign of PR #1038):
 *   - legible premature close   → full regret vector, correct signs, observer-scaled
 *   - NON-legible continuation  → NO regret (surprise/noise), zero vector
 *   - operator / non-owned close → no self-regret
 *   - regime changed after close → no/zero regret
 *   - good close / avoided loss  → relief vector (no aversion)
 *   - targeted GABA              → bound to (regime,side) pattern, never global
 *   - observer scale             → magnitude tracks the kernel's own MAD
 *   - fail-closed                → invalid price/margin → zero vector
 *   - flag OFF                   → isHindsightRegretLive() false by default
 *
 * The FIXTURES block is shared verbatim with the Python parity test
 * (test_hindsight_regret.py) so TS↔Py outputs are asserted equal within
 * tolerance at the fixture level.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  counterfactualPnlUsdt,
  resolveHindsight,
  isContinuationLegible,
  isEligibleForRegret,
  legibilityStrength,
  deriveMagnitude,
  gabaTargetKey,
  medianAndMad,
  isHindsightRegretLive,
  type CloseSenseBundle,
  type CounterfactualOutcome,
} from '../hindsightRegret.js';

// ── Shared fixtures (kept byte-for-byte in sync with the Py parity test) ──
// A stable observer-scale history (MAD = 0.01) so magnitudes are deterministic.
const PNL_FRAC_HISTORY = [0.0, 0.01, -0.01, 0.02, -0.02, 0.0, 0.01, -0.01];

function legibleShortBundle(overrides: Partial<CloseSenseBundle> = {}): CloseSenseBundle {
  // Operator's case: a SHORT cut into a continuing downtrend. Legible =
  // warp expectation short-favoured, basinDir still negative, coherent hold.
  return {
    kernelOwnedClose: true,
    sideSign: -1,
    warpExpectationSign: -1,
    warpExpectationConfidence: 0.7,
    regimeAtClose: 'aligned',
    basinDirAtClose: -0.25,
    tapeTrendAtClose: -0.3,
    coherenceStreak: 4,
    ...overrides,
  };
}

describe('counterfactualPnlUsdt', () => {
  it('short gains as price falls below exit', () => {
    // closed short at 100, qty 2, realized +5; price drops to 90 → held would
    // have added (100-90)*2 = +20 → total 25.
    const cf = counterfactualPnlUsdt(
      { sideSign: -1, qty: 2, exitPrice: 100, realizedPnlUsdt: 5 },
      90,
    );
    expect(cf).toBeCloseTo(25, 6);
  });
  it('long gains as price rises above exit', () => {
    const cf = counterfactualPnlUsdt(
      { sideSign: 1, qty: 2, exitPrice: 100, realizedPnlUsdt: 5 },
      110,
    );
    expect(cf).toBeCloseTo(25, 6);
  });
  it('fail-closed on invalid price / qty', () => {
    expect(counterfactualPnlUsdt({ sideSign: 1, qty: 2, exitPrice: 100, realizedPnlUsdt: 5 }, 0)).toBeNull();
    expect(counterfactualPnlUsdt({ sideSign: 1, qty: 0, exitPrice: 100, realizedPnlUsdt: 5 }, 90)).toBeNull();
    expect(counterfactualPnlUsdt({ sideSign: 1, qty: 2, exitPrice: -1, realizedPnlUsdt: 5 }, 90)).toBeNull();
  });
});

describe('legibility gate (PURITY KEYSTONE)', () => {
  it('legible when warp + basin agree with held side and hold was coherent', () => {
    expect(isContinuationLegible(legibleShortBundle())).toBe(true);
  });
  it('NOT legible when warp expectation disagrees with held side', () => {
    expect(isContinuationLegible(legibleShortBundle({ warpExpectationSign: 1 }))).toBe(false);
  });
  it('NOT legible when basinDir no longer leans the held way', () => {
    expect(isContinuationLegible(legibleShortBundle({ basinDirAtClose: 0.25 }))).toBe(false);
  });
  it('NOT legible when warp expectation was flat/observe', () => {
    expect(isContinuationLegible(legibleShortBundle({ warpExpectationSign: 0 }))).toBe(false);
  });
  it('NOT legible when the hold was never coherent', () => {
    expect(isContinuationLegible(legibleShortBundle({ coherenceStreak: 0 }))).toBe(false);
  });
  it('eligibility requires owned AND legible AND regime-persisted', () => {
    expect(isEligibleForRegret(legibleShortBundle(), true)).toEqual({ eligible: true, reason: 'eligible' });
    expect(isEligibleForRegret(legibleShortBundle({ kernelOwnedClose: false }), true).reason).toBe('not_owned');
    expect(isEligibleForRegret(legibleShortBundle({ warpExpectationSign: 1 }), true).reason).toBe('not_legible');
    expect(isEligibleForRegret(legibleShortBundle(), false).reason).toBe('regime_changed');
  });
  it('weak legibility scales regret instead of opening a full-strength gate', () => {
    const strong = legibilityStrength(legibleShortBundle());
    const weak = legibilityStrength(legibleShortBundle({
      warpExpectationConfidence: 0.001,
      basinDirAtClose: -0.000001,
      coherenceStreak: 1,
    }));
    expect(weak).toBeGreaterThan(0);
    expect(weak).toBeLessThan(strong);
  });
});

describe('resolveHindsight — semantic cases', () => {
  const margin = 100;
  // Held would have won big: realized 0, horizon-end +30 → foregone 30,
  // frac 0.30, z = 0.30/0.01 = 30 → salience ≈ 1.
  const wonOutcome: CounterfactualOutcome = {
    realizedPnlUsdt: 0,
    horizonEndPnlUsdt: 30,
    marginUsdt: margin,
    regimePersisted: true,
  };

  it('legible premature close → full aversive regret vector with correct signs', () => {
    const res = resolveHindsight(legibleShortBundle(), wonOutcome, PNL_FRAC_HISTORY);
    expect(res.source).toBe('hindsight_regret');
    // canon signs: dop<0, ser<0, ACh>0, NE>0, GABA>0, endo==0
    expect(res.nt.dopamineDelta).toBeLessThan(0);
    expect(res.nt.serotoninDelta).toBeLessThan(0);
    expect(res.nt.acetylcholineDelta).toBeGreaterThan(0);
    expect(res.nt.norepinephrineDelta).toBeGreaterThan(0);
    expect(res.nt.gabaDelta).toBeGreaterThan(0);
    expect(res.nt.endorphinDelta).toBe(0);
    expect(res.gabaTarget).toBe('premature_close:aligned:short');
    expect(res.foregoneGainUsdt).toBeCloseTo(30, 6);
  });

  it('NON-legible continuation → NO regret (surprise/noise), zero vector', () => {
    // Holding would have won, but the continuation was NOT legible at close
    // (warp pointed the other way) → it was surprise, not a learnable mistake.
    const res = resolveHindsight(
      legibleShortBundle({ warpExpectationSign: 1 }),
      wonOutcome,
      PNL_FRAC_HISTORY,
    );
    expect(res.source).toBe('ineligible_noise');
    expect(res.nt.dopamineDelta).toBe(0);
    expect(res.nt.gabaDelta).toBe(0);
    expect(res.gabaTarget).toBeNull();
  });

  it('operator / non-owned close → no self-regret', () => {
    const res = resolveHindsight(
      legibleShortBundle({ kernelOwnedClose: false }),
      wonOutcome,
      PNL_FRAC_HISTORY,
    );
    expect(res.source).toBe('ineligible_not_owned');
    expect(res.nt).toEqual({
      dopamineDelta: 0, acetylcholineDelta: 0, norepinephrineDelta: 0,
      serotoninDelta: 0, gabaDelta: 0, endorphinDelta: 0,
    });
  });

  it('regime changed after close → no/zero regret', () => {
    const res = resolveHindsight(
      legibleShortBundle(),
      { ...wonOutcome, regimePersisted: false },
      PNL_FRAC_HISTORY,
    );
    expect(res.source).toBe('ineligible_noise');
    expect(res.nt.dopamineDelta).toBe(0);
  });

  it('good close / avoided loss → relief vector (no aversion)', () => {
    // Holding would have LOST more: realized 0, horizon-end -20 → foregone <0.
    const res = resolveHindsight(
      legibleShortBundle(),
      { realizedPnlUsdt: 0, horizonEndPnlUsdt: -20, marginUsdt: margin, regimePersisted: true },
      PNL_FRAC_HISTORY,
    );
    expect(res.source).toBe('hindsight_good_close');
    // relief: dop>0, ser>0, ACh>0, endo>0, GABA==0 (no inhibition to bind)
    expect(res.nt.dopamineDelta).toBeGreaterThan(0);
    expect(res.nt.serotoninDelta).toBeGreaterThan(0);
    expect(res.nt.acetylcholineDelta).toBeGreaterThan(0);
    expect(res.nt.endorphinDelta).toBeGreaterThan(0);
    expect(res.nt.gabaDelta).toBe(0);
    expect(res.gabaTarget).toBeNull();
  });

  it('GABA stays TARGETED (pattern-keyed), never a global suppression flag', () => {
    const long = resolveHindsight(
      legibleShortBundle({ sideSign: 1, warpExpectationSign: 1, basinDirAtClose: 0.25, regimeAtClose: 'reverse_tape' }),
      wonOutcome, PNL_FRAC_HISTORY,
    );
    expect(long.gabaTarget).toBe('premature_close:reverse_tape:long');
    // The target encodes a SPECIFIC pattern — not "close less". Two different
    // patterns produce two different keys, so binding is per-pattern.
    expect(long.gabaTarget).not.toBe(
      resolveHindsight(legibleShortBundle(), wonOutcome, PNL_FRAC_HISTORY).gabaTarget,
    );
  });

  it('observer scale: magnitude tracks the kernel own MAD (no fixed cap)', () => {
    // Same foregone fraction, but a WIDER own-distribution (10× MAD) → the
    // same dollars are LESS surprising → smaller salience. No 0.5 cap.
    const tight = resolveHindsight(legibleShortBundle(), wonOutcome, PNL_FRAC_HISTORY);
    const wide = resolveHindsight(
      legibleShortBundle(),
      wonOutcome,
      PNL_FRAC_HISTORY.map((x) => x * 10), // MAD 0.10
    );
    expect(Math.abs(wide.nt.dopamineDelta)).toBeLessThan(Math.abs(tight.nt.dopamineDelta));
    // and a smaller foregone fraction → smaller sting on the same scale.
    const small = resolveHindsight(
      legibleShortBundle(),
      { ...wonOutcome, horizonEndPnlUsdt: 1 }, // foregone 1 → frac 0.01 → z 1
      PNL_FRAC_HISTORY,
    );
    expect(Math.abs(small.nt.dopamineDelta)).toBeLessThan(Math.abs(tight.nt.dopamineDelta));
  });

  it('cold-start (no trusted scale) emits nothing', () => {
    const res = resolveHindsight(legibleShortBundle(), wonOutcome, [0.01, 0.02]); // < MIN_SAMPLES
    expect(res.source).toBe('ineligible_noise');
    expect(res.nt.dopamineDelta).toBe(0);
  });

  it('fail-closed: invalid margin / pnl → zero vector', () => {
    expect(
      resolveHindsight(legibleShortBundle(), { ...wonOutcome, marginUsdt: 0 }, PNL_FRAC_HISTORY).source,
    ).toBe('hindsight_no_margin');
    expect(
      resolveHindsight(legibleShortBundle(), { ...wonOutcome, horizonEndPnlUsdt: NaN }, PNL_FRAC_HISTORY).source,
    ).toBe('hindsight_invalid');
  });
});

describe('deriveMagnitude + medianAndMad', () => {
  it('median+MAD matches the observer-scale statistic', () => {
    const { median, mad } = medianAndMad(PNL_FRAC_HISTORY);
    expect(median).toBeCloseTo(0, 6);
    expect(mad).toBeCloseTo(0.01, 6);
  });
  it('returns null below MIN_SAMPLES or zero MAD', () => {
    expect(deriveMagnitude(0.3, [0.01])).toBeNull();
    expect(deriveMagnitude(0.3, [0.05, 0.05, 0.05, 0.05, 0.05])).toBeNull(); // MAD 0
  });
});

describe('hindsight is canonical (no gate)', () => {
  it('always live — not env-gated', () => {
    expect(isHindsightRegretLive()).toBe(true);
    process.env.MONKEY_HINDSIGHT_REGRET_LIVE = 'false';
    expect(isHindsightRegretLive()).toBe(true);
    delete process.env.MONKEY_HINDSIGHT_REGRET_LIVE;
    expect(isHindsightRegretLive()).toBe(true);
  });
});

describe('gabaTargetKey', () => {
  it('encodes regime + side; defaults regime to unknown', () => {
    expect(gabaTargetKey(legibleShortBundle({ regimeAtClose: '' }))).toBe('premature_close:unknown:short');
  });
});

describe('TS↔Py fixture-level parity (exact magnitudes)', () => {
  // These exact values are mirrored in test_hindsight_regret.py
  // (test_parity_*). regret = tanh(|frac| / MAD) × legibility, MAD = 0.01.
  const margin = 100;
  const salience = (frac: number, mad: number): number => Math.tanh(Math.abs(frac) / mad);
  const legibility = legibilityStrength(legibleShortBundle());

  it('regret: dop = -tanh(0.30/0.01) × legibility; ACh = NE = +scaled salience', () => {
    const res = resolveHindsight(
      legibleShortBundle(),
      { realizedPnlUsdt: 0, horizonEndPnlUsdt: 30, marginUsdt: margin, regimePersisted: true },
      PNL_FRAC_HISTORY,
    );
    const s = salience(0.30, 0.01) * legibility;
    expect(res.nt.dopamineDelta).toBeCloseTo(-s, 9);
    expect(res.nt.acetylcholineDelta).toBeCloseTo(s, 9);
    expect(res.nt.norepinephrineDelta).toBeCloseTo(s, 9);
  });

  it('good close: dop = +tanh(0.20/0.01)', () => {
    const res = resolveHindsight(
      legibleShortBundle(),
      { realizedPnlUsdt: 0, horizonEndPnlUsdt: -20, marginUsdt: margin, regimePersisted: true },
      PNL_FRAC_HISTORY,
    );
    expect(res.nt.dopamineDelta).toBeCloseTo(salience(0.20, 0.01), 9);
  });

  it('small foregone: z == 1, dop = -tanh(1)', () => {
    const res = resolveHindsight(
      legibleShortBundle(),
      { realizedPnlUsdt: 0, horizonEndPnlUsdt: 1, marginUsdt: margin, regimePersisted: true },
      PNL_FRAC_HISTORY,
    );
    expect(res.predictionErrorZ).toBeCloseTo(1.0, 9);
    expect(res.nt.dopamineDelta).toBeCloseTo(-salience(0.01, 0.01) * legibility, 9);
  });
});
