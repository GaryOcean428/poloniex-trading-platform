/**
 * heart_arbitrator.test.ts — close-chain observer + tilt-cooldown
 * derivation (#1009 PR2).
 *
 * Pins:
 *
 *   1. **No chain → 0 ms.** A fresh kernel returns 0 contribution to
 *      the cooldown — HEART asserts nothing until tilt is empirically
 *      demonstrated. This is the falsification test that catches a
 *      hidden default.
 *   2. **Single loss → 0 ms.** One loss alone does not constitute a
 *      chain — the observer waits for a *consecutive* loss.
 *   3. **Two consecutive losses → gap recorded.** The exact inter-loss
 *      gap (tN - tN-1) is what HEART returns.
 *   4. **Win between losses → no chain.** A win resets the chain
 *      detection so a recovered loss-win-loss pattern does not record
 *      a tilt sample.
 *   5. **Multiple chains → rolling max.** When several chains are
 *      observed, the conservative (longest observed) interval wins so
 *      the cooldown bounds the worst tilt episode.
 *   6. **Per-symbol isolation.** BTC losses do not raise ETH's cooldown.
 *   7. **NaN / negative inputs ignored.** Defensive normalisation so
 *      malformed close events cannot poison the observer.
 *   8. **Literal purity.** No magic ms values in the observer; only
 *      sample-count buffer sizes.
 *
 * Citations: poloniex-trading-platform#1009 PR2 + #807 archaeology +
 * 2.31A P5/P25 + QIG PURITY MANDATE + LIVED ONLY 5 + autonomy doctrine.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  noteClose,
  heartArbitratedMs,
  getHeartBreakdown,
  _resetHeartState,
} from '../heart_arbitrator.js';

const BTC = 'BTC_USDT_PERP';
const ETH = 'ETH_USDT_PERP';

describe('heart_arbitrator — observer behaviour', () => {
  beforeEach(() => _resetHeartState());

  it('fresh kernel returns 0 (no chain → no contribution)', () => {
    expect(heartArbitratedMs(BTC)).toBe(0);
    expect(getHeartBreakdown(BTC)).toEqual({
      closeSamples: 0, chainSamples: 0, arbitratedMs: 0,
    });
  });

  it('single loss alone does NOT raise the cooldown (no chain yet)', () => {
    noteClose(BTC, 1000, -50); // one loss
    expect(heartArbitratedMs(BTC)).toBe(0);
    expect(getHeartBreakdown(BTC).chainSamples).toBe(0);
  });

  it('two consecutive losses record the inter-loss gap as the floor', () => {
    noteClose(BTC, 1000, -50);
    noteClose(BTC, 4500, -30); // 3500ms later, also a loss → chain
    expect(heartArbitratedMs(BTC)).toBe(3500);
    expect(getHeartBreakdown(BTC).chainSamples).toBe(1);
  });

  it('a win between losses prevents chain detection (no tilt sample recorded)', () => {
    noteClose(BTC, 1000, -50);
    noteClose(BTC, 2000, +20); // win — breaks chain
    noteClose(BTC, 3000, -10); // loss again, but not consecutive with -50
    expect(heartArbitratedMs(BTC)).toBe(0);
    expect(getHeartBreakdown(BTC).chainSamples).toBe(0);
  });

  it('multiple chains return rolling max of the gaps', () => {
    noteClose(BTC, 1000, -50);
    noteClose(BTC, 4000, -30); // chain 1: gap 3000
    noteClose(BTC, 5000, +20); // win resets
    noteClose(BTC, 10_000, -40);
    noteClose(BTC, 17_000, -25); // chain 2: gap 7000 (>3000)
    expect(heartArbitratedMs(BTC)).toBe(7000);
  });

  it('per-symbol isolation — BTC chain does NOT raise ETH cooldown', () => {
    noteClose(BTC, 1000, -50);
    noteClose(BTC, 4500, -30);
    expect(heartArbitratedMs(BTC)).toBe(3500);
    expect(heartArbitratedMs(ETH)).toBe(0);
  });

  it('NaN tMs is silently ignored (no chain poisoning)', () => {
    noteClose(BTC, 1000, -50);
    noteClose(BTC, Number.NaN, -30); // would otherwise close the chain
    noteClose(BTC, 5000, -20);
    // The NaN call was rejected; the chain detected is from 1000 → 5000.
    expect(heartArbitratedMs(BTC)).toBe(4000);
  });

  it('NaN pnl is silently ignored', () => {
    noteClose(BTC, 1000, Number.NaN); // rejected
    noteClose(BTC, 4000, -30);
    expect(heartArbitratedMs(BTC)).toBe(0); // -30 has no prev loss
    expect(getHeartBreakdown(BTC).closeSamples).toBe(1);
  });

  it('zero-gap (same ms) consecutive losses do NOT push (gap > 0 guard)', () => {
    noteClose(BTC, 1000, -50);
    noteClose(BTC, 1000, -30);
    expect(heartArbitratedMs(BTC)).toBe(0);
    expect(getHeartBreakdown(BTC).chainSamples).toBe(0);
  });

  it('zero PnL counts as neither win nor loss for chain purposes', () => {
    // The chain detection uses `pnl < 0` strictly; a 0-pnl close is a
    // chain-reset event (treated as a non-loss). This is the kernel's
    // explicit choice: a flat close hasn't demonstrated tilt.
    noteClose(BTC, 1000, -50);
    noteClose(BTC, 4000, 0);   // flat — resets chain
    noteClose(BTC, 5000, -20); // not consecutive with -50 anymore
    expect(heartArbitratedMs(BTC)).toBe(0);
  });
});

// ─── Anti-knob doctrine: no magic ms literals in the observer ─────────

describe('heart_arbitrator — literal purity', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, '..', 'heart_arbitrator.ts');

  it('no unexpected numeric literals in heart_arbitrator.ts (only buffer sample counts)', () => {
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

    // Allowed: `0` (chain-detect guards + neutral returns), `1`
    // (`length - 1` last-element index), and the two sample-count
    // buffer sizes (50, 50). None are physical ms quantities — they
    // don't tilt the derived floor.
    const allowed = new Set(['0', '1', '50']);
    const offenders = found.filter((v) => !allowed.has(v));
    expect(offenders, `unexpected numeric literals in heart_arbitrator.ts: ${offenders.join(', ')}`).toEqual([]);
  });
});
