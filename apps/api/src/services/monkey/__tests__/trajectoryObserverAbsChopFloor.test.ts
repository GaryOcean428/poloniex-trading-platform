import { describe, it, expect, beforeEach } from 'vitest';
import {
  observeAndClassifyFromHistory,
  _resetTrajectoryObserver,
} from '../trajectory_observer.js';
import { BASIN_DIM, type Basin } from '../basin.js';

/**
 * Synthesize a basin that produces a small basinDirection magnitude
 * (near-uniform distribution → near-zero direction value).
 */
function makeQuietBasin(): Basin {
  // Near-uniform distribution; small per-tick perturbation in momentum band.
  const b = new Float64Array(BASIN_DIM);
  for (let i = 0; i < BASIN_DIM; i++) {
    b[i] = 1 / BASIN_DIM + (Math.random() - 0.5) * 0.001;
  }
  return b;
}

describe('trajectory_observer ABS_CHOP_FLOOR (scale-blindness fix)', () => {
  beforeEach(() => _resetTrajectoryObserver());

  it('classifies persistent quiet basins as CHOP (the scale-blind pathology fix)', () => {
    // 50 ticks of near-uniform basins → basinDir magnitudes tiny.
    // Pre-fix: rolling tercile of tiny values would put recentAbs above
    // lower tercile and classify as TREND.
    // Post-fix: ABS_CHOP_FLOOR=0.10 catches recentAbs < 0.10 as CHOP.
    const history: Basin[] = [];
    for (let i = 0; i < 50; i++) {
      history.push(makeQuietBasin());
    }
    const r = observeAndClassifyFromHistory('TEST_QUIET', history);
    // Expect CHOP — quiet basins should always trip the absolute floor.
    expect(r.regime).toBe('CHOP');
  });

  it('does not break for non-empty histories (returns a valid regime)', () => {
    // Sanity check: feeding ANY basin history returns one of the three
    // valid regime labels. This guards against the new branch crashing.
    const history: Basin[] = [];
    for (let i = 0; i < 50; i++) {
      const b = new Float64Array(BASIN_DIM);
      // Random-ish but valid simplex
      for (let j = 0; j < BASIN_DIM; j++) b[j] = (Math.random() * 0.5 + 0.5) / BASIN_DIM;
      history.push(b);
    }
    const r = observeAndClassifyFromHistory('TEST_RANDOM', history);
    expect(['CHOP', 'TREND_UP', 'TREND_DOWN']).toContain(r.regime);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
});
