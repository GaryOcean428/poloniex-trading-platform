/**
 * Logger utility for tracking application events and errors
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

// Configure log levels that should be output
// In production, you might want to set this to ['info', 'warn', 'error']
const activeLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

class Logger {
  private static instance: Logger;
  private logs: LogEntry[] = [];
  private maxLogs = 1000; // Maximum number of logs to keep in memory

  private constructor() {}

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private createLogEntry(level: LogLevel, message: string, data?: any): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      data
    };
  }

  private addLog(entry: LogEntry): void {
    // Add the log to our in-memory store
    this.logs.push(entry);
    
    // Trim logs if they exceed the maximum
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    
    // In a real application, you might want to send logs to a server or service
    if (activeLevels.includes(entry.level)) {
      const { timestamp, level, message, data } = entry;
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
        `[${level.toUpperCase()}] ${timestamp} - ${message}`,
        data ? data : ''
      );
    }
  }

  public debug(message: string, data?: any): void {
    this.addLog(this.createLogEntry('debug', message, data));
  }

  public info(message: string, data?: any): void {
    this.addLog(this.createLogEntry('info', message, data));
  }

  public warn(message: string, data?: any): void {
    this.addLog(this.createLogEntry('warn', message, data));
  }

  public error(message: string, data?: any): void {
    this.addLog(this.createLogEntry('error', message, data));
  }

  public getLogs(level?: LogLevel): LogEntry[] {
    if (level) {
      return this.logs.filter(log => log.level === level);
    }
    return this.logs;
  }

  public clearLogs(): void {
    this.logs = [];
  }
}

export const logger = Logger.getInstance();