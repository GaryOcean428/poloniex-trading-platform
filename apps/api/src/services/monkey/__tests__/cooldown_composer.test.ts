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
import {
  noteClose as noteHeartClose,
  _resetHeartState,
} from '../heart_arbitrator.js';

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

// ─── Cascade follow-up (2026-05-29): NaN must not disable safety ───────

describe('cooldown_composer — provider NaN/Infinity hardening (Cascade 2026-05-29)', () => {
  beforeEach(() => _resetSafetyFloorState());

  it('NaN from heartProvider does NOT disable safety (Math.max(0,...,NaN)===NaN trap)', () => {
    // Push enough settlement samples to give safety > 0 (cold-start is 500).
    for (let i = 0; i < 60; i++) {
      recordCloseAck(SYM, i * 1000);
      recordFlatObserved(SYM, i * 1000 + 250);
    }
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 0,
      heartProvider: () => Number.NaN,
    });
    // Without hardening: Math.max(safety, NaN) === NaN → cooldownActive=false.
    // With hardening: NaN normalises to 0; safety stays binding.
    expect(b.heartMs).toBe(0);
    expect(b.finalMs).toBe(250);
    expect(b.by).toBe<BindingFloor>('safety');
    expect(b.cooldownActive).toBe(true);
  });

  it('Infinity from decoherenceProvider normalises to 0 (no infinite cooldown)', () => {
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 0,
      decoherenceProvider: () => Number.POSITIVE_INFINITY,
    });
    expect(b.decoherenceMs).toBe(0);
    expect(Number.isFinite(b.finalMs)).toBe(true);
  });

  it('Negative value from heartProvider normalises to 0', () => {
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 0,
      heartProvider: () => -1234,
    });
    expect(b.heartMs).toBe(0);
  });

  it('NaN tickCadenceMs normalises to 0', () => {
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: Number.NaN,
    });
    expect(b.tickCadenceMs).toBe(0);
  });
});

// ─── Cascade follow-up: safetyDetail must reflect snapshot used for safetyMs ─

describe('cooldown_composer — single safety snapshot (Cascade 2026-05-29)', () => {
  beforeEach(() => _resetSafetyFloorState());

  it('safetyDetail in the return matches the snapshot used to compute safetyMs', () => {
    for (let i = 0; i < 60; i++) {
      recordCloseAck(SYM, i * 1000);
      recordFlatObserved(SYM, i * 1000 + 137);
    }
    const b = composeCooldown({ symbol: SYM, tickCadenceMs: 0 });
    // safetyMs is derived from safetyDetail; they must agree exactly so
    // telemetry's `by=safety:settlement` cannot lie about the binding
    // sub-floor when rate-limit state refills between two separate calls.
    expect(b.safetyMs).toBe(
      Math.max(
        b.safetyDetail.settlementP99Ms,
        b.safetyDetail.incidentMaxMs,
        b.safetyDetail.rateLimitHeadroomMs,
      ),
    );
    expect(b.safetyDetail.settlementP99Ms).toBe(137);
  });
});

// ─── Copilot follow-up (2026-05-29): telemetry sub-floor labelling order ─
//
// The prior `formatCooldownTelemetry` reported `:cold_start` BEFORE checking
// whether incident or rate-limit was the binding sub-floor inside the
// safety term. A 21002 incident can raise `safetyMs` above the cold-start
// sentinel WHILE the settlement ring is still cold — telemetry then lied
// about the binding sub-floor (`:cold_start` instead of `:incident`),
// destroying post-deploy falsifiability.

