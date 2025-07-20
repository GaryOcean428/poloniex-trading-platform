import { logger } from './logger';
import { MarketData } from '@/types';
import { PortfolioRisk } from './riskManagement';

/**
 * Comprehensive Monitoring and Alerting System for Autonomous Trading
 * Provides real-time monitoring, alerts, and performance tracking
 */

export interface AlertRule {
  id: string;
  name: string;
  type: AlertType;
  condition: AlertCondition;
  enabled: boolean;
  priority: 'low' | 'medium' | 'high' | 'critical';
  cooldownMinutes: number; // Minimum time between alerts
  lastTriggered?: number;
  notificationMethods: NotificationMethod[];
  description: string;
}

export type AlertType = 
  | 'price_movement' 
  | 'portfolio_risk' 
  | 'position_pnl' 
  | 'system_error' 
  | 'trading_signal' 
  | 'market_volatility'
  | 'api_issues'
  | 'performance_degradation';

export interface AlertCondition {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'change_gt' | 'change_lt';
  value: number;
  timeframe?: number; // For change-based conditions (minutes)
}

export type NotificationMethod = 'toast' | 'email' | 'sms' | 'webhook' | 'browser' | 'sound';

export interface Alert {
  id: string;
  ruleId: string;
  timestamp: number;
  title: string;
  message: string;
  priority: AlertRule['priority'];
  type: AlertType;
  data?: any;
  acknowledged: boolean;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
}

export interface PerformanceMetrics {
  timestamp: number;
  // Trading metrics
  totalPnL: number;
  dailyPnL: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  totalTrades: number;
  
  // Risk metrics
  currentDrawdown: number;
  maxDrawdown: number;
  portfolioRisk: number;
  leverageUtilization: number;
  
  // System metrics
  apiLatency: number;
  successRate: number;
  errorRate: number;
  wsConnectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  
  // Market metrics
  volatility: number;
  volume: number;
  spread: number;
}

