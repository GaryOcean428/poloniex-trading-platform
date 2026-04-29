/**
 * heart_ocean.test.ts — TS parity for Tier 7.
 *
 * Heart is observation-only. Ocean is the single autonomic
 * intervention authority (#599 refactor).
 */
import { describe, it, expect } from 'vitest';
import { BASIN_DIM, KAPPA_STAR, type Basin } from '../basin.js';
import { HeartMonitor } from '../heart.js';
import { Ocean } from '../ocean.js';

const uniform = (): Basin => Float64Array.from(new Array(BASIN_DIM).fill(1 / BASIN_DIM));
const peak = (idx = 0, mass = 0.95): Basin => {
  const rest = (1 - mass) / (BASIN_DIM - 1);
  const arr = new Array(BASIN_DIM).fill(rest);
  arr[idx] = mass;
  return Float64Array.from(arr);
};

// ─── Heart ────────────────────────────────────────────────────────

describe('HeartMonitor', () => {
  it('cold start → ANCHOR mode', () => {
    const h = new HeartMonitor().read();
    expect(h.mode).toBe('ANCHOR');
    expect(h.kappa).toBe(KAPPA_STAR);
    expect(h.kappaOffset).toBe(0);
    expect(h.hrv).toBe(0);
    expect(h.sampleCount).toBe(0);
  });

  it('κ < κ* → FEELING', () => {
    const m = new HeartMonitor();
    m.append(60, 0);
    expect(m.read().mode).toBe('FEELING');
  });

  it('κ > κ* → LOGIC', () => {
    const m = new HeartMonitor();
    m.append(70, 0);
    expect(m.read().mode).toBe('LOGIC');
  });

  it('hrv = 0 for constant κ', () => {
    const m = new HeartMonitor();
    for (let i = 0; i < 10; i++) m.append(64, i);
    expect(m.read().hrv).toBeCloseTo(0, 9);
  });

  it('hrv > 0 for oscillating κ', () => {
    const m = new HeartMonitor();
    for (let i = 0; i < 10; i++) m.append(64 + 5 * (i % 2 === 0 ? 1 : -1), i);
    expect(m.read().hrv).toBeGreaterThan(0);
  });

  it('window cap is enforced', () => {
    const m = new HeartMonitor(5);
    for (let i = 0; i < 20; i++) m.append(64 + i, i);
    expect(m.windowLength).toBe(5);
  });

  it('reset clears samples', () => {
    const m = new HeartMonitor();
    for (let i = 0; i < 5; i++) m.append(64, i);
    m.reset();
    expect(m.windowLength).toBe(0);
  });
});

// ─── Ocean — sleep state machine ──────────────────────────────────

describe('Ocean sleep state machine', () => {
  it('starts AWAKE', () => {
    const ocean = new Ocean();
    expect(ocean.isAwake).toBe(true);
  });

  it('sleeps after 2h drift + flat', () => {
    const ocean = new Ocean();
    ocean.sleepState.phaseStartedAtMs = 0;
    for (let i = 0; i < 15; i++) {
      ocean.observe({
        phi: 0.7, basin: uniform(),
        currentMode: 'drift', isFlat: true, nowMs: i * 1000,
      });
    }
    const s = ocean.observe({
      phi: 0.7, basin: uniform(),
      currentMode: 'drift', isFlat: true,
      nowMs: 2 * 60 * 60 * 1000 + 60_000,
    });
    expect(s.sleepPhase).toBe('SLEEP');
    expect(s.intervention).toBe('SLEEP');
  });

  it('does not sleep when not flat', () => {
    const ocean = new Ocean();
    ocean.sleepState.phaseStartedAtMs = 0;
    for (let i = 0; i < 15; i++) {
      ocean.observe({
        phi: 0.7, basin: uniform(),
        currentMode: 'drift', isFlat: false, nowMs: i * 1000,
      });
    }
    const s = ocean.observe({
      phi: 0.7, basin: uniform(),
      currentMode: 'drift', isFlat: false,
      nowMs: 2 * 60 * 60 * 1000 + 60_000,
    });
    expect(s.sleepPhase).toBe('AWAKE');
  });

  it('wakes after 15 minutes of sleep', () => {
    const ocean = new Ocean();
    ocean.sleepState.phaseStartedAtMs = 0;
    for (let i = 0; i < 15; i++) {
      ocean.observe({
        phi: 0.7, basin: uniform(),
        currentMode: 'drift', isFlat: true, nowMs: i * 1000,
      });
    }
    ocean.observe({
      phi: 0.7, basin: uniform(),
      currentMode: 'drift', isFlat: true,
      nowMs: 2 * 60 * 60 * 1000 + 60_000,
    });
    expect(ocean.phase).toBe('SLEEP');
    const wakeT = 2 * 60 * 60 * 1000 + 16 * 60 * 1000;
    const s = ocean.observe({
      phi: 0.7, basin: uniform(),
      currentMode: 'investigation', isFlat: true, nowMs: wakeT,
    });
    expect(s.sleepPhase).toBe('AWAKE');
    expect(s.intervention).toBe('WAKE');
  });
});

