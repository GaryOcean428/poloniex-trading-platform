/**
 * Tests for the absolute-USD trailing-harvest gate added to
 * shouldProfitHarvest (2026-05-19, operator-observed).
 *
 * Failure pattern this fixes: peak tracking is per-(symbol, lane) per
 * kernel instance. A single user-facing position split across
 * monkey-position + monkey-swing (and K + T agents) becomes a set of
 * subsets, each with its own peak. A $5+ user-visible profit fragments
 * into ~$1-$2 per subset — below the % activation threshold (0.2-0.4%
 * of subset notional) on wider lanes (trend at 40% TP). No subset
 * arms the trailing harvest, market reverses, turtle_stop fires for a
 * loss, and the operator watches the peak round-trip to red.
 *
 * The fix adds a parallel absolute-USD gate (MONKEY_HARVEST_ABS_PEAK_USD,
 * default $3): when peak ≥ $3 AND current has given back past
 * peak × (1 - giveback), harvest — independent of % activation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shouldProfitHarvest } from '../services/monkey/executive.js';
import type { BasinState } from '../services/monkey/executive.js';

const baselineBasin: BasinState = {
  phi: 0.5,
  sovereignty: 1.0,
  basinVelocity: 0.05,
  neurochemistry: {
    acetylcholine: 0.5,
    dopamine: 0.5,
    serotonin: 0.5,
    norepinephrine: 0.5,
    gaba: 0.5,
    endorphins: 0.5,
  },
} as unknown as BasinState;

describe('shouldProfitHarvest — absolute-USD trailing gate', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.MONKEY_HARVEST_ABS_PEAK_USD;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('fires at default $3 threshold when peak hit $5 and gave back to $2', () => {
    // Reproduces the 2026-05-19 incident shape: notional is large
    // enough that peak $5 is BELOW the % activation floor
    // (0.2% × notional), so the existing % trailing-harvest path
    // can't arm. The new abs-USD gate fires instead.
    //   - notional $5000 → % activation = 0.2-0.4% = $10-$20
    //   - peak $5 < $10 → % path bypassed
    //   - peak $5 ≥ $3 abs threshold → abs gate arms
    //   - current $2 < $5 × (1 - 0.4) = $3 floor → harvest fires
    const result = shouldProfitHarvest(
      /* unrealizedPnlUsdt */ 2.0,
      /* peakPnlUsdt */       5.0,
      /* notionalUsdt */      5000,
      /* tapeTrend */         0.0,
      /* heldSide */          'short',
      baselineBasin,
    );
    expect(result.value).toBe(true);
    expect(result.reason).toContain('abs_usd_harvest');
  });

  it('2026-05-25 strip — abs-USD threshold removed; fires on any positive give-back', () => {
    // Pre-strip: $3 default gated below-threshold peaks from arming.
    // Post-strip: threshold is 0, so ANY peak with give-back > floor
    // arms abs-USD harvest. Previously-quiet $2.50 peak now fires.
    const result = shouldProfitHarvest(
      /* unrealizedPnlUsdt */ 0.5,
      /* peakPnlUsdt */       2.5,
      /* notionalUsdt */      5000,
      /* tapeTrend */         0.0,
      /* heldSide */          'short',
      baselineBasin,
    );
    expect(result.value).toBe(true);
    expect(result.reason).toContain('abs_usd_harvest');
  });

  it('does NOT fire when still at peak (no giveback yet)', () => {
    const result = shouldProfitHarvest(
      /* unrealizedPnlUsdt */ 5.0,
      /* peakPnlUsdt */       5.0,  // current == peak, no giveback
      /* notionalUsdt */      800,
      /* tapeTrend */         0.0,
      /* heldSide */          'short',
      baselineBasin,
    );
    expect(result.value).toBe(false);
  });

  it('does NOT fire when current goes to zero/negative (SL handles losses)', () => {
    const result = shouldProfitHarvest(
      /* unrealizedPnlUsdt */ -1.0,
      /* peakPnlUsdt */       5.0,
      /* notionalUsdt */      800,
      /* tapeTrend */         0.0,
      /* heldSide */          'short',
      baselineBasin,
    );
    // currentFrac > 0 guard: harvest is for "lock in some profit",
    // not "cut a loss" — SL gate owns the loss path.
    expect(result.value).toBe(false);
  });

  it('2026-05-25 strip — env override no longer honoured (var stripped)', () => {
    process.env.MONKEY_HARVEST_ABS_PEAK_USD = '10';
    const result = shouldProfitHarvest(
      /* unrealizedPnlUsdt */ 2.0,
      /* peakPnlUsdt */       5.0,
      /* notionalUsdt */      5000,
      /* tapeTrend */         0.0,
      /* heldSide */          'short',
      baselineBasin,
    );
    // Env var read removed: $5 peak with give-back fires regardless of
    // any stale env value.
    expect(result.value).toBe(true);
    expect(result.reason).toContain('abs_usd_harvest');
  });

  it('fires at lower threshold when env tightens it', () => {
    process.env.MONKEY_HARVEST_ABS_PEAK_USD = '1.5';
    const result = shouldProfitHarvest(
      /* unrealizedPnlUsdt */ 0.5,
      /* peakPnlUsdt */       2.0,    // ≥ $1.5 override
      /* notionalUsdt */      5000,  // large → keep % path quiet
      /* tapeTrend */         0.0,
      /* heldSide */          'short',
      baselineBasin,
    );
    expect(result.value).toBe(true);
    expect(result.reason).toContain('abs_usd_harvest');
  });
});
