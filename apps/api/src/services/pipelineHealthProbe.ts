/**
 * Pipeline health probe.
 *
 * Periodically queries the monitoring service for pipeline-stage
 * heartbeats and trade rates, and fires alerting-service alerts for
 * silent stages and trades-per-hour floor breaches.
 *
 * This is the guard that converts "0 paper trades for weeks and nobody
 * noticed" into a pagable alert within one probe interval.
 */

import alertingService from './alertingService.js';
import { monitoringService, type PipelineStage } from './monitoringService.js';
import { logger } from '../utils/logger.js';

const DEFAULT_PROBE_INTERVAL_MS = 60_000;

/**
 * A predicate the probe calls to decide whether the system is in a
 * state where trades *should* be happening. When this returns false,
 * the trades-floor alert is suppressed.
 *
 * Returning a Promise is supported so the real predicate can query
 * database state (option C in the design doc: "only alert once the
 * pipeline has proven it *can* produce passing strategies").
 *
 * Default is sync `false` so tests / fresh boots stay silent unless a
 * caller explicitly wires in a live state source.
 */
export type IsExpectedTradingPredicate = () => boolean | Promise<boolean>;

/**
 * Default predicate — reports false so the probe does NOT alert on
 * trades-per-hour floor unless a caller explicitly wires in a live
 * state source. This module stays free of service dependencies so
 * tests that import it don't cascade into encryption / env
 * validation.
 *
 * index.ts wires the real predicate at boot.
 */
const defaultIsExpectedTrading: IsExpectedTradingPredicate = () => false;

type ProbeHandle = {
  stop: () => void;
  runOnce: () => void;
  readonly intervalMs: number;
};

let activeProbe: ProbeHandle | null = null;
/** First-observed tick timestamp — used to avoid firing trades-floor alerts before the system has been up long enough to produce trades. */
let probeStartedAt: Date | null = null;
let isExpectedTrading: IsExpectedTradingPredicate = defaultIsExpectedTrading;
/**
 * Re-entrancy guard. The probe tick is async (DB-backed predicate) and
 * can legitimately take >60s under DB pressure; without this, overlapping
 * ticks would pile up and inflate DB load on an already-struggling
 * system. Sourcery flagged this on #489.
 */
let tickInFlight = false;

/**
 * Decide whether a trades-floor alert is appropriate given current state.
 * Three gates must all be true before we page:
 *   1. Probe has been up at least the full floor window.
 *   2. The trading engine says it is currently running (not Paused).
 *   3. (Monitoring data width matches the window — asserted at build by
 *      TRADES_PER_HOUR_FLOOR_WINDOW_MIN ≤ TRADES_RING_SLOTS.)
 *
 * Sourcery flagged that an assumed `expected_running` state without this
 * gate would page on intentionally-paused / paper-only configurations.
 */
async function shouldEvaluateTradesFloor(now: Date): Promise<boolean> {
  if (!probeStartedAt) return false;
  const uptimeMs = now.getTime() - probeStartedAt.getTime();
  const windowMs = monitoringService.getTradesPerHourFloorWindowMinutes() * 60_000;
  if (uptimeMs < windowMs) return false;
  const result = isExpectedTrading();
  return result instanceof Promise ? await result : result;
}

async function runProbeTick(now: Date = new Date()): Promise<void> {
  if (tickInFlight) {
    logger.debug('pipelineHealthProbe tick skipped — previous tick still in flight');
    return;
  }
  tickInFlight = true;
  try {
    const silentStages = monitoringService.getSilentPipelineStages(now);
    for (const { stage, silentMs, thresholdMs } of silentStages) {
      alertingService.alertPipelineSilent(stage as PipelineStage, silentMs, thresholdMs);
    }

    if (!(await shouldEvaluateTradesFloor(now))) return;

    const windowMin = monitoringService.getTradesPerHourFloorWindowMinutes();
    for (const stage of ['paper', 'live'] as const) {
      const trades = monitoringService.getTradesInLastMinutes(stage, windowMin, now);
      if (trades < 1) {
        alertingService.alertTradesFloorBreach(stage, trades, windowMin, 'expected_running');
      }
    }
  } catch (err) {
    logger.error('pipelineHealthProbe tick failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    tickInFlight = false;
  }
}

export function startPipelineHealthProbe(
  intervalMs: number = DEFAULT_PROBE_INTERVAL_MS,
  predicate: IsExpectedTradingPredicate | undefined = defaultIsExpectedTrading,
): ProbeHandle {
  const effectivePredicate = predicate ?? defaultIsExpectedTrading;
  if (activeProbe) return activeProbe;
  probeStartedAt = new Date();
  isExpectedTrading = effectivePredicate;
  // Explicit `void` so Node doesn't emit an unhandled-rejection warning
  // if the tick rejects in a way the internal try/finally misses. The
  // re-entrancy guard above already serialises overlapping ticks.
  const timer = setInterval(() => { void runProbeTick(); }, intervalMs);
  timer.unref?.();
  activeProbe = {
    stop: () => {
      clearInterval(timer);
      activeProbe = null;
      probeStartedAt = null;
      isExpectedTrading = defaultIsExpectedTrading;
      tickInFlight = false;
    },
    runOnce: () => { void runProbeTick(); },
    intervalMs,
  };
  logger.info('pipelineHealthProbe started', { intervalMs });
  return activeProbe;
}

export function stopPipelineHealthProbe(): void {
  activeProbe?.stop();
}

/** Exposed for tests. */
export const __internal = { runProbeTick };
