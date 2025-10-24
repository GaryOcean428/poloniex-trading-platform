class Logger {
    constructor() {
        this.isDevelopment = true;
        this.version = '1.0.0';
        this.environment = 'development';
        try {
            if (typeof window !== 'undefined' && window.__VITE_DEV__) {
                this.isDevelopment = true;
                this.environment = 'development';
            }
            else if (typeof globalThis !== 'undefined') {
                const nodeEnv = globalThis.process?.env?.NODE_ENV;
                if (nodeEnv) {
                    this.isDevelopment = nodeEnv === 'development';
                    this.environment = nodeEnv;
                }
            }
        }
        catch (e) {
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
        if (typeof window !== 'undefined') {
            entry.userAgent = navigator.userAgent;
            entry.url = window.location.href;
        }
        return entry;
    }
    logToConsole(entry) {
        const { level, message, context, error } = entry;
        if (this.isDevelopment) {
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
            console.log(JSON.stringify(entry));
        }
    }
    async logToServer(entry) {
        if (!this.isDevelopment && ['error', 'critical'].includes(entry.level)) {
            try {
                await fetch('/api/logs', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(entry),
                });
            }
            catch (error) {
                console.error('Failed to log to server:', error);
            }
        }
    }
    log(level, message, context, error) {
        const entry = this.createLogEntry(level, message, context, error);
        this.logToConsole(entry);
        this.logToServer(entry);
        if (level === 'critical' || level === 'error') {
            try {
                const errorLog = JSON.parse(localStorage.getItem('errorLog') || '[]');
                errorLog.push(entry);
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
    getErrorLogs() {
        try {
            return JSON.parse(localStorage.getItem('errorLog') || '[]');
        }
        catch (error) {
            return [];
        }
    }
    clearErrorLogs() {
        localStorage.removeItem('errorLog');
    }
}
export const logger = new Logger();
export { Logger };
