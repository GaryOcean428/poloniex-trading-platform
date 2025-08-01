/**
 * Structured logging service for the trading platform
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  service?: string;
  component?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel;

  private constructor() {
    this.logLevel = (import.meta.env.VITE_LOG_LEVEL as LogLevel) || 'info';
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level] >= levels[this.logLevel];
  }

  public log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      context: {
        ...context,
        service: context?.service || 'frontend',
      },
    };

    // In production, this could send to a logging service
    if (import.meta.env.MODE === 'production') {
      console[level](JSON.stringify(logEntry));
    } else {
      console[level](`[${timestamp}] [${level.toUpperCase()}] ${message}`, context ? JSON.stringify(context.metadata || {}) : '');
    }
  }

  public debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  public info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  public warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  public error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }
}

export const logger = Logger.getInstance();
export default logger;