export interface SystemStatus {
  overall: 'healthy' | 'warning' | 'critical' | 'offline';
  components: {
    trading: 'active' | 'paused' | 'error';
    riskManagement: 'active' | 'warning' | 'error';
    dataFeed: 'connected' | 'delayed' | 'disconnected';
    api: 'operational' | 'degraded' | 'down';
    websocket: 'connected' | 'reconnecting' | 'disconnected';
  };
  lastUpdate: number;
  uptime: number;
  alertsCount: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export class MonitoringSystem {
  private alerts: Alert[] = [];
  private alertRules: Map<string, AlertRule> = new Map();
  private performanceHistory: PerformanceMetrics[] = [];
  private systemStatus: SystemStatus;
  private maxHistoryLength = 1000;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private notificationHandlers: Map<NotificationMethod, (alert: Alert) => Promise<void>> = new Map();
  
  constructor() {
    this.systemStatus = {
      overall: 'healthy',
      components: {
        trading: 'active',
        riskManagement: 'active',
        dataFeed: 'connected',
        api: 'operational',
        websocket: 'connected'
      },
      lastUpdate: Date.now(),
      uptime: 0,
      alertsCount: { critical: 0, high: 0, medium: 0, low: 0 }
    };
    
    this.initializeDefaultRules();
    this.setupNotificationHandlers();
  }

  /**
   * Start monitoring system
   */
  start(): void {
    if (this.monitoringInterval) return;
    
    this.monitoringInterval = setInterval(() => {
      this.updateSystemStatus();
      this.checkAlertRules();
      this.cleanupOldData();
    }, 30000); // Check every 30 seconds
    
    logger.info('Monitoring system started');
  }

  /**
   * Stop monitoring system
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    logger.info('Monitoring system stopped');
  }

  /**
   * Add performance metrics
   */
  addPerformanceMetrics(metrics: PerformanceMetrics): void {
    this.performanceHistory.push({
      ...metrics,
      timestamp: Date.now()
    });
    
    // Keep only recent history
    if (this.performanceHistory.length > this.maxHistoryLength) {
      this.performanceHistory = this.performanceHistory.slice(-this.maxHistoryLength);
    }
    
    this.checkMetricAlerts(metrics);
  }

  /**
   * Update portfolio risk and trigger risk-based alerts
   */
  updatePortfolioRisk(portfolioRisk: PortfolioRisk): void {
    // Check drawdown alerts
    if (portfolioRisk.currentDrawdown > 15) {
      this.triggerAlert('portfolio_risk', {
        title: 'High Drawdown Warning',
        message: `Portfolio drawdown is ${portfolioRisk.currentDrawdown.toFixed(2)}%`,
        data: { drawdown: portfolioRisk.currentDrawdown }
      });
    }
    
    // Check risk concentration
    if (portfolioRisk.totalRiskPercent > 10) {
      this.triggerAlert('portfolio_risk', {
        title: 'Risk Concentration Alert',
        message: `Total portfolio risk is ${portfolioRisk.totalRiskPercent.toFixed(2)}%`,
        data: { totalRisk: portfolioRisk.totalRiskPercent }
      });
    }
    
    // Check correlation risk
    if (portfolioRisk.correlationRisk > 0.8) {
      this.triggerAlert('portfolio_risk', {
        title: 'High Correlation Risk',
        message: `Portfolio correlation risk is ${portfolioRisk.correlationRisk.toFixed(2)}`,
        data: { correlationRisk: portfolioRisk.correlationRisk }
      });
    }
  }

  /**
   * Update market data and trigger price alerts
   */
  updateMarketData(pair: string, data: MarketData): void {
    // Check for significant price movements
    const priceHistory = this.getRecentPrices(pair);
    if (priceHistory.length >= 2) {
      const currentPrice = data.close;
      const previousPrice = priceHistory[priceHistory.length - 2];
      const changePercent = ((currentPrice - previousPrice) / previousPrice) * 100;
      
      if (Math.abs(changePercent) > 5) {
        this.triggerAlert('price_movement', {
          title: 'Significant Price Movement',
          message: `${pair} moved ${changePercent.toFixed(2)}% to $${currentPrice.toFixed(2)}`,
          data: { pair, price: currentPrice, change: changePercent }
        });
      }
    }
    
    // Check volatility
    if (priceHistory.length >= 20) {
      const volatility = this.calculateVolatility(priceHistory);
      if (volatility > 0.05) { // 5% volatility threshold
        this.triggerAlert('market_volatility', {
          title: 'High Market Volatility',
          message: `${pair} volatility is ${(volatility * 100).toFixed(2)}%`,
          data: { pair, volatility }
        });
      }
    }
  }

  /**
   * Log system error and trigger alert
   */
  logError(error: Error, context?: string): void {
    logger.error(`System error: ${error.message}`, context, error instanceof Error ? error : new Error(String(error)));
    
    this.triggerAlert('system_error', {
      title: 'System Error',
      message: `${context || 'Unknown context'}: ${error.message}`,
      data: { error: error.message, context }
    });
    
    this.updateComponentStatus('trading', 'error');
  }

  /**
   * Update API performance metrics
   */
  updateAPIMetrics(latency: number, _success: boolean): void {
    const recentMetrics = this.performanceHistory.slice(-10);
    const avgLatency = recentMetrics.reduce((sum, m) => sum + m.apiLatency, latency) / (recentMetrics.length + 1);
    const successRate = recentMetrics.filter(m => m.successRate > 0.95).length / recentMetrics.length;
    
    if (avgLatency > 5000) { // 5 second threshold
      this.triggerAlert('api_issues', {
        title: 'High API Latency',
        message: `Average API latency is ${avgLatency.toFixed(0)}ms`,
        data: { latency: avgLatency }
      });
    }
    
    if (successRate < 0.9) {
      this.triggerAlert('api_issues', {
        title: 'Low API Success Rate',
        message: `API success rate is ${(successRate * 100).toFixed(1)}%`,
        data: { successRate }
      });
    }
  }

  /**
   * Update WebSocket connection status
   */
  updateWebSocketStatus(status: 'connected' | 'reconnecting' | 'disconnected'): void {
    this.updateComponentStatus('websocket', status);
    
    if (status === 'disconnected') {
      this.triggerAlert('system_error', {
        title: 'WebSocket Disconnected',
        message: 'Real-time data feed has been disconnected',
        data: { component: 'websocket' }
      });
    } else if (status === 'connected') {
      // Clear previous websocket alerts
      this.acknowledgeAlertsByType('system_error');
    }
  }

  /**
   * Add custom alert rule
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    logger.info(`Alert rule added: ${rule.name}`);
  }

  /**
   * Remove alert rule
   */
  removeAlertRule(ruleId: string): void {
    this.alertRules.delete(ruleId);
    logger.info(`Alert rule removed: ${ruleId}`);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return this.alerts.filter(alert => !alert.acknowledged);
  }

  /**
   * Get all alerts with pagination
   */
  getAllAlerts(limit: number = 50, offset: number = 0): Alert[] {
    return this.alerts
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(offset, offset + limit);
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId: string, acknowledgedBy?: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = Date.now();
      alert.acknowledgedBy = acknowledgedBy;
      this.updateAlertsCount();
      return true;
    }
    return false;
  }

