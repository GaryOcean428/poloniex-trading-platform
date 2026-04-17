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

type ProbeHandle = {
  stop: () => void;
  runOnce: () => void;
  readonly intervalMs: number;
};

let activeProbe: ProbeHandle | null = null;
/** First-observed tick timestamp — used to avoid firing trades-floor alerts before the system has been up long enough to produce trades. */
let probeStartedAt: Date | null = null;

/**
 * Decide whether a trades-floor alert is appropriate given current state.
 * We only page when the generator or backtest stage has been alive long
 * enough that paper trades *should* have fired by now.
 */
function shouldEvaluateTradesFloor(now: Date): boolean {
  if (!probeStartedAt) return false;
  const uptimeMs = now.getTime() - probeStartedAt.getTime();
  const windowMs = monitoringService.getTradesPerHourFloorWindowMinutes() * 60_000;
  return uptimeMs >= windowMs;
}

function runProbeTick(now: Date = new Date()): void {
  try {
    const silentStages = monitoringService.getSilentPipelineStages(now);
    for (const { stage, silentMs, thresholdMs } of silentStages) {
      alertingService.alertPipelineSilent(stage as PipelineStage, silentMs, thresholdMs);
    }

    if (!shouldEvaluateTradesFloor(now)) return;

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
  }
}

export function startPipelineHealthProbe(
  intervalMs: number = DEFAULT_PROBE_INTERVAL_MS,
): ProbeHandle {
  if (activeProbe) return activeProbe;
  probeStartedAt = new Date();
  const timer = setInterval(() => runProbeTick(), intervalMs);
  timer.unref?.();
  activeProbe = {
    stop: () => {
      clearInterval(timer);
      activeProbe = null;
      probeStartedAt = null;
    },
    runOnce: () => runProbeTick(),
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