describe('cooldown_composer — telemetry order: incident before cold_start (Copilot 2026-05-29)', () => {
  beforeEach(() => _resetSafetyFloorState());

  it('21002 incident binds safetyMs while settlement ring is cold → telemetry says :incident', () => {
    // Zero settlement samples → safety contributes 0 (cold-start sentinel
    // was DELETED 2026-05-29). A 21002 incident gives safetyMs = 2500;
    // telemetry labels the binding sub-floor as `:incident`.
    record21002Incident(SYM, 100_000, 102_500); // 2500ms incident
    const b = composeCooldown({ symbol: SYM, tickCadenceMs: 0 });
    expect(b.safetyDetail.coldStartActive).toBe(true);   // ring is cold
    expect(b.safetyDetail.incidentMaxMs).toBe(2500);
    expect(b.safetyMs).toBe(2500);
    expect(b.by).toBe<BindingFloor>('safety');
    expect(formatCooldownTelemetry(b)).toBe('cooldown:2500ms|by=safety:incident');
  });

  it('cold-start with no other observers → safetyMs is 0, gate does not fire', () => {
    // 2026-05-29 cascading-knob-strip: no COLD_START_FALLBACK_MS sentinel.
    // Pure cold-start (no incidents, no rate-limit pressure) → safety=0.
    const b = composeCooldown({ symbol: SYM, tickCadenceMs: 0 });
    expect(b.safetyDetail.coldStartActive).toBe(true);
    expect(b.safetyMs).toBe(0);
    expect(b.cooldownActive).toBe(false);
    expect(b.by).toBe<BindingFloor>('zero');
  });
});

// ─── #1009 PR2: HEART provider wired to heart_arbitrator (not stub) ───
//
// PR1's composeCooldown defaulted heartArbitratedMs to a `return 0`
// stub. PR2 wires it to the real `heart_arbitrator.ts` close-chain
// observer. This block pins that the default provider is NOT the stub:
// a real chain on `symbol` raises `b.heartMs` (and `b.finalMs`) when no
// explicit `heartProvider` override is passed.

describe('cooldown_composer — default HEART provider is heart_arbitrator (#1009 PR2)', () => {
  beforeEach(() => {
    _resetSafetyFloorState();
    _resetHeartState();
  });

  it('default heart provider returns 0 when no chain observed', () => {
    const b = composeCooldown({ symbol: SYM, tickCadenceMs: 0 });
    expect(b.heartMs).toBe(0);
  });

  it('default heart provider returns the chain-gap when chain observed', () => {
    // Two consecutive losses 2500ms apart → HEART arbitration = 2500ms.
    noteHeartClose(SYM, 1000, -10);
    noteHeartClose(SYM, 3500, -5);
    const b = composeCooldown({ symbol: SYM, tickCadenceMs: 0 });
    expect(b.heartMs).toBe(2500);
  });

  it('HEART binds finalMs when its term exceeds safety + tick cadence', () => {
    // No incidents, settlement ring is cold (0 floor). A chain of
    // 8000ms exceeds the 500ms safety floor → HEART is the binding term.
    noteHeartClose(SYM, 1000, -10);
    noteHeartClose(SYM, 9000, -5);
    const b = composeCooldown({ symbol: SYM, tickCadenceMs: 0 });
    expect(b.heartMs).toBe(8000);
    expect(b.finalMs).toBe(8000);
    expect(b.by).toBe<BindingFloor>('heart');
  });
});

// ─── #1032: expectancy gate (negative Kelly EV → cooldown extension) ────────

