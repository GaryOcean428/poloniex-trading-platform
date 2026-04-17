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

    const oneHourAndOneMinuteLater = new Date(base.getTime() + 61 * 60_000);
    // The minute the trade was recorded has rotated out of the 60-slot ring.
    expect(
      monitoringService.getTradesInLastMinutes('paper', 60, oneHourAndOneMinuteLater),
    ).toBe(0);
  });

  it('returns 0 trades for a stage that never recorded any', () => {
    expect(monitoringService.getTradesInLastMinutes('paper', 60)).toBe(0);
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

  it('does not fire trades-floor alert before window has elapsed since probe start', () => {
    startPipelineHealthProbe(60_000);
    // Immediately run a probe tick — trades-floor check must be gated on
    // uptime ≥ floor window so a freshly-booted server does not page.
    __internal.runProbeTick(new Date());
    expect(alertingService.getAlertStats().counts.tradeFloorBreaches).toBe(0);
  });

  it('detects silent stages via monitoring and fires an alert via alerting', () => {
    const t0 = new Date('2026-04-17T12:00:00Z');
    monitoringService.recordPipelineHeartbeat('paper');
    // Simulate 20 min passing (paper threshold is 10 min).
    const t1 = new Date(t0.getTime() + 20 * 60_000);
    vi.setSystemTime(t0);
    // Force the heartbeat lastSeen to t0 by re-running at t0.
    monitoringService.recordPipelineHeartbeat('paper');

    // Now pretend it's t1 and probe.
    __internal.runProbeTick(t1);
    expect(alertingService.getAlertStats().counts.pipelineSilent).toBeGreaterThan(0);
  });
});