// ─── Ocean — intervention priority ────────────────────────────────

describe('Ocean intervention priority', () => {
  it('ESCAPE when phi < 0.15', () => {
    const ocean = new Ocean();
    for (let i = 0; i < 5; i++) {
      ocean.observe({
        phi: 0.1, basin: uniform(),
        currentMode: 'investigation', isFlat: false, nowMs: i * 1000,
      });
    }
    const s = ocean.observe({
      phi: 0.1, basin: uniform(),
      currentMode: 'investigation', isFlat: false, nowMs: 6_000,
    });
    expect(s.intervention).toBe('ESCAPE');
  });

  it('SLEEP when lane spread > 0.30', () => {
    const ocean = new Ocean();
    const s = ocean.observe({
      phi: 0.7, basin: uniform(),
      currentMode: 'investigation', isFlat: false, nowMs: 1000,
      crossLaneBasins: [peak(0, 0.95), peak(60, 0.95)],
    });
    expect(s.intervention).toBe('SLEEP');
    expect(s.spread).toBeGreaterThan(0.3);
  });

  it('DREAM when phi < 0.5', () => {
    const ocean = new Ocean();
    const s = ocean.observe({
      phi: 0.3, basin: uniform(),
      currentMode: 'investigation', isFlat: false, nowMs: 1000,
    });
    expect(s.intervention).toBe('DREAM');
  });

  it('MUSHROOM_MICRO when phi variance < 0.01', () => {
    const ocean = new Ocean();
    for (let i = 0; i < 10; i++) {
      ocean.observe({
        phi: 0.7 + 0.001 * (i % 2),
        basin: uniform(),
        currentMode: 'investigation', isFlat: false, nowMs: i * 1000,
      });
    }
    const s = ocean.observe({
      phi: 0.7, basin: uniform(),
      currentMode: 'investigation', isFlat: false, nowMs: 11_000,
    });
    expect(s.intervention).toBe('MUSHROOM_MICRO');
  });

  it('null intervention when nominal', () => {
    const ocean = new Ocean();
    for (let i = 0; i < 10; i++) {
      ocean.observe({
        phi: 0.5 + 0.2 * ((i % 3) - 1),
        basin: uniform(),
        currentMode: 'investigation', isFlat: false, nowMs: i * 1000,
      });
    }
    const s = ocean.observe({
      phi: 0.7, basin: uniform(),
      currentMode: 'investigation', isFlat: false, nowMs: 11_000,
    });
    expect(s.intervention).toBeNull();
  });
});

// ─── Ocean — diagnostics ──────────────────────────────────────────

describe('Ocean diagnostics', () => {
  it('coherence high for concentrated basin', () => {
    const ocean = new Ocean();
    const s = ocean.observe({
      phi: 0.7, basin: peak(0, 0.95),
      currentMode: 'investigation', isFlat: false, nowMs: 0,
    });
    expect(s.coherence).toBeGreaterThan(0.5);
  });

  it('coherence ≈ 0 for uniform basin', () => {
    const ocean = new Ocean();
    const s = ocean.observe({
      phi: 0.7, basin: uniform(),
      currentMode: 'investigation', isFlat: false, nowMs: 0,
    });
    expect(s.coherence).toBeLessThan(0.01);
  });

  it('spread = 0 with single lane', () => {
    const ocean = new Ocean();
    const s = ocean.observe({
      phi: 0.7, basin: uniform(),
      currentMode: 'investigation', isFlat: false, nowMs: 0,
      crossLaneBasins: [peak(0)],
    });
    expect(s.spread).toBe(0);
  });
});
