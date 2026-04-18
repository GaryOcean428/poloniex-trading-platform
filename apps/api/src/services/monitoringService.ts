/**
 * Monitoring and Error Tracking Service
 * Tracks errors, performance metrics, and system health
 */

interface ErrorLog {
  timestamp: Date;
  level: 'error' | 'warn' | 'info';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  userId?: string;
}

interface PerformanceMetric {
  timestamp: Date;
  operation: string;
  duration: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}

interface HealthMetric {
  timestamp: Date;
  cpu: number;
  memory: number;
  activeConnections: number;
  errorRate: number;
}

interface PerformanceStats {
  operation: string;
  totalCalls: number;
  successRate: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  p95Duration: number;
  p99Duration: number;
}

interface SystemHealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  message?: string;
  issues?: string[];
  metrics?: {
    cpu: string;
    memory: string;
    errorRate: string;
    totalErrors: number;
    totalWarnings: number;
  };
  timestamp?: Date;
}

/** Pipeline stage heartbeat — see recordPipelineHeartbeat. */
export type PipelineStage =
  | 'generator'
  | 'backtest'
  | 'paper'
  | 'live'
  | 'reconciliation';

interface PipelineHeartbeat {
  lastSeen: Date;
  tickCount: number;
  tradeCount: number;              // trades (paper or live) recorded since boot
  tradesRing: number[];            // rolling ring buffer, one slot per minute, TRADES_RING_SLOTS long
  ringHead: number;                // index of current minute in ring
  ringMinute: number;              // minute-of-epoch at ringHead
}

/** Expected max silence per stage before a liveness alert fires. */
const STAGE_SILENT_THRESHOLD_MS: Record<PipelineStage, number> = {
  generator: 15 * 60_000,          // new strategies at least every 15 min
  backtest: 10 * 60_000,           // backtest loop ticks more frequently
  paper: 10 * 60_000,              // signal generation cycle
  live: 10 * 60_000,               // live trade cycle
  reconciliation: 10 * 60_000,     // reconciler runs every 5 min, 2x buffer
};

/**
 * Silent-floor alert: < 1 trade in this window triggers.
 * Must be ≤ TRADES_RING_SLOTS or the probe will evaluate against a
 * shorter window than it advertises — Sourcery called this out on
 * the first pass. Keep these two aligned.
 */
export const TRADES_PER_HOUR_FLOOR_WINDOW_MIN = 360;  // 6 hours
export const TRADES_RING_SLOTS = 360;

/**
 * Backtest-pass-rate alert threshold: if this many consecutive SLE
 * generations produce zero passing strategies, something is wrong
 * with the generator or the gates. This is the "Option C blind spot"
 * guard — the trades-floor alert can't catch it because the pipeline
 * is *expected* to be silent when no strategy has ever passed.
 *
 * 20 generations × 30 min cycle interval = 10h before paging.
 */
export const BACKTEST_STALL_THRESHOLD = 20;

interface ErrorStatsReport {
  total24h: number;
  totalAllTime: number;
  errorsByType: Record<string, number>;
  recentErrors: ErrorLog[];
}

class MonitoringService {
  private errorLogs: ErrorLog[] = [];
  private performanceMetrics: PerformanceMetric[] = [];
  private healthMetrics: HealthMetric[] = [];
  private maxLogsRetention = 1000;
  private errorCount = 0;
  private warningCount = 0;
  private activeConnectionCount = 0;
  private pipelineHeartbeats: Map<PipelineStage, PipelineHeartbeat> = new Map();
  /** Count of consecutive SLE generations with zero passing strategies. Reset on any pass. */
  private generationsSinceLastPass = 0;
  /** Most recent generation outcome (pass or fail) — for snapshot UIs. */
  private lastGenerationOutcome: {
    at: Date;
    passed: number;
    total: number;
  } | null = null;
  /**
   * Timestamp of the last generation that produced ≥1 passing
   * strategy. Distinct from lastGenerationOutcome.at (which updates
   * every cycle regardless of outcome). Used by the backtest-stall
   * alert to surface "how long since we last saw a pass?".
   */
  private lastPassAt: Date | null = null;

