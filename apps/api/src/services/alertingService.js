/**
 * Alerting Service
 * Handles critical alerts for disconnections, order failures, and loss breaches
 */

import { logger } from '../utils/logger.js';

class AlertingService {
  constructor() {
    this.alertThresholds = {
      dailyLoss: 0.15,
      consecutiveFailures: 5,
      disconnectionDuration: 60000
    };
    
    this.alertCounts = {
      disconnections: 0,
      orderRejections: 0,
      lossBreaches: 0,
      pipelineSilent: 0,
      tradeFloorBreaches: 0,
      backtestStalls: 0,
    };

    // Dedupe repeated silent alerts for the same stage in the same window.
    // { stage: lastAlertIsoTimestamp }
    this._silentAlertCooldown = {};
    // 30 min cooldown matches typical on-call acknowledgement window —
    // prevents alert storms without hiding genuine extended outages.
    this._silentAlertCooldownMs = 30 * 60_000;
  }

  /**
   * Send alert for WebSocket disconnection
   * @param {Object} details - Disconnection details
   */
  async alertDisconnection(details) {
    this.alertCounts.disconnections++;
    
    logger.error('ALERT: WebSocket disconnection', {
      alertType: 'disconnection',
      service: details.service,
      code: details.code,
      reason: details.reason,
      duration: details.duration,
      reconnectAttempts: details.reconnectAttempts,
      alertCount: this.alertCounts.disconnections,
      timestamp: new Date().toISOString()
    });
    
    if (details.reconnectAttempts >= this.alertThresholds.consecutiveFailures) {
      this.logCriticalAlert('WebSocket Disconnection - Multiple Reconnect Failures', details);
    }
  }

  /**
   * Send alert for order rejection
   * @param {Object} order - Order that was rejected
   * @param {string} reason - Rejection reason
   */
  async alertOrderRejection(order, reason) {
    this.alertCounts.orderRejections++;
    
    logger.error('ALERT: Order rejected', {
      alertType: 'order_rejection',
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      size: order.size,
      leverage: order.leverage,
      reason: reason,
      alertCount: this.alertCounts.orderRejections,
      timestamp: new Date().toISOString()
    });
    
    this.logCriticalAlert('Order Rejection', { order, reason });
  }

  /**
   * Send alert for loss breach
   * @param {Object} account - Account information
   * @param {Object} loss - Loss details
   */
  async alertLossBreach(account, loss) {
    this.alertCounts.lossBreaches++;
    
    logger.error('ALERT: Loss threshold breached', {
      alertType: 'loss_breach',
      accountId: account.id,
      dailyLoss: loss.daily,
      threshold: this.alertThresholds.dailyLoss,
      accountBalance: account.balance,
      lossPercent: loss.percent,
      alertCount: this.alertCounts.lossBreaches,
      timestamp: new Date().toISOString()
    });
    
    this.logCriticalAlert('Loss Threshold Breach', { account, loss });
  }