  /**
   * Get system status
   */
  getSystemStatus(): SystemStatus {
    return { ...this.systemStatus };
  }

  /**
   * Get performance metrics history
   */
  getPerformanceHistory(hours: number = 24): PerformanceMetrics[] {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    return this.performanceHistory.filter(m => m.timestamp >= cutoff);
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport(hours: number = 24): any {
    const metrics = this.getPerformanceHistory(hours);
    if (metrics.length === 0) return null;
    
    const latest = metrics[metrics.length - 1];
    const oldest = metrics[0];
    
    return {
      period: `${hours} hours`,
      totalPnLChange: latest.totalPnL - oldest.totalPnL,
      avgWinRate: metrics.reduce((sum, m) => sum + m.winRate, 0) / metrics.length,
      avgDrawdown: metrics.reduce((sum, m) => sum + m.currentDrawdown, 0) / metrics.length,
      maxDrawdown: Math.max(...metrics.map(m => m.currentDrawdown)),
      avgLatency: metrics.reduce((sum, m) => sum + m.apiLatency, 0) / metrics.length,
      uptime: (metrics.filter(m => m.successRate > 0.95).length / metrics.length) * 100,
      alertsTriggered: this.alerts.filter(a => a.timestamp >= Date.now() - (hours * 60 * 60 * 1000)).length
    };
  }

  /**
   * Initialize default alert rules
   */
  private initializeDefaultRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high_drawdown',
        name: 'High Drawdown Alert',
        type: 'portfolio_risk',
        condition: { metric: 'currentDrawdown', operator: 'gt', value: 10 },
        enabled: true,
        priority: 'high',
        cooldownMinutes: 60,
        notificationMethods: ['toast', 'email'],
        description: 'Alert when portfolio drawdown exceeds 10%'
      },
      {
        id: 'daily_loss_limit',
        name: 'Daily Loss Limit',
        type: 'portfolio_risk',
        condition: { metric: 'dailyPnL', operator: 'lt', value: -1000 },
        enabled: true,
        priority: 'critical',
        cooldownMinutes: 30,
        notificationMethods: ['toast', 'email', 'sms'],
        description: 'Alert when daily losses exceed $1,000'
      },
      {
        id: 'api_error_rate',
        name: 'High API Error Rate',
        type: 'api_issues',
        condition: { metric: 'errorRate', operator: 'gt', value: 0.1 },
        enabled: true,
        priority: 'medium',
        cooldownMinutes: 15,
        notificationMethods: ['toast'],
        description: 'Alert when API error rate exceeds 10%'
      },
      {
        id: 'large_price_movement',
        name: 'Large Price Movement',
        type: 'price_movement',
        condition: { metric: 'priceChange', operator: 'gt', value: 5 },
        enabled: true,
        priority: 'medium',
        cooldownMinutes: 5,
        notificationMethods: ['toast'],
        description: 'Alert when price moves more than 5% in short time'
      }
    ];
    
    defaultRules.forEach(rule => this.alertRules.set(rule.id, rule));
  }

  /**
   * Setup notification handlers
   */
  private setupNotificationHandlers(): void {
    // Toast notifications
    this.notificationHandlers.set('toast', async (alert: Alert) => {
      // This would integrate with your toast system
      console.log(`Toast: ${alert.title} - ${alert.message}`);
    });
    
    // Browser notifications
    this.notificationHandlers.set('browser', async (alert: Alert) => {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(alert.title, {
          body: alert.message,
          icon: '/favicon.ico',
          tag: alert.id
        });
      }
    });
    
    // Sound notifications
    this.notificationHandlers.set('sound', async (alert: Alert) => {
      if (alert.priority === 'critical' || alert.priority === 'high') {
        // Play alert sound
        try {
          const audio = new Audio('/alert-sound.mp3');
          audio.play().catch(e => console.warn('Could not play alert sound:', e));
        } catch (error) {
          console.warn('Alert sound not available');
        }
      }
    });
    
    // Webhook notifications (placeholder)
    this.notificationHandlers.set('webhook', async (alert: Alert) => {
      // This would send to configured webhook URL
      console.log(`Webhook: ${JSON.stringify(alert)}`);
    });
  }

  /**
   * Trigger an alert
   */
  private triggerAlert(type: AlertType, alertData: { title: string; message: string; data?: any }): void {
    // Check for existing similar alerts to avoid spam
    const recentSimilar = this.alerts.filter(
      a => a.type === type && 
      a.title === alertData.title && 
      a.timestamp > Date.now() - (5 * 60 * 1000) // 5 minutes
    );
    
    if (recentSimilar.length > 0) return;
    
    const alert: Alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ruleId: type,
      timestamp: Date.now(),
      title: alertData.title,
      message: alertData.message,
      priority: this.getPriorityForType(type),
      type,
      data: alertData.data,
      acknowledged: false
    };
    
    this.alerts.push(alert);
    this.updateAlertsCount();
    
    // Send notifications
    this.sendNotifications(alert);
    
    logger.warn(`Alert triggered: ${alert.title}`, 'AlertSystem', undefined, alert);
  }

  /**
   * Check metric-based alerts
   */
  private checkMetricAlerts(metrics: PerformanceMetrics): void {
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled) continue;
      
      // Check cooldown
      if (rule.lastTriggered && 
          Date.now() - rule.lastTriggered < rule.cooldownMinutes * 60 * 1000) {
        continue;
      }
      
      const metricValue = this.getMetricValue(metrics, rule.condition.metric);
      if (metricValue === undefined) continue;
      
      const conditionMet = this.evaluateCondition(metricValue, rule.condition);
      
      if (conditionMet) {
        this.triggerAlert(rule.type, {
          title: rule.name,
          message: `${rule.condition.metric} is ${metricValue} (threshold: ${rule.condition.value})`,
          data: { metric: rule.condition.metric, value: metricValue, threshold: rule.condition.value }
        });
        
        rule.lastTriggered = Date.now();
      }
    }
  }

  /**
   * Send notifications for an alert
   */
  private async sendNotifications(alert: Alert): Promise<void> {
    const rule = this.alertRules.get(alert.ruleId);
    const methods = rule?.notificationMethods || ['toast'];
    
    for (const method of methods) {
      const handler = this.notificationHandlers.get(method);
      if (handler) {
        try {
          await handler(alert);
        } catch (error) {
          logger.error(`Failed to send ${method} notification:`, 'NotificationService', error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
  }

  /**
   * Get priority for alert type
   */
  private getPriorityForType(type: AlertType): AlertRule['priority'] {
    const priorityMap: Record<AlertType, AlertRule['priority']> = {
      'price_movement': 'medium',
      'portfolio_risk': 'high',
      'position_pnl': 'medium',
      'system_error': 'high',
      'trading_signal': 'low',
      'market_volatility': 'medium',
      'api_issues': 'medium',
      'performance_degradation': 'medium'
    };
    
    return priorityMap[type] || 'medium';
  }

  /**
   * Get metric value from performance metrics
   */
  private getMetricValue(metrics: PerformanceMetrics, metricName: string): number | undefined {
    return (metrics as any)[metricName];
  }

  /**
   * Evaluate alert condition
   */
  private evaluateCondition(value: number, condition: AlertCondition): boolean {
    switch (condition.operator) {
      case 'gt': return value > condition.value;
      case 'lt': return value < condition.value;
      case 'eq': return value === condition.value;
      case 'gte': return value >= condition.value;
      case 'lte': return value <= condition.value;
      case 'change_gt':
      case 'change_lt':
        // Would need historical data for change calculations
        return false;
      default: return false;
    }
  }

  /**
   * Update component status
   */
  private updateComponentStatus(component: keyof SystemStatus['components'], status: string): void {
    (this.systemStatus.components as any)[component] = status;
    this.updateOverallStatus();
  }

  /**
   * Update overall system status
   */
  private updateOverallStatus(): void {
    const components = Object.values(this.systemStatus.components);
    
    if (components.some(status => status === 'error' || status === 'down' || status === 'disconnected')) {
      this.systemStatus.overall = 'critical';
    } else if (components.some(status => status === 'warning' || status === 'degraded' || status === 'delayed')) {
      this.systemStatus.overall = 'warning';
    } else {
      this.systemStatus.overall = 'healthy';
    }
    
    this.systemStatus.lastUpdate = Date.now();
  }

  /**
   * Update alerts count
   */
  private updateAlertsCount(): void {
    const activeAlerts = this.getActiveAlerts();
    this.systemStatus.alertsCount = {
      critical: activeAlerts.filter(a => a.priority === 'critical').length,
      high: activeAlerts.filter(a => a.priority === 'high').length,
      medium: activeAlerts.filter(a => a.priority === 'medium').length,
      low: activeAlerts.filter(a => a.priority === 'low').length
    };
  }

  /**
   * Acknowledge alerts by type
   */
  private acknowledgeAlertsByType(type: AlertType): void {
    this.alerts
      .filter(a => a.type === type && !a.acknowledged)
      .forEach(a => {
        a.acknowledged = true;
        a.acknowledgedAt = Date.now();
      });
    
    this.updateAlertsCount();
  }

  /**
   * Update system status periodically
   */
  private updateSystemStatus(): void {
    this.systemStatus.uptime = Date.now() - (this.systemStatus.lastUpdate || Date.now());
    this.systemStatus.lastUpdate = Date.now();
  }

  /**
   * Check all alert rules
   */
  private checkAlertRules(): void {
    if (this.performanceHistory.length > 0) {
      const latestMetrics = this.performanceHistory[this.performanceHistory.length - 1];
      this.checkMetricAlerts(latestMetrics);
    }
  }

  /**
   * Clean up old data
   */
  private cleanupOldData(): void {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
    
    // Clean old alerts
    this.alerts = this.alerts.filter(alert => alert.timestamp >= cutoff);
    
    // Clean old performance data
    this.performanceHistory = this.performanceHistory.filter(
      metrics => metrics.timestamp >= cutoff
    );
  }

  /**
   * Get recent prices for a pair (placeholder - would need actual price storage)
   */
  private getRecentPrices(_pair: string): number[] {
    // This would retrieve recent price history from storage
    // For now, return empty array
    return [];
  }

  /**
   * Calculate volatility from price history
   */
  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    
    const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }
}

/**
 * Global monitoring instance
 */
export const monitoringSystem = new MonitoringSystem();