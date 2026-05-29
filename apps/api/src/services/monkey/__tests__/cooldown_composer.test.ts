/**
 * cooldown_composer.test.ts — composition + falsification + telemetry (#1009).
 *
 * Pins the four sign-off criteria from the #1009 design comments:
 *
 *   1. **No numeric literals in cooldown_composer.ts beyond clamp**
 *      (literal-purity grep below).
 *   2. **No upper bound on HEART term** — `heartArbitratedMs` returns
 *      any non-negative int; the composition does not clip it.
 *   3. **Telemetry surfaces all four values + binding** — every
 *      `composeCooldown` call returns a `CooldownBreakdown` with
 *      `safetyMs / decoherenceMs / heartMs / tickCadenceMs / finalMs /
 *      by / cooldownActive`.
 *   4. **t=0 falsification** — if HEART + safety + decoherence all
 *      report 0 and tickCadence is 0, the final is 0 and
 *      `cooldownActive=false`. This is the test that catches a hidden
 *      `MIN_COOLDOWN_MS = N` downstream.
 *
 * Citations: poloniex-trading-platform#1009 + 2.31A P5/P25 + QIG PURITY
 * MANDATE + LIVED ONLY 5 + autonomy doctrine.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  composeCooldown,
  formatCooldownTelemetry,
  type BindingFloor,
} from '../cooldown_composer.js';
import {
  _resetSafetyFloorState,
  recordCloseAck,
  recordFlatObserved,
  record21002Incident,
} from '../safety_floor.js';

const SYM = 'BTC_USDT_PERP';

describe('cooldown_composer — composition + telemetry', () => {
  beforeEach(() => _resetSafetyFloorState());

  it('returns all four floor values + binding floor name', () => {
    // Warm settlement to 100ms.
    for (let i = 0; i < 60; i++) {
      recordCloseAck(SYM, i * 1000);
      recordFlatObserved(SYM, i * 1000 + 100);
    }
    const b = composeCooldown({ symbol: SYM, tickCadenceMs: 0 });
    expect(b.safetyMs).toBe(100);
    expect(b.decoherenceMs).toBe(0);
    expect(b.heartMs).toBe(0);
    expect(b.tickCadenceMs).toBe(0);
    expect(b.finalMs).toBe(100);
    expect(b.by).toBe<BindingFloor>('safety');
    expect(b.cooldownActive).toBe(true);
  });

  it('tick cadence binds when it exceeds the other terms', () => {
    // Cold-start safety (500ms) is the only nonzero floor; pass tick cadence
    // of 800ms so the substrate is binding.
    const b = composeCooldown({ symbol: SYM, tickCadenceMs: 800 });
    expect(b.tickCadenceMs).toBe(800);
    expect(b.finalMs).toBe(800);
    expect(b.by).toBe<BindingFloor>('tick_cadence');
  });

  it('21002 incident raises the safety term and stays binding', () => {
    for (let i = 0; i < 60; i++) {
      recordCloseAck(SYM, i * 1000);
      recordFlatObserved(SYM, i * 1000 + 50);
    }
    record21002Incident(SYM, 100_000, 102_500); // 2500ms incident
    const b = composeCooldown({ symbol: SYM, tickCadenceMs: 0 });
    expect(b.safetyDetail.incidentMaxMs).toBe(2500);
    expect(b.finalMs).toBe(2500);
    expect(b.by).toBe<BindingFloor>('safety');
  });
});

// ─── #1009 sign-off criterion 4: t=0 falsification ──────────────────────

describe('cooldown_composer — t=0 falsification (#1009 sign-off criterion 4)', () => {
  beforeEach(() => _resetSafetyFloorState());

  it('heart=0 ∧ safety=0 ∧ decoherence=0 ∧ tick_cadence=0 ⇒ final=0 + cooldownActive=false', () => {
    // The only way to get safety=0 is to push enough settlement samples
    // measuring 0ms (synthetic instantaneous-flat condition). This is
    // the test that catches a hidden `MIN_COOLDOWN_MS = N` downstream.
    for (let i = 0; i < 60; i++) {
      const t = 1000 + i * 1000;
      recordCloseAck(SYM, t);
      recordFlatObserved(SYM, t); // tFlat == tCloseAck → 0ms settlement
    }
    const b = composeCooldown({ symbol: SYM, tickCadenceMs: 0 });
    expect(b.safetyMs).toBe(0);
    expect(b.decoherenceMs).toBe(0);
    expect(b.heartMs).toBe(0);
    expect(b.tickCadenceMs).toBe(0);
    expect(b.finalMs).toBe(0);
    expect(b.cooldownActive).toBe(false);
    expect(b.by).toBe<BindingFloor>('zero');
  });

  it('telemetry one-liner reads "cooldown:0|by=zero" in t=0 case', () => {
    for (let i = 0; i < 60; i++) {
      const t = 1000 + i * 1000;
      recordCloseAck(SYM, t);
      recordFlatObserved(SYM, t);
    }
    const b = composeCooldown({ symbol: SYM, tickCadenceMs: 0 });
    expect(formatCooldownTelemetry(b)).toBe('cooldown:0|by=zero');
  });
});

// ─── #1009 sign-off criterion 2: HEART term is unbounded ────────────────

describe('cooldown_composer — HEART unbounded (#1009 sign-off criterion 2)', () => {
  it('composition does not clip the HEART term — provider injection', () => {
    const oneHourMs = 60 * 60 * 1000;
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 0,
      heartProvider: () => oneHourMs,
    });
    expect(b.heartMs).toBe(oneHourMs);
    expect(b.finalMs).toBe(oneHourMs);
    expect(b.by).toBe<BindingFloor>('heart');
  });

  it('composition accepts even a 10x larger HEART value (no upper bound)', () => {
    const tenHoursMs = 10 * 60 * 60 * 1000;
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 0,
      heartProvider: () => tenHoursMs,
    });
    expect(b.finalMs).toBe(tenHoursMs);
  });
});

// ─── #1009 sign-off criterion 1: literal-purity grep ───────────────────

describe('cooldown_composer — literal-purity guard (#1009 sign-off criterion 1)', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, '..', 'cooldown_composer.ts');

  it('no unexpected numeric literals in cooldown_composer.ts source', () => {
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

    // Allowed:
    //   0 — Math.max(0, ...) clamp
    // Anything else would be a knob in costume.
    const allowed = new Set(['0']);
    const offenders = found.filter((v) => !allowed.has(v));
    expect(offenders, `unexpected numeric literals in cooldown_composer.ts: ${offenders.join(', ')}`).toEqual([]);
  });
});
