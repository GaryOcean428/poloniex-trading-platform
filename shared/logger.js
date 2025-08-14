"use strict";
/**
 * Structured JSON Logger
 * Provides centralized logging with consistent formatting
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.logger = void 0;
class Logger {
    constructor() {
        // Determine environment based on available globals
        // Default to development for safety
        this.isDevelopment = true;
        this.version = '1.0.0';
        this.environment = 'development';
        // Try to detect environment from various sources
        try {
            // Check if we're in a browser with Vite
            if (typeof window !== 'undefined' && window.__VITE_DEV__) {
                this.isDevelopment = true;
                this.environment = 'development';
            }
            // Check for Node.js production indicators
            else if (typeof globalThis !== 'undefined') {
                const nodeEnv = globalThis.process?.env?.NODE_ENV;
                if (nodeEnv) {
                    this.isDevelopment = nodeEnv === 'development';
                    this.environment = nodeEnv;
                }
            }
        }
        catch (e) {
            // Fall back to defaults if environment detection fails
            console.warn('Failed to detect environment, using development defaults');
        }
    }
    createLogEntry(level, message, context, error) {
        const entry = {
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
    logToConsole(entry) {
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
        }
        else {
            // Production: Structured JSON
            console.log(JSON.stringify(entry));
        }
    }
    async logToServer(entry) {
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
            }
            catch (error) {
                // Silently fail - don't create logging loops
                console.error('Failed to log to server:', error);
            }
        }
    }
    log(level, message, context, error) {
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
            }
            catch (storageError) {
                console.error('Failed to store error log:', storageError);
            }
        }
    }
    debug(message, context) {
        this.log('debug', message, context);
    }
    info(message, context) {
        this.log('info', message, context);
    }
    warn(message, context) {
        this.log('warn', message, context);
    }
    error(message, error, context) {
        this.log('error', message, context, error);
    }
    critical(message, error, context) {
        this.log('critical', message, context, error);
    }
    // Performance logging
    time(label) {
        if (this.isDevelopment) {
            console.time(label);
        }
    }
    timeEnd(label, context) {
        if (this.isDevelopment) {
            console.timeEnd(label);
        }
        this.info(`Performance: ${label} completed`, context);
    }
    // API request logging
    apiRequest(method, url, context) {
        this.info(`API ${method} ${url}`, {
            ...context,
            component: 'api',
            action: 'request',
        });
    }
    apiResponse(method, url, status, duration, context) {
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
    tradeExecuted(trade, context) {
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
    strategyAction(strategyId, action, context) {
        this.info(`Strategy ${action}`, {
            ...context,
            component: 'strategy',
            action,
            strategyId,
        });
    }
    modelPrediction(modelName, prediction, confidence, context) {
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
    getErrorLogs() {
        try {
            return JSON.parse(localStorage.getItem('errorLog') || '[]');
        }
        catch (error) {
            return [];
        }
    }
    // Clear stored error logs
    clearErrorLogs() {
        localStorage.removeItem('errorLog');
    }
}
exports.Logger = Logger;
// Export singleton instance
exports.logger = new Logger();
