/**
 * turning_signal.test.ts — #575 short-as-turning-signal trigger tests.
 *
 * The trigger fires when:
 *   - sideCandidate is 'long' (no work to do if already short)
 *   - sideOverride is false (don't compound on OVERRIDE_REVERSE)
 *   - mlSignal === 'BUY' (ml-worker's only positive emission)
 *   - mlStrength < 0.15 (no-confidence read)
 *   - basinDir < -0.15 (Monkey's geometric direction leans bearish)
 *   - tapeTrend < -0.30 (recent price action confirms)
 *
 * All six conditions must hold. Tests cover each clause in isolation
 * plus regression cases (don't double-fire on top of override, don't
 * fire on HOLD signal, don't fire when ML conviction is real).
 */
import { describe, it, expect } from 'vitest';
import { evaluateTurningSignal, shortsLive } from '../turning_signal.js';

const baseInput = {
  sideCandidate: 'long' as 'long' | 'short',
  sideOverride: false,
  mlSignal: 'BUY' as string,
  mlStrength: 0.05,
  basinDir: -0.30,
  tapeTrend: -0.50,
};

describe('evaluateTurningSignal — fires when all six conditions hold', () => {
  it('canonical positive case: low BUY strength + bearish basin + bearish tape', () => {
    expect(evaluateTurningSignal(baseInput)).toBe(true);
  });

  it('boundary: mlStrength just below threshold fires', () => {
    expect(evaluateTurningSignal({ ...baseInput, mlStrength: 0.149 })).toBe(true);
  });

  it('boundary: basinDir just below threshold fires', () => {
    expect(evaluateTurningSignal({ ...baseInput, basinDir: -0.151 })).toBe(true);
  });

  it('boundary: tapeTrend just below threshold fires', () => {
    expect(evaluateTurningSignal({ ...baseInput, tapeTrend: -0.301 })).toBe(true);
  });
});

describe('evaluateTurningSignal — refuses when any condition unmet', () => {
  it('refuses if sideCandidate is already short', () => {
    expect(evaluateTurningSignal({ ...baseInput, sideCandidate: 'short' })).toBe(false);
  });

  it('refuses if OVERRIDE_REVERSE already fired', () => {
    expect(evaluateTurningSignal({ ...baseInput, sideOverride: true })).toBe(false);
  });

  it('refuses on HOLD signal', () => {
    expect(evaluateTurningSignal({ ...baseInput, mlSignal: 'HOLD' })).toBe(false);
  });

  it('refuses on SELL signal (ml-worker never emits, but defense)', () => {
    expect(evaluateTurningSignal({ ...baseInput, mlSignal: 'SELL' })).toBe(false);
  });

  it('refuses when ML conviction is real (strength >= threshold)', () => {
    expect(evaluateTurningSignal({ ...baseInput, mlStrength: 0.15 })).toBe(false);
    expect(evaluateTurningSignal({ ...baseInput, mlStrength: 0.20 })).toBe(false);
    expect(evaluateTurningSignal({ ...baseInput, mlStrength: 0.50 })).toBe(false);
  });

  it('refuses when basin is not bearish (basinDir >= -0.15)', () => {
    expect(evaluateTurningSignal({ ...baseInput, basinDir: -0.10 })).toBe(false);
    expect(evaluateTurningSignal({ ...baseInput, basinDir: 0.0 })).toBe(false);
    expect(evaluateTurningSignal({ ...baseInput, basinDir: 0.5 })).toBe(false);
  });

  it('refuses when tape is not bearish enough (tapeTrend >= -0.30)', () => {
    expect(evaluateTurningSignal({ ...baseInput, tapeTrend: -0.29 })).toBe(false);
    expect(evaluateTurningSignal({ ...baseInput, tapeTrend: 0.0 })).toBe(false);
    expect(evaluateTurningSignal({ ...baseInput, tapeTrend: 0.4 })).toBe(false);
  });

  it('refuses when only basin OR tape is bearish, not both', () => {
    // Bearish basin, neutral tape
    expect(evaluateTurningSignal({ ...baseInput, tapeTrend: 0.0 })).toBe(false);
    // Neutral basin, bearish tape
    expect(evaluateTurningSignal({ ...baseInput, basinDir: 0.0 })).toBe(false);
  });
});

describe('shortsLive — env flag gate', () => {
  it('returns false when MONKEY_SHORTS_LIVE is unset', () => {
    delete process.env.MONKEY_SHORTS_LIVE;
    expect(shortsLive()).toBe(false);
  });

  it('returns false when MONKEY_SHORTS_LIVE is "false"', () => {
    process.env.MONKEY_SHORTS_LIVE = 'false';
    expect(shortsLive()).toBe(false);
    delete process.env.MONKEY_SHORTS_LIVE;
  });

  it('returns true when MONKEY_SHORTS_LIVE is "true"', () => {
    process.env.MONKEY_SHORTS_LIVE = 'true';
    expect(shortsLive()).toBe(true);
    delete process.env.MONKEY_SHORTS_LIVE;
  });

  it('returns false on any other value (e.g. "1", "yes", "TRUE")', () => {
    process.env.MONKEY_SHORTS_LIVE = '1';
    expect(shortsLive()).toBe(false);
    process.env.MONKEY_SHORTS_LIVE = 'TRUE';
    expect(shortsLive()).toBe(false);
    delete process.env.MONKEY_SHORTS_LIVE;
  });
});
