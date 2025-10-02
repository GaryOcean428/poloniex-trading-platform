/**
 * Alerting Service
 * Handles critical alerts for disconnections, order failures, and loss breaches
 */

const { logger } = require('../utils/logger.js');

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
      lossBreaches: 0
    };
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
    
    logger.error('🚨 CRITICAL ALERT 🚨', alertMessage);
    
    // TODO: Send to external monitoring service
    // - Webhook to Slack/Discord: POST to webhook URL
    // - Email notification via SendGrid/AWS SES
    // - PagerDuty/Opsgenie for on-call alerting
    // - Custom webhook for internal monitoring dashboard
    
    // Example Slack webhook integration:
    // if (process.env.SLACK_WEBHOOK_URL) {
    //   await fetch(process.env.SLACK_WEBHOOK_URL, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({
    //       text: `🚨 ${title}`,
    //       attachments: [{ color: 'danger', text: JSON.stringify(details, null, 2) }]
    //     })
    //   });
    // }
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
      lossBreaches: 0
    };
    logger.info('Alert counts reset', { timestamp: new Date().toISOString() });
  }
}

module.exports = new AlertingService();