  /**
   * Log an error
   */
  logError(error: Error, context?: Record<string, unknown>, userId?: string): void {
    const errorLog: ErrorLog = {
      timestamp: new Date(),
      level: 'error',
      message: error.message,
      stack: error.stack,
      context,
      userId
    };

    this.errorLogs.push(errorLog);
    this.errorCount++;
    this.trimLogs();

    // In production, send to external service (Sentry, LogRocket, etc.)
    if (process.env.NODE_ENV === 'production') {
      this.sendToExternalService(errorLog);
    }

    // Console log for development
    console.error('[ERROR]', error.message, context);
  }

  /**
   * Log a warning
   */
  logWarning(message: string, context?: Record<string, unknown>, userId?: string): void {
    const warningLog: ErrorLog = {
      timestamp: new Date(),
      level: 'warn',
      message,
      context,
      userId
    };

    this.errorLogs.push(warningLog);
    this.warningCount++;
    this.trimLogs();

    console.warn('[WARNING]', message, context);
  }

  /**
   * Log an info message
   */
  logInfo(message: string, context?: Record<string, unknown>, userId?: string): void {
    const infoLog: ErrorLog = {
      timestamp: new Date(),
      level: 'info',
      message,
      context,
      userId
    };

    this.errorLogs.push(infoLog);
    this.trimLogs();

    console.info('[INFO]', message, context);
  }

  /**
   * Track performance metric
   */
  trackPerformance(operation: string, duration: number, success: boolean, metadata?: Record<string, unknown>): void {
    const metric: PerformanceMetric = {
      timestamp: new Date(),
      operation,
      duration,
      success,
      metadata
    };

    this.performanceMetrics.push(metric);
    this.trimMetrics();

    // Log slow operations
    if (duration > 5000) {
      this.logWarning(`Slow operation detected: ${operation}`, { duration, metadata });
    }
  }

  /**
   * Measure operation performance
   */
  async measurePerformance<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const startTime = Date.now();
    let success = true;
    let result: T;

