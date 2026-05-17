/**
 * perceptionParity.test.ts — PERCEPTION-1 parity ring buffer tests.
 *
 * Validates the ring-buffer + tick-counter + L2-diff + argmax-
 * disagreement bookkeeping that backs /governance/perception-parity.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  _resetParity,
  recordParity,
  snapshot,
} from '../perception_parity.js';

describe('perception_parity', () => {
  beforeEach(() => {
    _resetParity();
  });

  it('records L2 distance + argmax disagreement per row', () => {
    recordParity({
      at_ms: 100,
      symbol: 'BTC_USDT_PERP',
      legacy: [0.5, 0.0, 0.5],       // argmax tied → argmax3 returns 0
      canonical: [0.998, 0.001, 0.001], // argmax 0
      regime: 'creator',
      observer_warm: true,
    });
    const s = snapshot();
    expect(s.sample_count).toBe(1);
    expect(s.argmax_disagreement_count).toBe(0);
    expect(s.l2_diff.mean).toBeGreaterThan(0);
  });

  it('detects argmax disagreement when legacy and canonical pick different dims', () => {
    // Legacy: ATR/trend/residual could put most mass at dim 0 (quantum)
    // Canonical with PRESERVER would put it at dim 1
    recordParity({
      at_ms: 100,
      symbol: 'BTC_USDT_PERP',
      legacy: [0.7, 0.0, 0.3],       // argmax 0
      canonical: [0.001, 0.998, 0.001], // argmax 1 (PRESERVER)
      regime: 'preserver',
      observer_warm: true,
    });
    const s = snapshot();
    expect(s.argmax_disagreement_count).toBe(1);
    expect(s.argmax_disagreement_ratio).toBeCloseTo(1.0);
  });

  it('tick_count_total is unbounded; sample_count caps at capacity', () => {
    // Push > capacity (1000). We push 1050 to confirm cap.
    for (let i = 0; i < 1050; i++) {
      recordParity({
        at_ms: i,
        symbol: 'BTC_USDT_PERP',
        legacy: [0.4, 0.0, 0.6],
        canonical: [0.998, 0.001, 0.001],
        regime: 'creator',
        observer_warm: true,
      });
    }
    const s = snapshot();
    expect(s.tick_count_total).toBe(1050);
    expect(s.sample_count).toBe(1000);
    expect(s.capacity).toBe(1000);
  });

  it('regime_distribution counts each canonical label', () => {
    recordParity({
      at_ms: 1, symbol: 'A',
      legacy: [0.4, 0, 0.6], canonical: [0.998, 0.001, 0.001],
      regime: 'creator', observer_warm: true,
    });
    recordParity({
      at_ms: 2, symbol: 'A',
      legacy: [0.4, 0, 0.6], canonical: [0.001, 0.998, 0.001],
      regime: 'preserver', observer_warm: true,
    });
    recordParity({
      at_ms: 3, symbol: 'A',
      legacy: [0.4, 0, 0.6], canonical: [0.001, 0.001, 0.998],
      regime: 'dissolver', observer_warm: true,
    });
    recordParity({
      at_ms: 4, symbol: 'A',
      legacy: [0.4, 0, 0.6], canonical: [0.001, 0.001, 0.998],
      regime: 'dissolver', observer_warm: true,
    });
    const s = snapshot();
    expect(s.regime_distribution).toEqual({ creator: 1, preserver: 1, dissolver: 2 });
  });

  it('returns last <=200 rows for spot-checking', () => {
    for (let i = 0; i < 300; i++) {
      recordParity({
        at_ms: i, symbol: 'A',
        legacy: [0.4, 0, 0.6], canonical: [0.998, 0.001, 0.001],
        regime: 'creator', observer_warm: true,
      });
    }
    const s = snapshot();
    expect(s.rows.length).toBe(200);
    // last row should be the most recent one (at_ms=299)
    expect(s.rows[s.rows.length - 1]!.at_ms).toBe(299);
  });
});
