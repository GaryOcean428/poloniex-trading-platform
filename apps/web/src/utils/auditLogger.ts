/**
 * Audit Logger
 * Logs security-critical events for compliance and monitoring
 */

import { logger } from './logger';

export enum AuditEventType {
  // Authentication Events
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  LOGOUT = 'LOGOUT',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  
  // API Credentials Events
  API_KEY_CREATED = 'API_KEY_CREATED',
  API_KEY_UPDATED = 'API_KEY_UPDATED',
  API_KEY_DELETED = 'API_KEY_DELETED',
  API_KEY_TEST_SUCCESS = 'API_KEY_TEST_SUCCESS',
  API_KEY_TEST_FAILURE = 'API_KEY_TEST_FAILURE',
  
  // Trading Events
  TRADE_EXECUTED = 'TRADE_EXECUTED',
  TRADE_FAILED = 'TRADE_FAILED',
  ORDER_PLACED = 'ORDER_PLACED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  
  // Autonomous Agent Events
  AGENT_STARTED = 'AGENT_STARTED',
  AGENT_STOPPED = 'AGENT_STOPPED',
  AGENT_MODE_CHANGED = 'AGENT_MODE_CHANGED', // Paper <-> Live
  AGENT_CONFIG_CHANGED = 'AGENT_CONFIG_CHANGED',
  
  // Strategy Events
  STRATEGY_CREATED = 'STRATEGY_CREATED',
  STRATEGY_UPDATED = 'STRATEGY_UPDATED',
  STRATEGY_DELETED = 'STRATEGY_DELETED',
  STRATEGY_DEPLOYED = 'STRATEGY_DEPLOYED',
  
  // Risk Events
  RISK_LIMIT_EXCEEDED = 'RISK_LIMIT_EXCEEDED',
  STOP_LOSS_TRIGGERED = 'STOP_LOSS_TRIGGERED',
  TAKE_PROFIT_TRIGGERED = 'TAKE_PROFIT_TRIGGERED',
  MAX_DRAWDOWN_REACHED = 'MAX_DRAWDOWN_REACHED',
  
  // Configuration Events
  SETTINGS_CHANGED = 'SETTINGS_CHANGED',
  PERMISSIONS_CHANGED = 'PERMISSIONS_CHANGED',
  
  // Security Events
  UNAUTHORIZED_ACCESS_ATTEMPT = 'UNAUTHORIZED_ACCESS_ATTEMPT',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  IP_WHITELIST_VIOLATION = 'IP_WHITELIST_VIOLATION'
}

export interface AuditLogEntry {
  eventType: AuditEventType;
  timestamp: string;
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  details: Record<string, unknown>;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
}

class AuditLogger {
  private logs: AuditLogEntry[] = [];
  private maxLogsInMemory = 1000;
  private backendUrl: string;

  constructor() {
    this.backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:8765';
  }

  /**
   * Log an audit event
   */
  async log(
    eventType: AuditEventType,
    details: Record<string, unknown> = {},
    severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' = 'INFO'
  ): Promise<void> {
    const entry: AuditLogEntry = {
      eventType,
      timestamp: new Date().toISOString(),
      userId: this.getUserId(),
      sessionId: this.getSessionId(),
      ipAddress: await this.getIPAddress(),
      userAgent: navigator.userAgent,
      details,
      severity
    };

    // Store in memory
    this.logs.push(entry);
    if (this.logs.length > this.maxLogsInMemory) {
      this.logs.shift(); // Remove oldest
    }

    // Log to console in development
    if (import.meta.env.DEV) {
      // console.log(`[AUDIT] ${eventType}:`, entry);
    }

    // Log using standard logger
    logger.info(`Audit: ${eventType}`, entry);

    // Send to backend (fire and forget)
    this.sendToBackend(entry).catch((_error) => {
      // console.error('Failed to send audit log to backend:', error);
    });
  }

  /**
   * Log authentication events
   */
  async logAuth(
    eventType: AuditEventType.LOGIN_SUCCESS | AuditEventType.LOGIN_FAILURE | AuditEventType.LOGOUT,
    details: Record<string, unknown> = {}
  ): Promise<void> {
    const severity = eventType === AuditEventType.LOGIN_FAILURE ? 'WARNING' : 'INFO';
    await this.log(eventType, details, severity);
  }

  /**
   * Log API credential events
   */
  async logApiCredentials(
    eventType: AuditEventType,
    credentialName: string,
    details: Record<string, unknown> = {}
  ): Promise<void> {
    await this.log(eventType, {
      credentialName,
      ...details
    }, 'INFO');
  }

  /**
   * Log trading events
   */
  async logTrade(
    eventType: AuditEventType,
    symbol: string,
    side: string,
    quantity: number,
    price?: number,
    details: Record<string, unknown> = {}
  ): Promise<void> {
    await this.log(eventType, {
      symbol,
      side,
      quantity,
      price,
      ...details
    }, 'INFO');
  }

  /**
   * Log autonomous agent events
   */
  async logAgent(
    eventType: AuditEventType,
    mode: 'PAPER' | 'LIVE',
    details: Record<string, unknown> = {}
  ): Promise<void> {
    const severity = mode === 'LIVE' ? 'WARNING' : 'INFO';
    await this.log(eventType, {
      mode,
      ...details
    }, severity);
  }

  /**
   * Log risk events
   */
  async logRisk(
    eventType: AuditEventType,
    details: Record<string, unknown> = {}
  ): Promise<void> {
    await this.log(eventType, details, 'WARNING');
  }

  /**
   * Log security events
   */
  async logSecurity(
    eventType: AuditEventType,
    details: Record<string, unknown> = {}
  ): Promise<void> {
    await this.log(eventType, details, 'CRITICAL');
  }

  /**
   * Get recent logs
   */
  getRecentLogs(count: number = 100): AuditLogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * Get logs by event type
   */
  getLogsByType(eventType: AuditEventType): AuditLogEntry[] {
    return this.logs.filter(log => log.eventType === eventType);
  }

  /**
   * Get logs by severity
   */
  getLogsBySeverity(severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'): AuditLogEntry[] {
    return this.logs.filter(log => log.severity === severity);
  }

  /**
   * Clear logs from memory
   */
  clearLogs(): void {
    this.logs = [];
  }

  // Private helper methods

  private getUserId(): string | undefined {
    try {
      const token = localStorage.getItem('accessToken');
      if (token) {
        const parts = token.split('.');
        if (parts.length >= 2 && parts[1]) {
          const payload = JSON.parse(atob(parts[1]));
          return payload.userId || payload.sub;
        }
      }
    } catch {
      // Ignore errors
    }
    return undefined;
  }

  private getSessionId(): string | undefined {
    let sessionId = sessionStorage.getItem('sessionId');
    if (!sessionId) {
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('sessionId', sessionId);
    }
    return sessionId;
  }

  private async getIPAddress(): Promise<string | undefined> {
    try {
      const response = await fetch('https://api.ipify.org?format=json', {
        signal: AbortSignal.timeout(2000) // 2 second timeout
      });
      const data = await response.json();
      return data.ip;
    } catch {
      return undefined;
    }
  }

  private async sendToBackend(entry: AuditLogEntry): Promise<void> {
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      await fetch(`${this.backendUrl}/api/audit/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(entry),
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
    } catch (_error) {
      // Silently fail - audit logs shouldn't break the app
      // console.debug('Audit log backend send failed:', error);
    }
  }
}

// Export singleton instance
export const auditLogger = new AuditLogger();
