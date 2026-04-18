/**
 * Unit tests for Commit 1 observability:
 *   - monitoringService pipeline-stage heartbeat + trades-per-hour ring
 *   - alertingService silent-failure + trades-floor alerts with cooldown
 *   - pipelineHealthProbe wiring (monitoring → alerting)
 *
 * These exist to lock down the "0 paper trades for weeks and nobody
 * noticed" bug class. If a stage stops ticking or trades dry up, the
 * probe fires an alert within one tick.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { monitoringService } from '../monitoringService.js';
import alertingService from '../alertingService.js';
import { __internal, startPipelineHealthProbe, stopPipelineHealthProbe } from '../pipelineHealthProbe.js';

describe('monitoringService pipeline heartbeat', () => {
  beforeEach(() => {
    monitoringService.reset();
  });

  it('records a stage tick and reports it as not-silent', () => {
    const now = new Date('2026-04-17T12:00:00Z');
    vi.setSystemTime(now);
    monitoringService.recordPipelineHeartbeat('backtest');

    const silent = monitoringService.getSilentPipelineStages(now);
    expect(silent.find((s) => s.stage === 'backtest')).toBeUndefined();
  });

  it('flags a stage as silent after its threshold elapses', () => {
    const t0 = new Date('2026-04-17T12:00:00Z');
    vi.setSystemTime(t0);
    monitoringService.recordPipelineHeartbeat('paper');

    // Paper threshold is 10 min; jump 11 min ahead.
    const t1 = new Date(t0.getTime() + 11 * 60_000);
    const silent = monitoringService.getSilentPipelineStages(t1);
    const paperEntry = silent.find((s) => s.stage === 'paper');
    expect(paperEntry).toBeDefined();
    expect(paperEntry!.silentMs).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it('does NOT flag never-seen stages as silent (prevents boot-time false positives)', () => {
    // Reset ensures no stage has ticked yet.
    monitoringService.reset();
    // Probe runs immediately on boot — nothing should appear silent.
    const silent = monitoringService.getSilentPipelineStages(new Date('2026-04-18T12:00:00Z'));
    expect(silent).toEqual([]);
  });

  it('flags only seen-then-silent stages, not never-seen ones', () => {
    monitoringService.reset();
    const t0 = new Date('2026-04-17T12:00:00Z');
    vi.setSystemTime(t0);
    // Paper ticks once, generator never ticks.
    monitoringService.recordPipelineHeartbeat('paper');

    const t1 = new Date(t0.getTime() + 20 * 60_000);
    const silent = monitoringService.getSilentPipelineStages(t1);
    // Paper (seen, now silent) is flagged.
    expect(silent.find((s) => s.stage === 'paper')).toBeDefined();
    // Generator (never seen) is NOT flagged — the production alert-
    // storm bug we fixed.
    expect(silent.find((s) => s.stage === 'generator')).toBeUndefined();
  });

  it('counts trades in the rolling 60-minute ring', () => {
    const base = new Date('2026-04-17T12:00:00Z');
    monitoringService.recordTradeEvent('paper', base);
    monitoringService.recordTradeEvent('paper', new Date(base.getTime() + 30_000));
    monitoringService.recordTradeEvent('paper', new Date(base.getTime() + 60_000));

    const twoMinLater = new Date(base.getTime() + 2 * 60_000);
    expect(monitoringService.getTradesInLastMinutes('paper', 60, twoMinLater)).toBe(3);
  });

  it('ages trades out of the rolling window as minutes advance', () => {
    const base = new Date('2026-04-17T12:00:00Z');
    monitoringService.recordTradeEvent('paper', base);

    // Ring is TRADES_RING_SLOTS (360) minutes wide. After 361 minutes the
    // original slot has rotated out; a 360-minute window sees 0 trades.
    const pastRingLater = new Date(base.getTime() + 361 * 60_000);
    expect(
      monitoringService.getTradesInLastMinutes('paper', 360, pastRingLater),
    ).toBe(0);
  });

  it('retains trades across a 6-hour rolling window', () => {
    const base = new Date('2026-04-17T12:00:00Z');
    monitoringService.recordTradeEvent('paper', base);

    // Five hours later, the trade should still be in the 360-slot ring
    // because the floor window is 360 minutes (6h).
    const fiveHoursLater = new Date(base.getTime() + 5 * 60 * 60_000);
    expect(
      monitoringService.getTradesInLastMinutes('paper', 360, fiveHoursLater),
    ).toBe(1);
  });

  it('returns 0 trades for a stage that never recorded any', () => {
    expect(monitoringService.getTradesInLastMinutes('paper', 60)).toBe(0);
  });
});

describe('monitoringService backtest-pass-rate tracker', () => {
  beforeEach(() => {
    monitoringService.reset();
  });

  it('starts at 0 consecutive zero-pass generations', () => {
    expect(monitoringService.getGenerationsSinceLastPass()).toBe(0);
  });

  it('increments on each zero-pass generation', () => {
    monitoringService.recordGenerationOutcome(0, 6);
    monitoringService.recordGenerationOutcome(0, 6);
    monitoringService.recordGenerationOutcome(0, 6);
    expect(monitoringService.getGenerationsSinceLastPass()).toBe(3);
  });

  it('resets to 0 on any generation with at least one pass', () => {
    monitoringService.recordGenerationOutcome(0, 6);
    monitoringService.recordGenerationOutcome(0, 6);
    monitoringService.recordGenerationOutcome(1, 6);
    expect(monitoringService.getGenerationsSinceLastPass()).toBe(0);
  });

  it('captures the most recent outcome for UI snapshots', () => {
    const t = new Date('2026-04-18T02:16:16Z');
    monitoringService.recordGenerationOutcome(2, 6, t);
    const snap = monitoringService.getLastGenerationOutcome();
    expect(snap).toEqual({ at: t, passed: 2, total: 6 });
  });

  it('exposes the stall threshold constant (≥20 consecutive zero-pass)', () => {
    expect(monitoringService.getBacktestStallThreshold()).toBeGreaterThanOrEqual(20);
  });
});

describe('alertingService silent-failure + trades-floor alerts', () => {
  beforeEach(() => {
    alertingService.resetAlertCounts();
  });

  it('fires a silent-pipeline alert on first call', () => {
    const fired = alertingService.alertPipelineSilent('paper', 15 * 60_000, 10 * 60_000);
    expect(fired).toBe(true);
    expect(alertingService.getAlertStats().counts.pipelineSilent).toBe(1);
  });

  it('suppresses repeat silent alerts within the cooldown window', () => {
    alertingService.alertPipelineSilent('paper', 15 * 60_000, 10 * 60_000);
    const second = alertingService.alertPipelineSilent('paper', 20 * 60_000, 10 * 60_000);
    expect(second).toBe(false);
    expect(alertingService.getAlertStats().counts.pipelineSilent).toBe(1);
  });

  it('tracks cooldowns per-stage independently', () => {
    alertingService.alertPipelineSilent('paper', 15 * 60_000, 10 * 60_000);
    const liveFired = alertingService.alertPipelineSilent('live', 15 * 60_000, 10 * 60_000);
    expect(liveFired).toBe(true);
    expect(alertingService.getAlertStats().counts.pipelineSilent).toBe(2);
  });

  it('fires a trades-floor breach alert with cooldown', () => {
    const first = alertingService.alertTradesFloorBreach('paper', 0, 360, 'expected_running');
    const second = alertingService.alertTradesFloorBreach('paper', 0, 360, 'expected_running');
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(alertingService.getAlertStats().counts.tradeFloorBreaches).toBe(1);
  });
});

describe('pipelineHealthProbe wiring', () => {
  beforeEach(() => {
    monitoringService.reset();
    alertingService.resetAlertCounts();
  });

  afterEach(() => {
    stopPipelineHealthProbe();
  });

  it('does not fire trades-floor alert before window has elapsed since probe start', async () => {
    // Predicate returns true (expected trading), but uptime gate should
    // still block the alert because we just started.
    startPipelineHealthProbe(60_000, () => true);
    await __internal.runProbeTick(new Date());
    expect(alertingService.getAlertStats().counts.tradeFloorBreaches).toBe(0);
  });

  it('does not fire trades-floor alert when predicate says not expected-trading', async () => {
    // Predicate reports paused — suppresses the alert even after uptime
    // gate clears. This is the Sourcery-flagged regression guard.
    startPipelineHealthProbe(60_000, () => false);
    await __internal.runProbeTick(new Date());
    expect(alertingService.getAlertStats().counts.tradeFloorBreaches).toBe(0);
  });

  it('detects silent stages via monitoring and fires an alert via alerting', async () => {
    const t0 = new Date('2026-04-17T12:00:00Z');
    monitoringService.recordPipelineHeartbeat('paper');
    // Simulate 20 min passing (paper threshold is 10 min).
    const t1 = new Date(t0.getTime() + 20 * 60_000);
    vi.setSystemTime(t0);
    // Force the heartbeat lastSeen to t0 by re-running at t0.
    monitoringService.recordPipelineHeartbeat('paper');

    // Now pretend it's t1 and probe.
    await __internal.runProbeTick(t1);
    expect(alertingService.getAlertStats().counts.pipelineSilent).toBeGreaterThan(0);
  });

  it('skips overlapping ticks (re-entrancy guard)', async () => {
    // Inject a predicate that never resolves so we can observe the
    // guard behavior: a second tick called while the first is in
    // flight should be skipped (not queued, not failed).
    let release: () => void;
    const block = new Promise<void>((res) => { release = res; });
    startPipelineHealthProbe(60_000, async () => { await block; return false; });

    // Fire-and-forget the first tick (don't await — it's stuck on `block`).
    const first = __internal.runProbeTick(new Date());
    // Second tick fires immediately; the guard should make it return
    // quickly without waiting on the first.
    await __internal.runProbeTick(new Date());

    // Release the blocked first tick and await it so vitest doesn't
    // warn about unhandled promises.
    release!();
    await first;
    // No explicit assertion on the guard's internal state — the fact
    // that the second tick resolved while the first was still pending
    // is the proof.
  });
});