  /**
   * Send alert for system error
   * @param {string} service - Service name
   * @param {Error} error - Error object
   */
  async alertSystemError(service, error) {
    logger.error('ALERT: System error', {
      alertType: 'system_error',
      service: service,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    this.logCriticalAlert('System Error', { service, error: error.message });
  }

  /**
   * Send alert for API rate limit
   * @param {Object} details - Rate limit details
   */
  async alertRateLimit(details) {
    logger.warn('ALERT: API rate limit approaching', {
      alertType: 'rate_limit',
      endpoint: details.endpoint,
      remaining: details.remaining,
      resetTime: details.resetTime,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Send alert for insufficient balance
   * @param {Object} account - Account information
   * @param {Object} order - Order that couldn't be placed
   */
  async alertInsufficientBalance(account, order) {
    logger.warn('ALERT: Insufficient balance', {
      alertType: 'insufficient_balance',
      accountId: account.id,
      balance: account.balance,
      required: order.requiredMargin,
      symbol: order.symbol,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log critical alert with special formatting for monitoring
   * @param {string} title - Alert title
   * @param {Object} details - Alert details
   */
  logCriticalAlert(title, details) {
    const alertMessage = {
      level: 'CRITICAL',
      title,
      details,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      hostname: process.env.HOSTNAME || 'unknown'
    };
    
    logger.error('CRITICAL ALERT', alertMessage);

    // Emit structured alert for external consumption.
    // Can be picked up by log aggregation, webhook, or monitoring service.
    this.emitStructuredAlert({
      type: 'critical_alert',
      severity: 'critical',
      message: title,
      metadata: {
        details,
        environment: process.env.NODE_ENV,
        hostname: process.env.HOSTNAME || 'unknown',
      },
    });
  }

  /**
   * Emit a structured alert as JSON for external consumption.
   * Machine-readable format that can be consumed by any log aggregation system
   * (ELK, Datadog, CloudWatch, etc.) or forwarded via webhook.
   * @param {{ type: string, severity: string, message: string, metadata?: Object }} alert
   */
  emitStructuredAlert(alert) {
    logger.error(JSON.stringify({
      alert: true,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      timestamp: new Date().toISOString(),
      service: 'polytrade-api',
      ...(alert.metadata || {}),
    }));
  }

  /**
   * Silent-failure alert: a pipeline stage hasn't ticked in longer than
   * its expected interval. Caught the "0 paper trades for weeks" bug class
   * within minutes instead of weeks.
   *
   * Deduped per-stage on a 30-min cooldown so a single multi-hour outage
   * pages once, not every health-check tick.
   *
   * @param {string} stage - e.g. 'paper', 'live', 'backtest'
   * @param {number} silentMs - how long since last heartbeat
   * @param {number} thresholdMs - configured max silence before alerting
   */
  alertPipelineSilent(stage, silentMs, thresholdMs) {
    const now = Date.now();
    const lastAlert = this._silentAlertCooldown[stage] ?? 0;
    if (now - lastAlert < this._silentAlertCooldownMs) {
      return false;
    }
    this._silentAlertCooldown[stage] = now;
    this.alertCounts.pipelineSilent++;

    logger.error('ALERT: Pipeline stage silent', {
      alertType: 'pipeline_silent',
      stage,
      silentMs,
      thresholdMs,
      silentMinutes: Math.round(silentMs / 60_000),
      alertCount: this.alertCounts.pipelineSilent,
      timestamp: new Date().toISOString(),
    });

    this.logCriticalAlert(`Pipeline Silent: ${stage}`, { stage, silentMs, thresholdMs });
    return true;
  }

  /**
   * Trades-per-hour floor breach: < 1 trade observed in the rolling
   * silent-floor window (default 6h) while the pipeline is supposed to
   * be actively trading. This is the guard that would have caught the
   * "paper mode selected but zero paper trades" state.
   *
   * @param {string} stage - 'paper' | 'live'
   * @param {number} tradesInWindow - trades observed in the window
   * @param {number} windowMinutes - window length
   * @param {string} expectedState - e.g. 'running' (not paused / not paper-only)
   */
  alertTradesFloorBreach(stage, tradesInWindow, windowMinutes, expectedState) {
    const now = Date.now();
    const key = `trades_floor_${stage}`;
    const lastAlert = this._silentAlertCooldown[key] ?? 0;
    if (now - lastAlert < this._silentAlertCooldownMs) {
      return false;
    }
    this._silentAlertCooldown[key] = now;
    this.alertCounts.tradeFloorBreaches++;

    logger.error('ALERT: Trades-per-hour floor breach', {
      alertType: 'trades_floor_breach',
      stage,
      tradesInWindow,
      windowMinutes,
      expectedState,
      alertCount: this.alertCounts.tradeFloorBreaches,
      timestamp: new Date().toISOString(),
    });

    this.logCriticalAlert(`Trades Floor Breach: ${stage}`, {
      stage,
      tradesInWindow,
      windowMinutes,
      expectedState,
    });
    return true;
  }

  /**
   * Backtest-stall alert: the generator has produced N consecutive
   * generations with zero strategies clearing the backtest gate.
   * This is the Option-C blind spot — the trades-floor alert
   * correctly stays silent because nothing is expected to paper-trade
   * yet, but that's only acceptable if the generator is CAPABLE of
   * producing passes. Persistent zero-pass is a generator / gate
   * calibration problem that must page loudly.
   *
   * 30-min cooldown matches the other silent-class alerts.
   *
   * @param {number} consecutiveGenerations - how many zero-pass generations in a row
   * @param {Date|null} lastPassAt - timestamp of the most recent pass, if any
   */
  alertBacktestStall(consecutiveGenerations, lastPassAt) {
    const now = Date.now();
    const key = 'backtest_stall';
    const lastAlert = this._silentAlertCooldown[key] ?? 0;
    if (now - lastAlert < this._silentAlertCooldownMs) {
      return false;
    }
    this._silentAlertCooldown[key] = now;
    this.alertCounts.backtestStalls++;

    logger.error('ALERT: Backtest stall — generator producing no passing strategies', {
      alertType: 'backtest_stall',
      consecutiveGenerations,
      lastPassAt: lastPassAt ? lastPassAt.toISOString() : null,
      alertCount: this.alertCounts.backtestStalls,
      timestamp: new Date().toISOString(),
    });

    this.logCriticalAlert('Backtest Stall', {
      consecutiveGenerations,
      lastPassAt: lastPassAt ? lastPassAt.toISOString() : null,
    });
    return true;
  }

  /**
   * Get alert statistics
   * @returns {Object} Alert counts and stats
   */
  getAlertStats() {
    return {
      counts: { ...this.alertCounts },
      thresholds: { ...this.alertThresholds },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Reset alert counts (useful for testing or daily resets)
   */
  resetAlertCounts() {
    this.alertCounts = {
      disconnections: 0,
      orderRejections: 0,
      lossBreaches: 0,
      pipelineSilent: 0,
      tradeFloorBreaches: 0,
      backtestStalls: 0,
    };
    this._silentAlertCooldown = {};
    logger.info('Alert counts reset', { timestamp: new Date().toISOString() });
  }
}

export default new AlertingService();
