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
            lossBreaches: 0
        };
    }
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
    async alertRateLimit(details) {
        logger.warn('ALERT: API rate limit approaching', {
            alertType: 'rate_limit',
            endpoint: details.endpoint,
            remaining: details.remaining,
            resetTime: details.resetTime,
            timestamp: new Date().toISOString()
        });
    }
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
    }
    getAlertStats() {
        return {
            counts: { ...this.alertCounts },
            thresholds: { ...this.alertThresholds },
            timestamp: new Date().toISOString()
        };
    }
    resetAlertCounts() {
        this.alertCounts = {
            disconnections: 0,
            orderRejections: 0,
            lossBreaches: 0
        };
        logger.info('Alert counts reset', { timestamp: new Date().toISOString() });
    }
}
export default new AlertingService();
