/**
 * safety_floor.test.ts — observer behaviour + literal-purity guards (#1009).
 *
 * Two sign-off criteria from the #1009 design comments live here:
 *
 *   1. **No numeric literals in `safety_floor.ts` beyond clamp.** The
 *      literal-purity test reads the source and asserts that the only
 *      numeric-literal lines are:
 *        - `Math.max(0, ...)` clamp-to-zero
 *        - The cold-start fallback (allowlisted, named, single use)
 *        - Ring sample-count parameters (configured *counts*, not
 *          physical quantities)
 *
 *   2. **t=0 falsification** — see `cooldown_composer.test.ts`. The
 *      safety floor must collapse to 0 when all three observers report
 *      zero and the cold-start fallback isn't active.
 *
 * Citations: poloniex-trading-platform#1009 + 2.31A P5/P25 + QIG PURITY
 * MANDATE + LIVED ONLY 5.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  recordCloseAck,
  recordFlatObserved,
  record21002Incident,
  getCurrentSafetyFloorMs,
  getSafetyFloorBreakdown,
  COLD_START_FALLBACK_MS,
  _resetSafetyFloorState,
} from '../safety_floor.js';

describe('safety_floor — observer behaviour', () => {
  beforeEach(() => _resetSafetyFloorState());

  it('cold start: returns the fallback when settlement ring is empty', () => {
    const floor = getCurrentSafetyFloorMs('BTC_USDT_PERP');
    expect(floor).toBe(COLD_START_FALLBACK_MS);
    expect(getSafetyFloorBreakdown('BTC_USDT_PERP').coldStartActive).toBe(true);
  });

  it('settlement observer warms up after enough samples', () => {
    const sym = 'BTC_USDT_PERP';
    // Push 60 settlement deltas around 200ms.
    for (let i = 0; i < 60; i++) {
      recordCloseAck(sym, 1000 + i * 1000);
      recordFlatObserved(sym, 1000 + i * 1000 + 200);
    }
    const b = getSafetyFloorBreakdown(sym);
    expect(b.coldStartActive).toBe(false);
    expect(b.settlementSamples).toBe(60);
    expect(b.settlementP99Ms).toBe(200);
  });

  it('settlement p99 follows the actual distribution, not a constant', () => {
    const sym = 'BTC_USDT_PERP';
    // Nearest-rank p99 with n=100 is the 99th-sorted sample (1-indexed).
    // 99 samples at 100ms + 1 outlier at 800ms: p99 stays at 100ms (a
    // single outlier should NOT swing the safety floor — incident_max
    // covers worst-case directly).
    for (let i = 0; i < 99; i++) {
      recordCloseAck(sym, i * 1000);
      recordFlatObserved(sym, i * 1000 + 100);
    }
    recordCloseAck(sym, 99 * 1000);
    recordFlatObserved(sym, 99 * 1000 + 800);
    expect(getSafetyFloorBreakdown(sym).settlementP99Ms).toBe(100);

    // With multiple outliers in the top 1%, p99 should climb to the
    // outlier value. Push two more 800ms samples (now 3-of-102 outliers).
    recordCloseAck(sym, 100 * 1000);
    recordFlatObserved(sym, 100 * 1000 + 800);
    recordCloseAck(sym, 101 * 1000);
    recordFlatObserved(sym, 101 * 1000 + 800);
    expect(getSafetyFloorBreakdown(sym).settlementP99Ms).toBe(800);
  });

  it('21002 incident raises the floor — no operator multiplier', () => {
    const sym = 'BTC_USDT_PERP';
    // Warm up settlement to 50ms p99.
    for (let i = 0; i < 60; i++) {
      recordCloseAck(sym, i * 1000);
      recordFlatObserved(sym, i * 1000 + 50);
    }
    expect(getCurrentSafetyFloorMs(sym)).toBe(50);
    // One 21002 incident at 1200ms after close.
    record21002Incident(sym, 100_000, 101_200);
    expect(getCurrentSafetyFloorMs(sym)).toBe(1200);
  });

  it('non-finite / negative timestamps are ignored (no NaN poisoning)', () => {
    const sym = 'BTC_USDT_PERP';
    recordCloseAck(sym, Number.NaN);
    recordFlatObserved(sym, 100);
    expect(getSafetyFloorBreakdown(sym).settlementSamples).toBe(0);
    record21002Incident(sym, 100, 50); // delta would be -50
    expect(getSafetyFloorBreakdown(sym).incidentSamples).toBe(0);
  });

  it('per-symbol isolation: BTC observations do not pollute ETH', () => {
    const btc = 'BTC_USDT_PERP';
    const eth = 'ETH_USDT_PERP';
    for (let i = 0; i < 60; i++) {
      recordCloseAck(btc, i * 1000);
      recordFlatObserved(btc, i * 1000 + 100);
    }
    expect(getCurrentSafetyFloorMs(btc)).toBe(100);
    // ETH still cold-start, unaffected.
    expect(getCurrentSafetyFloorMs(eth)).toBe(COLD_START_FALLBACK_MS);
  });
});

// ─── #1009 sign-off criterion 1: literal-purity grep ────────────────────

describe('safety_floor — literal-purity guard (#1009 sign-off criterion 1)', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, '..', 'safety_floor.ts');

  /**
   * The only allowed numeric literals in `safety_floor.ts` are:
   *   - 0 (clamp-to-zero)
   *   - 1 (Math.min(this.filled + 1, this.capacity) cursor wrap)
   *   - 99, 100 (rank computation for p99 — the ratio itself, not a floor)
   *   - 2 (rate-limit token threshold — read from rateLimiter, not a floor)
   *   - SETTLEMENT_RING_CAPACITY = 200 (sample count, not a physical
   *     quantity)
   *   - INCIDENT_RING_CAPACITY = 50 (sample count, not a physical
   *     quantity)
   *   - MIN_RING_SAMPLES = 50 (sample count threshold)
   *   - COLD_START_FALLBACK_MS = 500 (the one sentinel — used during
   *     warmup, replaced by Observer 1 once samples accumulate)
   *
   * Any other numeric literal would be a knob hidden behind a doctrine
   * comment — the specific anti-pattern #1009 forbids.
   */
  it('no unexpected numeric literals in safety_floor.ts source', () => {
    const src = readFileSync(SRC, 'utf8');
    // Strip comments + strings to isolate code-level literals.
    const stripped = src
      // line comments
      .replace(/\/\/[^\n]*/g, '')
      // block comments (non-greedy)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // single/double-quoted strings
      .replace(/'[^']*'/g, "''")
      .replace(/"[^"]*"/g, '""');

    const literalRegex = /(?<![\w.])(\d+(?:\.\d+)?)/g;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = literalRegex.exec(stripped)) !== null) {
      found.push(m[1]);
    }

    const allowed = new Set([
      '0',
      '1',
      '2',
      '50',
      '99',
      '100',
      '200',
      '500',
    ]);
    const offenders = found.filter((v) => !allowed.has(v));
    expect(offenders, `unexpected numeric literals in safety_floor.ts: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the COLD_START_FALLBACK_MS sentinel is named, single-line, exported', () => {
    const src = readFileSync(SRC, 'utf8');
    const matches = src.match(/^export const COLD_START_FALLBACK_MS = \d+;/m);
    expect(matches, 'COLD_START_FALLBACK_MS must be an exported const with a documented literal').not.toBeNull();
  });
});