    try {
      result = await fn();
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      this.trackPerformance(operation, duration, success, metadata);
    }
  }

  /**
   * Record health metrics
   */
  recordHealthMetrics(): void {
    const metric: HealthMetric = {
      timestamp: new Date(),
      cpu: process.cpuUsage().user / 1000000, // Convert to seconds
      memory: process.memoryUsage().heapUsed / 1024 / 1024, // Convert to MB
      activeConnections: this.activeConnectionCount,
      errorRate: this.calculateErrorRate()
    };

    this.healthMetrics.push(metric);

    // Keep only last 100 health metrics
    if (this.healthMetrics.length > 100) {
      this.healthMetrics.shift();
    }
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 50): ErrorLog[] {
    return this.errorLogs
      .filter(log => log.level === 'error')
      .slice(-limit)
      .reverse();
  }

  /**
   * Get recent warnings
   */
  getRecentWarnings(limit: number = 50): ErrorLog[] {
    return this.errorLogs
      .filter(log => log.level === 'warn')
      .slice(-limit)
      .reverse();
  }

  /**
   * Get performance stats
   */
  getPerformanceStats(operation?: string): PerformanceStats | null {
    const metrics = operation
      ? this.performanceMetrics.filter(m => m.operation === operation)
      : this.performanceMetrics;

    if (metrics.length === 0) {
      return null;
    }

    const durations = metrics.map(m => m.duration);
    const successCount = metrics.filter(m => m.success).length;

    return {
      operation: operation || 'all',
      totalCalls: metrics.length,
      successRate: (successCount / metrics.length) * 100,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      p95Duration: this.calculatePercentile(durations, 95),
      p99Duration: this.calculatePercentile(durations, 99)
    };
  }

  /**
   * Get system health
   */
  getSystemHealth(): SystemHealthReport {
    const recentMetrics = this.healthMetrics.slice(-10);

    if (recentMetrics.length === 0) {
      return {
        status: 'unknown',
        message: 'No health metrics available'
      };
    }

    const avgCpu = recentMetrics.reduce((a, b) => a + b.cpu, 0) / recentMetrics.length;
    const avgMemory = recentMetrics.reduce((a, b) => a + b.memory, 0) / recentMetrics.length;
    const avgErrorRate = recentMetrics.reduce((a, b) => a + b.errorRate, 0) / recentMetrics.length;

    let status: SystemHealthReport['status'] = 'healthy';
    const issues: string[] = [];

    if (avgCpu > 80) {
      status = 'degraded';
      issues.push('High CPU usage');
    }

    if (avgMemory > 500) {
      status = 'degraded';
      issues.push('High memory usage');
    }

    if (avgErrorRate > 5) {
      status = 'unhealthy';
      issues.push('High error rate');
    }

    return {
      status,
      issues,
      metrics: {
        cpu: avgCpu.toFixed(2),
        memory: avgMemory.toFixed(2),
        errorRate: avgErrorRate.toFixed(2),
        totalErrors: this.errorCount,
        totalWarnings: this.warningCount
      },
      timestamp: new Date()
    };
  }

  /**
   * Get error statistics
   */
  getErrorStats(): ErrorStatsReport {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentErrors = this.errorLogs.filter(log =>
      log.timestamp >= last24h && log.level === 'error'
    );

    const errorsByType: { [key: string]: number } = {};
    recentErrors.forEach(error => {
      const type = error.message.split(':')[0] || 'Unknown';
      errorsByType[type] = (errorsByType[type] || 0) + 1;
    });

    return {
      total24h: recentErrors.length,
      totalAllTime: this.errorCount,
      errorsByType,
      recentErrors: this.getRecentErrors(10)
    };
  }

  /**
   * Calculate error rate (errors per minute)
   */
  private calculateErrorRate(): number {
    const last5Minutes = new Date(Date.now() - 5 * 60 * 1000);
    const recentErrors = this.errorLogs.filter(log =>
      log.timestamp >= last5Minutes && log.level === 'error'
    );
    return recentErrors.length / 5; // Errors per minute
  }

  /**
   * Calculate percentile
   */
  private calculatePercentile(values: number[], percentile: number): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }

  /**
   * Trim old logs
   */
  private trimLogs(): void {
    if (this.errorLogs.length > this.maxLogsRetention) {
      this.errorLogs = this.errorLogs.slice(-this.maxLogsRetention);
    }
  }

  /**
   * Trim old metrics
   */
  private trimMetrics(): void {
    if (this.performanceMetrics.length > this.maxLogsRetention) {
      this.performanceMetrics = this.performanceMetrics.slice(-this.maxLogsRetention);
    }
  }

  /**
   * Track active WebSocket/HTTP connections.
   */
  incrementConnections(): void {
    this.activeConnectionCount++;
  }

  decrementConnections(): void {
    this.activeConnectionCount = Math.max(0, this.activeConnectionCount - 1);
  }

  /**
   * Send to external monitoring service.
   * Emits structured JSON for log aggregation pipelines (ELK, Datadog, etc.).
   */
  private sendToExternalService(errorLog: ErrorLog): void {
    this.reportToExternalMonitoring({
      type: 'error_log',
      severity: errorLog.level,
      message: errorLog.message,
      metadata: {
        stack: errorLog.stack,
        context: errorLog.context,
        userId: errorLog.userId,
      },
    });
  }

  /**
   * External monitoring integration.
   * Structured error reporting for log aggregation (ELK, Datadog, etc.).
   */
  private reportToExternalMonitoring(event: {
    type: string;
    severity: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): void {
    // Emit structured JSON for log aggregation pipelines
    console.error(JSON.stringify({
      monitoring_event: true,
      type: event.type,
      severity: event.severity,
      message: event.message,
      timestamp: new Date().toISOString(),
      service: 'polytrade-api',
      metadata: event.metadata ?? {},
    }));
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring(intervalMs: number = 60000): void {
    setInterval(() => {
      this.recordHealthMetrics();
    }, intervalMs);
  }

  /**
   * Record that a pipeline stage executed a tick. Called from each stage's
   * main loop. Silent-failure alerts fire when a stage hasn't reported in
   * longer than its expected interval (see STAGE_SILENT_THRESHOLD_MS).
   */
  recordPipelineHeartbeat(stage: PipelineStage): void {
    const now = new Date();
    const existing = this.pipelineHeartbeats.get(stage);
    if (existing) {
      existing.lastSeen = now;
      existing.tickCount += 1;
    } else {
      this.pipelineHeartbeats.set(stage, {
        lastSeen: now,
        tickCount: 1,
        tradeCount: 0,
        tradesRing: new Array(TRADES_RING_SLOTS).fill(0),
        ringHead: 0,
        ringMinute: Math.floor(now.getTime() / 60_000),
      });
    }
  }

  /**
   * Record a completed trade (paper or live). Feeds the trades-per-hour
   * rolling ring used by the silent-floor alert.
   */
  recordTradeEvent(stage: 'paper' | 'live', now: Date = new Date()): void {
    const hb = this.pipelineHeartbeats.get(stage) ?? this.initStageHeartbeat(stage, now);
    this.advanceTradeRing(hb, now);
    hb.tradesRing[hb.ringHead] += 1;
    hb.tradeCount += 1;
    hb.lastSeen = now;
  }

  /** Trades observed in the rolling last N minutes (max TRADES_RING_SLOTS). */
  getTradesInLastMinutes(stage: 'paper' | 'live', minutes: number, now: Date = new Date()): number {
    const hb = this.pipelineHeartbeats.get(stage);
    if (!hb) return 0;
    this.advanceTradeRing(hb, now);
    const window = Math.max(1, Math.min(TRADES_RING_SLOTS, Math.floor(minutes)));
    let total = 0;
    for (let i = 0; i < window; i++) {
      const idx = (hb.ringHead - i + TRADES_RING_SLOTS) % TRADES_RING_SLOTS;
      total += hb.tradesRing[idx];
    }
    return total;
  }

  /**
   * Which pipeline stages are silent beyond threshold? Used by the alerting
   * service's silent-failure probe.
   *
   * **Never-seen stages are NOT flagged.** A stage is silent only if it
   * has ticked at least once AND has since gone quiet longer than its
   * threshold. Otherwise a freshly-booted server pages on every stage
   * that hasn't yet been wired to call recordPipelineHeartbeat — which
   * is a class of alert that looked like a real outage in production
   * (alertCount:161 over ~16h before being caught).
   *
   * The corresponding boot-time liveness concern ("a stage should have
   * started but never did") is covered by the backend heartbeat emitted
   * from index.ts, not by this probe.
   */
  getSilentPipelineStages(now: Date = new Date()): Array<{
    stage: PipelineStage;
    silentMs: number;
    thresholdMs: number;
  }> {
    const silent: Array<{ stage: PipelineStage; silentMs: number; thresholdMs: number }> = [];
    for (const stage of Object.keys(STAGE_SILENT_THRESHOLD_MS) as PipelineStage[]) {
      const hb = this.pipelineHeartbeats.get(stage);
      if (!hb) continue;  // never reported — not silent, just unwired
      const thresholdMs = STAGE_SILENT_THRESHOLD_MS[stage];
      const silentMs = now.getTime() - hb.lastSeen.getTime();
      if (silentMs > thresholdMs) {
        silent.push({ stage, silentMs, thresholdMs });
      }
    }
    return silent;
  }

  /** Snapshot of all pipeline heartbeats for UI / status endpoints. */
  getPipelineHeartbeatSnapshot(now: Date = new Date()): Array<{
    stage: PipelineStage;
    lastSeenAt: string | null;
    silentMs: number | null;
    thresholdMs: number;
    tickCount: number;
    tradeCount: number;
    tradesPerHour: number;
  }> {
    return (Object.keys(STAGE_SILENT_THRESHOLD_MS) as PipelineStage[]).map((stage) => {
      const hb = this.pipelineHeartbeats.get(stage);
      return {
        stage,
        lastSeenAt: hb ? hb.lastSeen.toISOString() : null,
        silentMs: hb ? now.getTime() - hb.lastSeen.getTime() : null,
        thresholdMs: STAGE_SILENT_THRESHOLD_MS[stage],
        tickCount: hb?.tickCount ?? 0,
        tradeCount: hb?.tradeCount ?? 0,
        tradesPerHour: hb ? this.sumRing(hb, now) : 0,
      };
    });
  }

  /** Constant exposed for tests / alerting config. */
  getTradesPerHourFloorWindowMinutes(): number {
    return TRADES_PER_HOUR_FLOOR_WINDOW_MIN;
  }

  /**
   * Record the outcome of one SLE generation. `passed` is how many of
   * `total` generated strategies cleared the backtest gate. Maintains
   * the `generationsSinceLastPass` counter that the probe reads.
   */
  recordGenerationOutcome(passed: number, total: number, at: Date = new Date()): void {
    this.lastGenerationOutcome = { at, passed, total };
    if (passed > 0) {
      this.generationsSinceLastPass = 0;
      this.lastPassAt = at;
    } else {
      this.generationsSinceLastPass += 1;
    }
  }

  /** Consecutive SLE generations with zero passing strategies. */
  getGenerationsSinceLastPass(): number {
    return this.generationsSinceLastPass;
  }

  /** Most recent generation outcome snapshot for UI / status endpoints. */
  getLastGenerationOutcome(): { at: Date; passed: number; total: number } | null {
    return this.lastGenerationOutcome;
  }

  /** Timestamp of the last generation that produced ≥1 passing strategy, or null. */
  getLastPassAt(): Date | null {
    return this.lastPassAt;
  }

  getBacktestStallThreshold(): number {
    return BACKTEST_STALL_THRESHOLD;
  }

  private initStageHeartbeat(stage: PipelineStage, now: Date): PipelineHeartbeat {
    const hb: PipelineHeartbeat = {
      lastSeen: now,
      tickCount: 0,
      tradeCount: 0,
      tradesRing: new Array(TRADES_RING_SLOTS).fill(0),
      ringHead: 0,
      ringMinute: Math.floor(now.getTime() / 60_000),
    };
    this.pipelineHeartbeats.set(stage, hb);
    return hb;
  }

  /**
   * Rotate the trades ring forward to the current minute, zeroing any
   * slots we pass through (those minutes had no trades).
   */
  private advanceTradeRing(hb: PipelineHeartbeat, now: Date): void {
    const currentMinute = Math.floor(now.getTime() / 60_000);
    const delta = currentMinute - hb.ringMinute;
    if (delta <= 0) return;
    const steps = Math.min(delta, TRADES_RING_SLOTS);
    for (let i = 0; i < steps; i++) {
      hb.ringHead = (hb.ringHead + 1) % TRADES_RING_SLOTS;
      hb.tradesRing[hb.ringHead] = 0;
    }
    hb.ringMinute = currentMinute;
  }

  private sumRing(hb: PipelineHeartbeat, now: Date): number {
    this.advanceTradeRing(hb, now);
    return hb.tradesRing.reduce((a, b) => a + b, 0);
  }

  /**
   * Reset all metrics (for testing)
   */
  reset(): void {
    this.errorLogs = [];
    this.performanceMetrics = [];
    this.healthMetrics = [];
    this.errorCount = 0;
    this.warningCount = 0;
    this.activeConnectionCount = 0;
    this.pipelineHeartbeats = new Map();
    this.generationsSinceLastPass = 0;
    this.lastGenerationOutcome = null;
    this.lastPassAt = null;
  }
}

// Singleton instance
export const monitoringService = new MonitoringService();

// Start health monitoring
if (process.env.NODE_ENV !== 'test') {
  monitoringService.startHealthMonitoring();
}
