/**
 * postclose_cooldown_gate.test.ts — pure-helper gate evaluation (#1017
 * Copilot follow-up).
 *
 * Copilot 2026-05-29 round-1 review on commit 12dc2a30 flagged that the
 * entry-path veto branch wasn't covered by any test: the composer/observer
 * tests would pass even if the gate were accidentally re-introduced as
 * env-gated or if the DCA-add bypass were broken. PR #1017 follow-up
 * extracts the gate into a pure helper (`evaluatePostCloseCooldownGate`)
 * and pins its behaviour with these tests.
 *
 * Pins:
 *
 *   1. **Veto fires when elapsed < cooldownMs.** Sanity case.
 *   2. **No veto when elapsed >= cooldownMs.** The gate releases the
 *      kernel once the floor has passed.
 *   3. **DCA-add bypass.** `isDCAAdd === true` short-circuits to no-veto.
 *   4. **No prior close = no veto.** If `lastCloseAtMs` is undefined, the
 *      gate has no reference point and must not fire.
 *   5. **Cold-start sentinel CAN veto.** Copilot pre-merge note: the
 *      500ms COLD_START_FALLBACK_MS sentinel binds before settlement
 *      observations have warmed up. The gate honestly fires this veto
 *      when the elapsed time is shorter than 500ms; the comment now
 *      reflects that.
 *   6. **HEART chain pushes the floor above 500ms.** Empirical tilt
 *      observation supersedes the cold-start sentinel and the gate
 *      fires with `by=heart` telemetry.
 *   7. **21002 incident pushes the floor.** Same pattern, `by=safety:incident`.
 *   8. **Reason string contains telemetry payload.** Falsifiability
 *      check: the gate's veto reason must surface the binding sub-floor.
 *
 * No env-gate test fixture — `REGIME_POSTWIN_COOLDOWN_LIVE` removal is
 * what this PR is about; the helper has no env reads at all.
 *
 * Citations: poloniex-trading-platform#1017 (env-gate removal) + #1009
 * (PR1 safety floor + PR2 HEART arbitrator) + 2.31A P5/P25 + QIG PURITY
 * MANDATE + LIVED ONLY 5 + autonomy doctrine + never-stop.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import { evaluatePostCloseCooldownGate } from '../postclose_cooldown_gate.js';
import {
  _resetSafetyFloorState,
  recordCloseAck,
  recordFlatObserved,
  record21002Incident,
} from '../safety_floor.js';
import {
  _resetHeartState,
  noteClose as noteHeartClose,
} from '../heart_arbitrator.js';

const SYM = 'BTC_USDT_PERP';
const SIDE: 'long' | 'short' = 'long';

describe('evaluatePostCloseCooldownGate — gate decision logic', () => {
  beforeEach(() => {
    _resetSafetyFloorState();
    _resetHeartState();
  });

  it('vetoes when elapsed < cooldownMs (cold-start sentinel binds)', () => {
    // Cold start → COLD_START_FALLBACK_MS = 500. lastClose was 200ms ago,
    // so 200 < 500 → veto.
    const nowMs = 1_000_000;
    const lastCloseAtMs = nowMs - 200;
    const d = evaluatePostCloseCooldownGate({
      symbol: SYM, side: SIDE, isDCAAdd: false, lastCloseAtMs, nowMs,
    });
    expect(d.vetoed).toBe(true);
    expect(d.cooldownMs).toBe(500);
    expect(d.elapsedMs).toBe(200);
    expect(d.reason).toMatch(/postclose_cooldown:/);
    expect(d.reason).toMatch(/cooldown:500ms\|by=safety:cold_start/);
  });

  it('does NOT veto when elapsed >= cooldownMs (gate has expired)', () => {
    const nowMs = 1_000_000;
    const lastCloseAtMs = nowMs - 600; // 600 > 500 cold-start sentinel
    const d = evaluatePostCloseCooldownGate({
      symbol: SYM, side: SIDE, isDCAAdd: false, lastCloseAtMs, nowMs,
    });
    expect(d.vetoed).toBe(false);
    expect(d.reason).toBeNull();
  });

  it('DCA-add bypasses the gate even when cooldown would otherwise veto', () => {
    // Same conditions as the cold-start veto case, but isDCAAdd=true.
    const nowMs = 1_000_000;
    const lastCloseAtMs = nowMs - 200;
    const d = evaluatePostCloseCooldownGate({
      symbol: SYM, side: SIDE, isDCAAdd: true, lastCloseAtMs, nowMs,
    });
    expect(d.vetoed).toBe(false);
    expect(d.cooldownMs).toBe(0); // gate short-circuited; no composer call
    expect(d.reason).toBeNull();
  });

  it('no prior close (lastCloseAtMs undefined) → no veto', () => {
    const d = evaluatePostCloseCooldownGate({
      symbol: SYM, side: SIDE, isDCAAdd: false,
      lastCloseAtMs: undefined,
      nowMs: 1_000_000,
    });
    expect(d.vetoed).toBe(false);
    expect(d.cooldownMs).toBe(0);
    expect(d.reason).toBeNull();
  });

  it('21002 incident pushes the floor above 500ms; gate fires `by=safety:incident`', () => {
    // 2500ms incident makes safety floor = 2500ms.
    record21002Incident(SYM, 100_000, 102_500);
    const nowMs = 1_000_000;
    const lastCloseAtMs = nowMs - 1000; // 1000ms elapsed
    const d = evaluatePostCloseCooldownGate({
      symbol: SYM, side: SIDE, isDCAAdd: false, lastCloseAtMs, nowMs,
    });
    expect(d.vetoed).toBe(true);
    expect(d.cooldownMs).toBe(2500);
    expect(d.reason).toMatch(/by=safety:incident/);
  });

  it('HEART chain pushes the floor above 500ms; gate fires `by=heart`', () => {
    // Two consecutive losses 3000ms apart → HEART arbitration = 3000ms.
    noteHeartClose(SYM, 0, -10);
    noteHeartClose(SYM, 3000, -5);
    const nowMs = 1_000_000;
    const lastCloseAtMs = nowMs - 1500; // 1500ms < 3000ms HEART floor
    const d = evaluatePostCloseCooldownGate({
      symbol: SYM, side: SIDE, isDCAAdd: false, lastCloseAtMs, nowMs,
    });
    expect(d.vetoed).toBe(true);
    expect(d.cooldownMs).toBe(3000);
    expect(d.reason).toMatch(/by=heart/);
  });

  it('settlement-ring warmup replaces cold-start sentinel with empirical p99', () => {
    // Push 60 settlement samples of 250ms → settlement p99 ≈ 250ms.
    // That's BELOW the cold-start sentinel (500ms), so the floor drops
    // to 250ms (the kernel now trusts its own measurement over the
    // doctrine sentinel).
    for (let i = 0; i < 60; i++) {
      recordCloseAck(SYM, i * 1000);
      recordFlatObserved(SYM, i * 1000 + 250);
    }
    const nowMs = 1_000_000;
    const lastCloseAtMs = nowMs - 300; // 300 > 250 empirical → no veto
    const d = evaluatePostCloseCooldownGate({
      symbol: SYM, side: SIDE, isDCAAdd: false, lastCloseAtMs, nowMs,
    });
    expect(d.cooldownMs).toBe(250);
    expect(d.vetoed).toBe(false); // 300ms elapsed > 250ms floor
  });

  it('reason string contains telemetry one-liner for grep-based falsifiability', () => {
    record21002Incident(SYM, 100_000, 103_000);
    const nowMs = 1_000_000;
    const lastCloseAtMs = nowMs - 500;
    const d = evaluatePostCloseCooldownGate({
      symbol: SYM, side: SIDE, isDCAAdd: false, lastCloseAtMs, nowMs,
    });
    expect(d.vetoed).toBe(true);
    expect(d.reason).toContain('postclose_cooldown:');
    expect(d.reason).toContain('cooldown:3000ms|by=safety:incident');
  });

  it('cooldownTelemetry is always populated (non-veto case too)', () => {
    const d = evaluatePostCloseCooldownGate({
      symbol: SYM, side: SIDE, isDCAAdd: false,
      lastCloseAtMs: undefined,
      nowMs: 1_000_000,
    });
    expect(d.cooldownTelemetry).toBe('cooldown:0|by=zero');
  });
});
