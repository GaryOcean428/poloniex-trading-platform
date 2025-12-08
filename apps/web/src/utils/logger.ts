/**
 * Centralized logging utility for the application
 * Provides structured logging with different levels and proper error handling
 */

 

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  error?: Error;
  data?: unknown;
}

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG';

  private constructor() {}

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
    const levels: Record<LogLevel, number> = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
      FATAL: 4,
    };
    return levels[level] >= levels[this.logLevel];
  }

  private createLogEntry(level: LogLevel, message: string, context?: string, error?: Error, data?: unknown): LogEntry {
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
      error,
      data,
    };
  }

  private formatLogEntry(entry: LogEntry): string {
    const { level, message, timestamp, context, error } = entry;
    const contextStr = context ? `[${context}] ` : '';
    const errorStr = error ? `\nError: ${error.stack || error.message}` : '';
    return `[${timestamp}] [${level}] ${contextStr}${message}${errorStr}`;
  }

  private logToConsole(entry: LogEntry): void {
    const formatted = this.formatLogEntry(entry);

    switch (entry.level) {
      case 'DEBUG':
        // console.debug(formatted);
        break;
      case 'INFO':
        // console.info(formatted);
        break;
      case 'WARN':
        // console.warn(formatted);
        break;
      case 'ERROR':
      case 'FATAL':
        // console.error(formatted);
        break;
    }
  }

  public debug(message: string, contextOrData?: string | object, data?: unknown): void {
    if (this.shouldLog('DEBUG')) {
      const context = typeof contextOrData === 'string' ? contextOrData : undefined;
      const logData = typeof contextOrData === 'object' ? contextOrData : data;
      const entry = this.createLogEntry('DEBUG', message, context, undefined, logData);
      this.logToConsole(entry);
    }
  }

  public info(message: string, contextOrData?: string | object, data?: unknown): void {
    if (this.shouldLog('INFO')) {
      const context = typeof contextOrData === 'string' ? contextOrData : undefined;
      const logData = typeof contextOrData === 'object' ? contextOrData : data;
      const entry = this.createLogEntry('INFO', message, context, undefined, logData);
      this.logToConsole(entry);
    }
  }

  public warn(message: string, contextOrData?: string | object, error?: Error, data?: unknown): void {
    if (this.shouldLog('WARN')) {
      const context = typeof contextOrData === 'string' ? contextOrData : undefined;
      const logData = typeof contextOrData === 'object' ? contextOrData : data;
      const entry = this.createLogEntry('WARN', message, context, error, logData);
      this.logToConsole(entry);
    }
  }

  public error(message: string, contextOrData?: string | object, error?: Error, data?: unknown): void {
    if (this.shouldLog('ERROR')) {
      const context = typeof contextOrData === 'string' ? contextOrData : undefined;
      const logData = typeof contextOrData === 'object' ? contextOrData : data;
      const entry = this.createLogEntry('ERROR', message, context, error, logData);
      this.logToConsole(entry);
    }
  }

  public fatal(message: string, contextOrData?: string | object, error?: Error, data?: unknown): void {
    if (this.shouldLog('FATAL')) {
      const context = typeof contextOrData === 'string' ? contextOrData : undefined;
      const logData = typeof contextOrData === 'object' ? contextOrData : data;
      const entry = this.createLogEntry('FATAL', message, context, error, logData);
      this.logToConsole(entry);
    }
  }
}

export const logger = Logger.getInstance();
