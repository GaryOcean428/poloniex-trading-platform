/**
 * substrate_observer.test.ts — observer-derived lane decision period
 * (#1009 cascading-knob-strip 2026-05-29).
 *
 * Replaces the hardcoded `LANE_DECISION_PERIOD_MS` table with the
 * kernel's own observation of how often each lane's decision changes.
 *
 * # Pins
 *
 *   1. Fresh state → 0 (cold-start, no observed floor)
 *   2. Identical-tag back-to-back calls do NOT push samples
 *      (decision unchanged → no new sample)
 *   3. Different-tag calls push the inter-change interval into the
 *      rolling buffer
 *   4. Median (not mean) is returned — robust to one slow tick
 *   5. Per-lane isolation: scalp samples do not affect swing
 *   6. NaN inputs ignored
 *   7. Literal purity: only sample-count buffer size, no ms knobs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  recordLaneDecision,
  getObservedLaneDecisionPeriodMs,
  getSubstrateBreakdown,
  _resetSubstrateObserverState,
} from '../substrate_observer.js';

describe('substrate_observer — observer behavior', () => {
  beforeEach(() => _resetSubstrateObserverState());

  it('fresh state → 0 ms for every lane (cold-start)', () => {
    expect(getObservedLaneDecisionPeriodMs('scalp')).toBe(0);
    expect(getObservedLaneDecisionPeriodMs('swing')).toBe(0);
    expect(getObservedLaneDecisionPeriodMs('trend')).toBe(0);
  });

  it('identical tag back-to-back does NOT push a sample (decision unchanged)', () => {
    recordLaneDecision('scalp', 1000, 'long|hold');
    recordLaneDecision('scalp', 2000, 'long|hold'); // unchanged
    recordLaneDecision('scalp', 3000, 'long|hold'); // unchanged
    expect(getSubstrateBreakdown().scalpSamples).toBe(0);
    expect(getObservedLaneDecisionPeriodMs('scalp')).toBe(0);
  });

  it('different tag pushes the inter-change interval', () => {
    recordLaneDecision('scalp', 1000, 'long|hold');
    recordLaneDecision('scalp', 4000, 'long|enter'); // change after 3000ms
    expect(getSubstrateBreakdown().scalpSamples).toBe(1);
    expect(getObservedLaneDecisionPeriodMs('scalp')).toBe(3000);
  });

  it('returns median across multiple change intervals (robust to outlier)', () => {
    // 5 changes with intervals 1000, 2000, 3000, 4000, 20_000 (one outlier).
    // Median should be 3000 — outlier does NOT poison.
    recordLaneDecision('swing', 0, 'a');
    recordLaneDecision('swing', 1000, 'b');     // 1000
    recordLaneDecision('swing', 3000, 'c');     // 2000
    recordLaneDecision('swing', 6000, 'd');     // 3000
    recordLaneDecision('swing', 10_000, 'e');   // 4000
    recordLaneDecision('swing', 30_000, 'f');   // 20_000 outlier
    expect(getObservedLaneDecisionPeriodMs('swing')).toBe(3000);
  });

  it('per-lane isolation: scalp samples do not affect swing', () => {
    recordLaneDecision('scalp', 0, 'a');
    recordLaneDecision('scalp', 1000, 'b');
    expect(getObservedLaneDecisionPeriodMs('scalp')).toBe(1000);
    expect(getObservedLaneDecisionPeriodMs('swing')).toBe(0);
  });

  it('NaN tNowMs is ignored (no state pollution)', () => {
    recordLaneDecision('scalp', NaN, 'a');
    recordLaneDecision('scalp', 1000, 'b');
    recordLaneDecision('scalp', 4000, 'c'); // gap from last valid = 3000
    expect(getObservedLaneDecisionPeriodMs('scalp')).toBe(3000);
  });

  it('breakdown surfaces sample counts + current periods', () => {
    recordLaneDecision('scalp', 0, 'a');
    recordLaneDecision('scalp', 5000, 'b'); // 5000ms
    recordLaneDecision('trend', 0, 'a');
    recordLaneDecision('trend', 100_000, 'b'); // 100_000ms
    const b = getSubstrateBreakdown();
    expect(b.scalpSamples).toBe(1);
    expect(b.scalpPeriodMs).toBe(5000);
    expect(b.swingSamples).toBe(0);
    expect(b.swingPeriodMs).toBe(0);
    expect(b.trendSamples).toBe(1);
    expect(b.trendPeriodMs).toBe(100_000);
  });
});

describe('substrate_observer — literal purity', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, '..', 'substrate_observer.ts');

  it('no unexpected numeric literals in substrate_observer.ts', () => {
    const src = readFileSync(SRC, 'utf8');
    const stripped = src
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/'[^']*'/g, "''")
      .replace(/"[^"]*"/g, '""');

    const literalRegex = /(?<![\w.])(\d+(?:\.\d+)?)/g;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = literalRegex.exec(stripped)) !== null) {
      found.push(m[1]);
    }

    // Allowed: 0 (clamp / cold-start return), 1 (`length - 1` and `2 % 2`),
    // 2 (median midpoint divisor), 50 (INTERVAL_RING_CAPACITY sample
    // count — not a physical ms quantity).
    const allowed = new Set(['0', '1', '2', '50']);
    const offenders = found.filter((v) => !allowed.has(v));
    expect(offenders, `unexpected numeric literals in substrate_observer.ts: ${offenders.join(', ')}`).toEqual([]);
  });
});
