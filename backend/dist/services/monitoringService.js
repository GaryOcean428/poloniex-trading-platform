/**
 * Monitoring and Error Tracking Service
 * Tracks errors, performance metrics, and system health
 */
class MonitoringService {
    constructor() {
        this.errorLogs = [];
        this.performanceMetrics = [];
        this.healthMetrics = [];
        this.maxLogsRetention = 1000;
        this.errorCount = 0;
        this.warningCount = 0;
    }
    /**
     * Log an error
     */
    logError(error, context, userId) {
        const errorLog = {
            timestamp: new Date(),
            level: 'error',
            message: error.message,
            stack: error.stack,
            context,
            userId
        };
        this.errorLogs.push(errorLog);
        this.errorCount++;
        this.trimLogs();
        // In production, send to external service (Sentry, LogRocket, etc.)
        if (process.env.NODE_ENV === 'production') {
            this.sendToExternalService(errorLog);
        }
        // Console log for development
        console.error('[ERROR]', error.message, context);
    }
    /**
     * Log a warning
     */
    logWarning(message, context, userId) {
        const warningLog = {
            timestamp: new Date(),
            level: 'warn',
            message,
            context,
            userId
        };
        this.errorLogs.push(warningLog);
        this.warningCount++;
        this.trimLogs();
        console.warn('[WARNING]', message, context);
    }
    /**
     * Log an info message
     */
    logInfo(message, context, userId) {
        const infoLog = {
            timestamp: new Date(),
            level: 'info',
            message,
            context,
            userId
        };
        this.errorLogs.push(infoLog);
        this.trimLogs();
        console.info('[INFO]', message, context);
    }
    /**
     * Track performance metric
     */
    trackPerformance(operation, duration, success, metadata) {
        const metric = {
            timestamp: new Date(),
            operation,
            duration,
            success,
            metadata
        };
        this.performanceMetrics.push(metric);
        this.trimMetrics();
        // Log slow operations
        if (duration > 5000) {
            this.logWarning(`Slow operation detected: ${operation}`, { duration, metadata });
        }
    }
    /**
     * Measure operation performance
     */
    async measurePerformance(operation, fn, metadata) {
        const startTime = Date.now();
        let success = true;
        let result;
        try {
            result = await fn();
            return result;
        }
        catch (error) {
            success = false;
            throw error;
        }
        finally {
            const duration = Date.now() - startTime;
            this.trackPerformance(operation, duration, success, metadata);
        }
    }
    /**
     * Record health metrics
     */
    recordHealthMetrics() {
        const metric = {
            timestamp: new Date(),
            cpu: process.cpuUsage().user / 1000000, // Convert to seconds
            memory: process.memoryUsage().heapUsed / 1024 / 1024, // Convert to MB
            activeConnections: 0, // TODO: Track active connections
            errorRate: this.calculateErrorRate()
        };
        this.healthMetrics.push(metric);
        // Keep only last 100 health metrics
        if (this.healthMetrics.length > 100) {
            this.healthMetrics.shift();
        }
    }
    /**
     * Get recent errors
     */
    getRecentErrors(limit = 50) {
        return this.errorLogs
            .filter(log => log.level === 'error')
            .slice(-limit)
            .reverse();
    }
    /**
     * Get recent warnings
     */
    getRecentWarnings(limit = 50) {
        return this.errorLogs
            .filter(log => log.level === 'warn')
            .slice(-limit)
            .reverse();
    }
    /**
     * Get performance stats
     */
    getPerformanceStats(operation) {
        const metrics = operation
            ? this.performanceMetrics.filter(m => m.operation === operation)
            : this.performanceMetrics;
        if (metrics.length === 0) {
            return null;
        }
        const durations = metrics.map(m => m.duration);
        const successCount = metrics.filter(m => m.success).length;
        return {
            operation: operation || 'all',
            totalCalls: metrics.length,
            successRate: (successCount / metrics.length) * 100,
            avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
            minDuration: Math.min(...durations),
            maxDuration: Math.max(...durations),
            p95Duration: this.calculatePercentile(durations, 95),
            p99Duration: this.calculatePercentile(durations, 99)
        };
    }
    /**
     * Get system health
     */
    getSystemHealth() {
        const recentMetrics = this.healthMetrics.slice(-10);
        if (recentMetrics.length === 0) {
            return {
                status: 'unknown',
                message: 'No health metrics available'
            };
        }
        const avgCpu = recentMetrics.reduce((a, b) => a + b.cpu, 0) / recentMetrics.length;
        const avgMemory = recentMetrics.reduce((a, b) => a + b.memory, 0) / recentMetrics.length;
        const avgErrorRate = recentMetrics.reduce((a, b) => a + b.errorRate, 0) / recentMetrics.length;
        let status = 'healthy';
        const issues = [];
        if (avgCpu > 80) {
            status = 'degraded';
            issues.push('High CPU usage');
        }
        if (avgMemory > 500) {
            status = 'degraded';
            issues.push('High memory usage');
        }
        if (avgErrorRate > 5) {
            status = 'unhealthy';
            issues.push('High error rate');
        }
        return {
            status,
            issues,
            metrics: {
                cpu: avgCpu.toFixed(2),
                memory: avgMemory.toFixed(2),
                errorRate: avgErrorRate.toFixed(2),
                totalErrors: this.errorCount,
                totalWarnings: this.warningCount
            },
            timestamp: new Date()
        };
    }
    /**
     * Get error statistics
     */
    getErrorStats() {
        const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentErrors = this.errorLogs.filter(log => log.timestamp >= last24h && log.level === 'error');
        const errorsByType = {};
        recentErrors.forEach(error => {
            const type = error.message.split(':')[0] || 'Unknown';
            errorsByType[type] = (errorsByType[type] || 0) + 1;
        });
        return {
            total24h: recentErrors.length,
            totalAllTime: this.errorCount,
            errorsByType,
            recentErrors: this.getRecentErrors(10)
        };
    }
    /**
     * Calculate error rate (errors per minute)
     */
    calculateErrorRate() {
        const last5Minutes = new Date(Date.now() - 5 * 60 * 1000);
        const recentErrors = this.errorLogs.filter(log => log.timestamp >= last5Minutes && log.level === 'error');
        return recentErrors.length / 5; // Errors per minute
    }
    /**
     * Calculate percentile
     */
    calculatePercentile(values, percentile) {
        const sorted = values.slice().sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[index] || 0;
    }
    /**
     * Trim old logs
     */
    trimLogs() {
        if (this.errorLogs.length > this.maxLogsRetention) {
            this.errorLogs = this.errorLogs.slice(-this.maxLogsRetention);
        }
    }
    /**
     * Trim old metrics
     */
    trimMetrics() {
        if (this.performanceMetrics.length > this.maxLogsRetention) {
            this.performanceMetrics = this.performanceMetrics.slice(-this.maxLogsRetention);
        }
    }
    /**
     * Send to external monitoring service
     */
    sendToExternalService(errorLog) {
        // TODO: Integrate with Sentry, LogRocket, or other service
        // Example:
        // Sentry.captureException(new Error(errorLog.message), {
        //   extra: errorLog.context,
        //   user: { id: errorLog.userId }
        // });
    }
    /**
     * Start health monitoring
     */
    startHealthMonitoring(intervalMs = 60000) {
        setInterval(() => {
            this.recordHealthMetrics();
        }, intervalMs);
    }
    /**
     * Reset all metrics (for testing)
     */
    reset() {
        this.errorLogs = [];
        this.performanceMetrics = [];
        this.healthMetrics = [];
        this.errorCount = 0;
        this.warningCount = 0;
    }
}
// Singleton instance
export const monitoringService = new MonitoringService();
// Start health monitoring
if (process.env.NODE_ENV !== 'test') {
    monitoringService.startHealthMonitoring();
}
