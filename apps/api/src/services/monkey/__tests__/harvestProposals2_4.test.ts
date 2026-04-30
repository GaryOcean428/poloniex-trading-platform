import { describe, it, expect } from 'vitest';
import { shouldProfitHarvest } from '../executive.js';
import { BASIN_DIM } from '../basin.js';

const NEUTRAL_NC = {
  acetylcholine: 0.5, dopamine: 0.5, serotonin: 0.5,
  norepinephrine: 0.5, gaba: 0.5, endorphins: 0.5,
};

function basinState(serotonin = 0.5, ne = 0.5, dopamine = 0.5, phi = 0.5) {
  const b = new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
  return {
    basin: b as unknown as Float64Array,
    identityBasin: b as unknown as Float64Array,
    phi,
    kappa: 64,
    basinVelocity: 0,
    regimeWeights: { equilibrium: 1, efficient: 0, quantum: 0 },
    sovereignty: 0.7,
    neurochemistry: { ...NEUTRAL_NC, serotonin, norepinephrine: ne, dopamine },
  } as any;
}

describe('shouldProfitHarvest — proposal #2 peak-tracking guard', () => {
  it('does not fire when peak below 1%', () => {
    const out = shouldProfitHarvest(
      0.5, 0.5, 100, -0.99, 'long', basinState(),
      10,  // streak high
    );
    expect(out.value).toBe(false);
  });

  it('does not fire when giveback < 30%', () => {
    // peak 2%, current 1.8% -> 10% giveback -> insufficient.
    const out = shouldProfitHarvest(
      1.8, 2.0, 100, -0.99, 'long', basinState(),
      10,
    );
    expect(out.value).toBe(false);
  });

  it('fires when peak >= 1% AND giveback > 30% AND streak >= 3', () => {
    // peak 1%, current 0.65% -> 35% giveback. serotonin=1.0 widens
    // trailing floor so trailing branch doesn't shadow.
    const out = shouldProfitHarvest(
      0.65, 1.0, 100, -0.99, 'long', basinState(1.0),
      10,
    );
    expect(out.value).toBe(true);
    expect(out.reason).toContain('trend_flip_harvest');
  });
});

describe('shouldProfitHarvest — proposal #4 sustained tape-flip', () => {
  it('does not fire at streak 0', () => {
    const out = shouldProfitHarvest(
      0.65, 1.0, 100, -0.99, 'long', basinState(1.0),
      0,
    );
    expect(out.value).toBe(false);
  });

  it('does not fire at streak 1', () => {
    const out = shouldProfitHarvest(
      0.65, 1.0, 100, -0.99, 'long', basinState(1.0),
      1,
    );
    expect(out.value).toBe(false);
  });

  it('does not fire at streak 2', () => {
    const out = shouldProfitHarvest(
      0.65, 1.0, 100, -0.99, 'long', basinState(1.0),
      2,
    );
    expect(out.value).toBe(false);
  });

  it('fires at streak 3', () => {
    const out = shouldProfitHarvest(
      0.65, 1.0, 100, -0.99, 'long', basinState(1.0),
      3,
    );
    expect(out.value).toBe(true);
  });

  it('configurable streak threshold', () => {
    const out = shouldProfitHarvest(
      0.65, 1.0, 100, -0.99, 'long', basinState(1.0),
      1,    // streak
      0.01, // peakGivebackMinPct
      0.30, // peakGivebackThreshold
      1,    // tapeFlipStreakRequired
    );
    expect(out.value).toBe(true);
  });
});

describe('shouldProfitHarvest — trailing branch unchanged', () => {
  it('trailing harvest fires irrespective of streak', () => {
    // Peak 2%, current 0.05% -> deep give-back. serotonin=0 -> tighter
    // floor.
    const out = shouldProfitHarvest(
      0.05, 2.0, 100, 0.5, 'long', basinState(0.0),
      0,
    );
    expect(out.value).toBe(true);
    expect(out.reason).toContain('trailing_harvest');
  });
});

describe('shouldProfitHarvest — short side parity', () => {
  it('short with bullish tape (alignment -0.99) and streak fires', () => {
    const out = shouldProfitHarvest(
      0.65, 1.0, 100, 0.99, 'short', basinState(1.0),
      10,
    );
    expect(out.value).toBe(true);
  });

  it('short with bearish tape does NOT fire trend_flip', () => {
    const out = shouldProfitHarvest(
      0.65, 1.0, 100, -0.99, 'short', basinState(1.0),
      10,
    );
    // alignmentNow = +0.99 > -0.25 → no trend flip. Trailing branch
    // also won't fire (current 0.65 > floor 0.50).
    expect(out.value).toBe(false);
  });
});

describe('shouldProfitHarvest — derivation surface', () => {
  it('derivation surfaces tapeFlipStreak when fired', () => {
    const out = shouldProfitHarvest(
      0.65, 1.0, 100, -0.99, 'long', basinState(1.0),
      4,
    );
    expect(out.value).toBe(true);
    expect((out.derivation as any).tapeFlipStreak).toBe(4);
    expect((out.derivation as any).peakGivebackFloor).toBeGreaterThan(0);
  });

  it('derivation surfaces tapeFlipStreak when no fire', () => {
    const out = shouldProfitHarvest(
      0.5, 0.5, 100, 0.0, 'long', basinState(),
      2,
    );
    expect((out.derivation as any).tapeFlipStreak).toBe(2);
  });
});
