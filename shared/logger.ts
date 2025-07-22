/**
 * Structured JSON Logger
 * Provides centralized logging with consistent formatting
 */

export interface LogContext {
  userId?: string;
  sessionId?: string;
  requestId?: string;
  component?: string;
  action?: string;
  [key: string]: any;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  environment: string;
  version: string;
  userAgent?: string;
  url?: string;
}

class Logger {
  private isDevelopment: boolean;
  private version: string;
  private environment: string;

  constructor() {
    // Determine environment based on available globals
    // Default to development for safety
    this.isDevelopment = true;
    this.version = '1.0.0';
    this.environment = 'development';
    
    // Try to detect environment from various sources
    try {
      // Check if we're in a browser with Vite
      if (typeof window !== 'undefined' && (window as any).__VITE_DEV__) {
        this.isDevelopment = true;
        this.environment = 'development';
      }
      // Check for Node.js production indicators
      else if (typeof globalThis !== 'undefined') {
        const nodeEnv = (globalThis as any).process?.env?.NODE_ENV;
        if (nodeEnv) {
          this.isDevelopment = nodeEnv === 'development';
          this.environment = nodeEnv;
        }
      }
    } catch (e) {
      // Fall back to defaults if environment detection fails
      console.warn('Failed to detect environment, using development defaults');
    }
  }

  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      environment: this.environment,
      version: this.version,
    };

    if (context) {
      entry.context = context;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    // Add browser context in browser environment
    if (typeof window !== 'undefined') {
      entry.userAgent = navigator.userAgent;
      entry.url = window.location.href;
    }

    return entry;
  }

  private logToConsole(entry: LogEntry): void {
    const { level, message, context, error } = entry;
    
    if (this.isDevelopment) {
      // Development: Pretty formatting with colors
      const timestamp = new Date(entry.timestamp).toLocaleTimeString();
      const levelEmoji = {
        debug: '🐛',
        info: 'ℹ️',
        warn: '⚠️',
        error: '❌',
        critical: '🚨'
      }[level];
      
      console.group(`${levelEmoji} [${timestamp}] ${message}`);
      
      if (context) {
        console.log('Context:', context);
      }
      
      if (error) {
        console.error('Error:', error);
      }
      
      console.groupEnd();
    } else {
      // Production: Structured JSON
      console.log(JSON.stringify(entry));
    }
  }

  private async logToServer(entry: LogEntry): Promise<void> {
    // Only log errors and above to server in production
    if (!this.isDevelopment && ['error', 'critical'].includes(entry.level)) {
      try {
        // In a real application, this would send to your logging service
        await fetch('/api/logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(entry),
        });
      } catch (error) {
        // Silently fail - don't create logging loops
        console.error('Failed to log to server:', error);
      }
    }
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    const entry = this.createLogEntry(level, message, context, error);
    
    this.logToConsole(entry);
    this.logToServer(entry);
    
    // Store critical errors in localStorage for debugging
    if (level === 'critical' || level === 'error') {
      try {
        const errorLog = JSON.parse(localStorage.getItem('errorLog') || '[]');
        errorLog.push(entry);
        
        // Keep only last 50 errors
        if (errorLog.length > 50) {
          errorLog.shift();
        }
        
        localStorage.setItem('errorLog', JSON.stringify(errorLog));
      } catch (storageError) {
        console.error('Failed to store error log:', storageError);
      }
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.log('error', message, context, error);
  }

  critical(message: string, error?: Error, context?: LogContext): void {
    this.log('critical', message, context, error);
  }

  // Performance logging
  time(label: string): void {
    if (this.isDevelopment) {
      console.time(label);
    }
  }

  timeEnd(label: string, context?: LogContext): void {
    if (this.isDevelopment) {
      console.timeEnd(label);
    }
    this.info(`Performance: ${label} completed`, context);
  }

  // API request logging
  apiRequest(method: string, url: string, context?: LogContext): void {
    this.info(`API ${method} ${url}`, {
      ...context,
      component: 'api',
      action: 'request',
    });
  }

  apiResponse(method: string, url: string, status: number, duration: number, context?: LogContext): void {
    const level = status >= 400 ? 'error' : status >= 300 ? 'warn' : 'info';
    this.log(level, `API ${method} ${url} ${status} (${duration}ms)`, {
      ...context,
      component: 'api',
      action: 'response',
      status,
      duration,
    });
  }

  // Trading-specific logging
  tradeExecuted(trade: any, context?: LogContext): void {
    this.info('Trade executed', {
      ...context,
      component: 'trading',
      action: 'trade_executed',
      tradeId: trade.id,
      pair: trade.pair,
      side: trade.side,
      amount: trade.amount,
    });
  }

  strategyAction(strategyId: string, action: string, context?: LogContext): void {
    this.info(`Strategy ${action}`, {
      ...context,
      component: 'strategy',
      action,
      strategyId,
    });
  }

  modelPrediction(modelName: string, prediction: any, confidence: number, context?: LogContext): void {
    this.info('Model prediction generated', {
      ...context,
      component: 'ml',
      action: 'prediction',
      modelName,
      prediction,
      confidence,
    });
  }

  // Get stored error logs for debugging
  getErrorLogs(): LogEntry[] {
    try {
      return JSON.parse(localStorage.getItem('errorLog') || '[]');
    } catch (error) {
      return [];
    }
  }

  // Clear stored error logs
  clearErrorLogs(): void {
    localStorage.removeItem('errorLog');
  }
}

// Export singleton instance
export const logger = new Logger();

// Export for testing
export { Logger };