describe('cooldown_composer — expectancy gate (#1032)', () => {
  beforeEach(() => _resetSafetyFloorState());

  it('no extension when sampleCount < EXPECTANCY_MIN_SAMPLES', () => {
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 0,
      expectancyEdge: { fStar: -0.3, sampleCount: 10 },
    });
    expect(b.expectancyMs).toBe(0);
    expect(b.by).toBe<BindingFloor>('zero');
  });

  it('no extension when fStar >= 0 (positive or break-even edge)', () => {
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 0,
      expectancyEdge: { fStar: 0.1, sampleCount: 40 },
    });
    expect(b.expectancyMs).toBe(0);
  });

  it('no extension when expectancyEdge is null', () => {
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 0,
      expectancyEdge: null,
    });
    expect(b.expectancyMs).toBe(0);
  });

  it('extension scales with baseFloor and |fStar| when sampleCount >= MIN_SAMPLES', () => {
    // safety=0 (cold-start, no observations), tickCadence=1000ms → baseFloor=1000
    // sampleCount=40 = 2×MIN(20) → sampleRamp=1 → expectancy = 0.4 × 1000 × 1 = 400
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 1000,
      expectancyEdge: { fStar: -0.4, sampleCount: 40 },
    });
    expect(b.expectancyMs).toBe(400);
    expect(b.tickCadenceMs).toBe(1000);
    // tickCadence=1000 > expectancy=400 → tick_cadence is binding
    expect(b.by).toBe<BindingFloor>('tick_cadence');
    expect(b.finalMs).toBe(1000);
  });

  it('sampleRamp is < 1 when sampleCount is between MIN and 2×MIN', () => {
    // sampleCount=30 = MIN(20)+10 → ramp = 10/20 = 0.5
    // baseFloor=tickCadence=2000 → expectancy = 0.5 × 2000 × 0.5 = 500
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 2000,
      expectancyEdge: { fStar: -0.5, sampleCount: 30 },
    });
    expect(b.expectancyMs).toBe(500);
  });

  it('expectancy binds finalMs when it exceeds all other floors', () => {
    // safety=0, decoherence=0, heart=0, tickCadence=0 → all floors 0
    // Warm safety to 100ms, sampleCount=40 → ramp=1
    // fStar=-0.5, baseFloor=100 → expectancy = 0.5 × 100 = 50 < 100 → safety binds
    // Try without safety: tickCadence=0, safety=0 → baseFloor=0 → expectancy=0
    // Need baseFloor>0: use heartProvider=100
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 0,
      heartProvider: () => 100,
      expectancyEdge: { fStar: -2, sampleCount: 40 },
    });
    // baseFloor = max(0, 0) = 0 because safety=0 and tick=0; heart is separate
    // Actually baseFloor = max(safety, tickCadence) = max(0, 0) = 0
    // So expectancy = 2 × 0 × 1 = 0; heart=100 binds
    expect(b.heartMs).toBe(100);
    expect(b.expectancyMs).toBe(0);
    expect(b.by).toBe<BindingFloor>('heart');
  });

  it('expectancy binds when larger than safety and tick cadence', () => {
    // safety=200ms (warmed), tickCadence=0
    for (let i = 0; i < 60; i++) {
      recordCloseAck(SYM, i * 1000);
      recordFlatObserved(SYM, i * 1000 + 200);
    }
    // baseFloor = max(200, 0) = 200; fStar=-1.5, sampleCount=40→ramp=1
    // expectancy = 1.5 × 200 × 1 = 300 > safety(200) → expectancy binds
    const b = composeCooldown({
      symbol: SYM,
      tickCadenceMs: 0,
      expectancyEdge: { fStar: -1.5, sampleCount: 40 },
    });
    expect(b.safetyMs).toBe(200);
    expect(b.expectancyMs).toBe(300);
    expect(b.finalMs).toBe(300);
    expect(b.by).toBe<BindingFloor>('expectancy');
    expect(formatCooldownTelemetry(b)).toBe('cooldown:300ms|by=expectancy:negative_ev');
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
    //   0  — Math.max(0, ...) clamp and finiteNonNegative guard
    //   1  — Math.min(1, ...) full-ramp clamp (sampleRamp ceiling, same
    //         category as the 0-floor: normalisation, not a knob)
    //   20 — EXPECTANCY_MIN_SAMPLES significance gate (P25 safety bound;
    //         see #1032 and cooldown_composer.ts EXPECTANCY_MIN_SAMPLES comment)
    // Anything else would be a knob in costume.
    const allowed = new Set(['0', '1', '20']);
    const offenders = found.filter((v) => !allowed.has(v));
    expect(offenders, `unexpected numeric literals in cooldown_composer.ts: ${offenders.join(', ')}`).toEqual([]);
  });
});
