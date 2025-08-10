import React from "react";

/**
 * Enhanced Error Handling and Graceful Degradation System
 * Provides comprehensive error recovery, circuit breakers, and fallback mechanisms
 */

export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export enum ErrorCategory {
  NETWORK = "network",
  API = "api",
  AUTHENTICATION = "authentication",
  VALIDATION = "validation",
  TRADING = "trading",
  SYSTEM = "system",
  USER = "user",
}

export interface ErrorContext {
  component: string;
  action: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
  timestamp: number;
  userAgent: string;
  url: string;
}

export interface ErrorInfo {
  id: string;
  message: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  context: ErrorContext;
  stack?: string;
  originalError?: Error;
  retryCount: number;
  maxRetries: number;
  isRecoverable: boolean;
  recoveryActions: string[];
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
  minimumRequests: number;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface FallbackConfig {
  enableMockData: boolean;
  enableCachedData: boolean;
  enableReducedFunctionality: boolean;
  gracefulDegradation: boolean;
}

export class EnhancedError extends Error {
  public readonly id: string;
  public readonly severity: ErrorSeverity;
  public readonly category: ErrorCategory;
  public readonly context: ErrorContext;
  public readonly isRecoverable: boolean;
  public readonly recoveryActions: string[];
  public retryCount: number = 0;
  public maxRetries: number;

  constructor(
    message: string,
    severity: ErrorSeverity,
    category: ErrorCategory,
    context: ErrorContext,
    isRecoverable: boolean = true,
    recoveryActions: string[] = [],
    maxRetries: number = 3
  ) {
    super(message);
    this.name = "EnhancedError";
    this.id = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.severity = severity;
    this.category = category;
    this.context = context;
    this.isRecoverable = isRecoverable;
    this.recoveryActions = recoveryActions;
    this.maxRetries = maxRetries;
  }

  toJSON(): ErrorInfo {
    return {
      id: this.id,
      message: this.message,
      severity: this.severity,
      category: this.category,
      context: this.context,
      stack: this.stack,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      isRecoverable: this.isRecoverable,
      recoveryActions: this.recoveryActions,
    };
  }
}

export class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private requestCount = 0;
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeout) {
        this.state = "HALF_OPEN";
        this.successCount = 0;
      } else {
        throw new EnhancedError(
          "Circuit breaker is OPEN",
          ErrorSeverity.HIGH,
          ErrorCategory.SYSTEM,
          this.createContext("circuit_breaker"),
          false,
          ["Wait for circuit breaker to reset"]
        );
      }
    }

    this.requestCount++;

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= 3) {
        // Require multiple successes to close
        this.state = "CLOSED";
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (
      this.requestCount >= this.config.minimumRequests &&
      this.getFailureRate() >= this.config.failureThreshold
    ) {
      this.state = "OPEN";
    }
  }

  private getFailureRate(): number {
    return this.failureCount / this.requestCount;
  }

  private createContext(action: string): ErrorContext {
    return {
      component: "circuit_breaker",
      action,
      timestamp: Date.now(),
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      url: typeof window !== "undefined" ? window.location.href : "unknown",
    };
  }

  getState(): string {
    return this.state;
  }

  getMetrics() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      requestCount: this.requestCount,
      failureRate: this.getFailureRate(),
    };
  }
}

export class ErrorHandler {
  private errors: ErrorInfo[] = [];
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private retryConfigs: Map<string, RetryConfig> = new Map();
  private fallbackConfig: FallbackConfig;
  private errorListeners: Set<(error: ErrorInfo) => void> = new Set();
  private maxErrorHistory = 1000;

  constructor(fallbackConfig?: Partial<FallbackConfig>) {
    this.fallbackConfig = {
      enableMockData: true,
      enableCachedData: true,
      enableReducedFunctionality: true,
      gracefulDegradation: true,
      ...fallbackConfig,
    };

    this.setupDefaultConfigs();
    this.setupGlobalErrorHandling();
  }

  /**
   * Handle an error with recovery attempts
   */
  async handleError<T>(
    error: Error | EnhancedError,
    context: Partial<ErrorContext>,
    operation?: () => Promise<T>
  ): Promise<T | null> {
    const enhancedError = this.enhanceError(error, context);
    this.logError(enhancedError);

    // Attempt recovery if the error is recoverable and we have an operation
    if (
      enhancedError.isRecoverable &&
      operation &&
      enhancedError.retryCount < enhancedError.maxRetries
    ) {
      return this.attemptRecovery(enhancedError, operation);
    }

    // Apply fallback strategies
    return this.applyFallback(enhancedError);
  }

  /**
   * Create a circuit breaker for a specific operation
   */
  createCircuitBreaker(
    name: string,
    config?: Partial<CircuitBreakerConfig>
  ): CircuitBreaker {
    const defaultConfig: CircuitBreakerConfig = {
      failureThreshold: 0.5,
      resetTimeout: 60000,
      monitoringPeriod: 10000,
      minimumRequests: 5,
    };

    const circuitBreaker = new CircuitBreaker({ ...defaultConfig, ...config });
    this.circuitBreakers.set(name, circuitBreaker);
    return circuitBreaker;
  }

  /**
   * Get circuit breaker by name
   */
  getCircuitBreaker(name: string): CircuitBreaker | undefined {
    return this.circuitBreakers.get(name);
  }

  /**
   * Configure retry settings for an operation type
   */
  configureRetry(operationType: string, config: Partial<RetryConfig>): void {
    const defaultConfig: RetryConfig = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      retryableErrors: [
        "NetworkError",
        "TimeoutError",
        "PoloniexConnectionError",
      ],
    };

    this.retryConfigs.set(operationType, { ...defaultConfig, ...config });
  }

  /**
   * Execute operation with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationType: string,
    context: Partial<ErrorContext>
  ): Promise<T> {
    const retryConfig =
      this.retryConfigs.get(operationType) || this.retryConfigs.get("default");
    let lastError: Error;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        if (
          !this.isRetryableError(error as Error, retryConfig.retryableErrors)
        ) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === retryConfig.maxAttempts) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          retryConfig.baseDelay *
            Math.pow(retryConfig.backoffMultiplier, attempt - 1),
          retryConfig.maxDelay
        );

        await this.sleep(delay);
      }
    }

    // All retries failed
    throw this.enhanceError(lastError, {
      ...context,
      action: `${context.action}_retry_exhausted`,
      metadata: { attempts: retryConfig.maxAttempts },
    });
  }

  /**
   * Add error listener
   */
  addErrorListener(listener: (error: ErrorInfo) => void): void {
    this.errorListeners.add(listener);
  }

  /**
   * Remove error listener
   */
  removeErrorListener(listener: (error: ErrorInfo) => void): void {
    this.errorListeners.delete(listener);
  }

  /**
   * Get error history
   */
  getErrorHistory(limit?: number): ErrorInfo[] {
    const errors = this.errors.sort(
      (a, b) => b.context.timestamp - a.context.timestamp
    );
    return limit ? errors.slice(0, limit) : errors;
  }

  /**
   * Get error statistics
   */
  getErrorStats(timeWindow?: number): unknown {
    const cutoff = timeWindow ? Date.now() - timeWindow : 0;
    const relevantErrors = this.errors.filter(
      (e) => e.context.timestamp >= cutoff
    );

    const stats = {
      total: relevantErrors.length,
      bySeverity: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
      errorRate: 0,
      mostCommon: "",
      recoverableCount: 0,
    };

    relevantErrors.forEach((error) => {
      stats.bySeverity[error.severity] =
        (stats.bySeverity[error.severity] || 0) + 1;
      stats.byCategory[error.category] =
        (stats.byCategory[error.category] || 0) + 1;
      if (error.isRecoverable) {
        stats.recoverableCount++;
      }
    });

    // Find most common error
    const categoryEntries = Object.entries(stats.byCategory);
    if (categoryEntries.length > 0) {
      stats.mostCommon = categoryEntries.reduce((a, b) =>
        a[1] > b[1] ? a : b
      )[0];
    }

    return stats;
  }

  /**
   * Clear error history
   */
  clearErrorHistory(): void {
    this.errors = [];
  }

  /**
   * Create a safe wrapper for async operations
   */
  createSafeWrapper<T extends (...args: unknown[]) => Promise<any>>(
    operation: T,
    context: Partial<ErrorContext>,
    fallbackValue?: ReturnType<T> extends Promise<infer R> ? R : unknown
  ): T {
    return (async (...args: Parameters<T>) => {
      try {
        return await operation(...args);
      } catch (error) {
        const handled = await this.handleError<
          ReturnType<T> extends Promise<infer R> ? R : unknown
        >(error as Error, context);
        return (
          handled !== null
            ? handled
            : (fallbackValue as ReturnType<T> extends Promise<infer R>
                ? R
                : unknown)
        ) as any;
      }
    }) as T;
  }

  /**
   * Enhanced error conversion
   */
  private enhanceError(
    error: Error | EnhancedError,
    context: Partial<ErrorContext>
  ): EnhancedError {
    if (error instanceof EnhancedError) {
      return error;
    }

    const fullContext: ErrorContext = {
      component: "unknown",
      action: "unknown",
      timestamp: Date.now(),
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      url: typeof window !== "undefined" ? window.location.href : "unknown",
      ...context,
    };

    // Determine error category and severity
    const category = this.categorizeError(error);
    const severity = this.determineSeverity(error, category);
    const isRecoverable = this.isErrorRecoverable(error, category);
    const recoveryActions = this.getRecoveryActions(error, category);

    return new EnhancedError(
      error.message,
      severity,
      category,
      fullContext,
      isRecoverable,
      recoveryActions
    );
  }

  /**
   * Log error and notify listeners
   */
  private logError(error: EnhancedError): void {
    const errorInfo = error.toJSON();

    // Add to history
    this.errors.unshift(errorInfo);

    // Limit history size
    if (this.errors.length > this.maxErrorHistory) {
      this.errors = this.errors.slice(0, this.maxErrorHistory);
    }

    // Notify listeners
    this.errorListeners.forEach((listener) => {
      try {
        listener(errorInfo);
      } catch (listenerError) {
        // console.error('Error in error listener:', listenerError);
      }
    });

    // Console logging based on severity
    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        // console.error('CRITICAL ERROR:', error);
        break;
      case ErrorSeverity.HIGH:
        // console.error('HIGH SEVERITY ERROR:', error);
        break;
      case ErrorSeverity.MEDIUM:
        // console.warn('MEDIUM SEVERITY ERROR:', error);
        break;
      case ErrorSeverity.LOW:
        console.info("LOW SEVERITY ERROR:", error);
        break;
    }
  }

  /**
   * Attempt error recovery
   */
  private async attemptRecovery<T>(
    error: EnhancedError,
    operation: () => Promise<T>
  ): Promise<T | null> {
    error.retryCount++;

    // Wait before retry
    const delay = Math.min(1000 * Math.pow(2, error.retryCount - 1), 30000);
    await this.sleep(delay);

    try {
      return await operation();
    } catch (retryError) {
      if (error.retryCount < error.maxRetries) {
        return this.attemptRecovery(error, operation);
      } else {
        // Max retries reached, apply fallback
        return this.applyFallback(error);
      }
    }
  }

  /**
   * Apply fallback strategies
   */
  private async applyFallback<T>(error: EnhancedError): Promise<T | null> {
    // console.warn(`Applying fallback for error: ${error.message}`);

    // Try cached data first
    if (this.fallbackConfig.enableCachedData) {
      const cachedData = this.getCachedData<T>(error.context.action);
      if (cachedData) {
        return cachedData;
      }
    }

    // Try mock data
    if (this.fallbackConfig.enableMockData) {
      const mockData = this.getMockData<T>(error.context.action);
      if (mockData) {
        return mockData;
      }
    }

    // Graceful degradation
    if (this.fallbackConfig.gracefulDegradation) {
      return this.getReducedFunctionality<T>(error.context.action);
    }

    return null;
  }

  /**
   * Categorize error type
   */
  private categorizeError(error: Error): ErrorCategory {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    if (
      name.includes("network") ||
      message.includes("network") ||
      message.includes("fetch")
    ) {
      return ErrorCategory.NETWORK;
    }
    if (
      name.includes("auth") ||
      message.includes("unauthorized") ||
      message.includes("forbidden")
    ) {
      return ErrorCategory.AUTHENTICATION;
    }
    if (message.includes("validation") || message.includes("invalid")) {
      return ErrorCategory.VALIDATION;
    }
    if (message.includes("api") || message.includes("request")) {
      return ErrorCategory.API;
    }
    if (
      message.includes("trading") ||
      message.includes("order") ||
      message.includes("position")
    ) {
      return ErrorCategory.TRADING;
    }
    if (message.includes("user") || message.includes("input")) {
      return ErrorCategory.USER;
    }

    return ErrorCategory.SYSTEM;
  }

  /**
   * Determine error severity
   */
  private determineSeverity(
    error: Error,
    category: ErrorCategory
  ): ErrorSeverity {
    // Critical errors
    if (
      category === ErrorCategory.AUTHENTICATION ||
      error.message.includes("critical") ||
      error.message.includes("fatal")
    ) {
      return ErrorSeverity.CRITICAL;
    }

    // High severity
    if (
      category === ErrorCategory.TRADING ||
      category === ErrorCategory.SYSTEM ||
      error.message.includes("timeout")
    ) {
      return ErrorSeverity.HIGH;
    }

    // Medium severity
    if (category === ErrorCategory.API || category === ErrorCategory.NETWORK) {
      return ErrorSeverity.MEDIUM;
    }

    // Low severity
    return ErrorSeverity.LOW;
  }

  /**
   * Check if error is recoverable
   */
  private isErrorRecoverable(error: Error, category: ErrorCategory): boolean {
    // Non-recoverable errors
    if (
      category === ErrorCategory.AUTHENTICATION ||
      category === ErrorCategory.VALIDATION ||
      error.message.includes("permanent") ||
      error.message.includes("invalid credentials")
    ) {
      return false;
    }

    return true;
  }

  /**
   * Get recovery actions for error
   */
  private getRecoveryActions(_error: Error, category: ErrorCategory): string[] {
    const actions: string[] = [];

    switch (category) {
      case ErrorCategory.NETWORK:
        actions.push(
          "Check internet connection",
          "Retry request",
          "Use cached data"
        );
        break;
      case ErrorCategory.API:
        actions.push(
          "Retry with exponential backoff",
          "Check API status",
          "Use fallback endpoint"
        );
        break;
      case ErrorCategory.AUTHENTICATION:
        actions.push(
          "Refresh authentication token",
          "Re-login",
          "Check API credentials"
        );
        break;
      case ErrorCategory.TRADING:
        actions.push(
          "Validate order parameters",
          "Check account balance",
          "Retry with adjusted parameters"
        );
        break;
      case ErrorCategory.VALIDATION:
        actions.push("Correct input validation", "Check required fields");
        break;
      case ErrorCategory.SYSTEM:
        actions.push(
          "Restart service",
          "Check system resources",
          "Contact support"
        );
        break;
      case ErrorCategory.USER:
        actions.push("Show user-friendly error message", "Provide guidance");
        break;
    }

    return actions;
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: Error, retryableErrors: string[]): boolean {
    return retryableErrors.some(
      (retryableError) =>
        error.name.includes(retryableError) ||
        error.message.includes(retryableError)
    );
  }

  /**
   * Get cached data for fallback
   */
  private getCachedData<T>(action: string): T | null {
    if (typeof localStorage !== "undefined") {
      try {
        const cached = localStorage.getItem(`fallback_${action}`);
        return cached ? JSON.parse(cached) : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Get mock data for fallback
   */
  private getMockData<T>(action: string): T | null {
    const mockData: Record<string, any> = {
      getMarketData: [
        {
          timestamp: Date.now(),
          open: 50000,
          high: 51000,
          low: 49000,
          close: 50500,
          volume: 1000,
        },
      ],
      getAccountBalance: { totalAmount: "10000", availableAmount: "8000" },
      getOpenPositions: { positions: [] },
    };

    return mockData[action] || null;
  }

  /**
   * Get reduced functionality fallback
   */
  private getReducedFunctionality<T>(action: string): T | null {
    // Return minimal functionality or empty states
    const reducedFunctionality: Record<string, any> = {
      getMarketData: [],
      getAccountBalance: { totalAmount: "0", availableAmount: "0" },
      getOpenPositions: { positions: [] },
    };

    return reducedFunctionality[action] || null;
  }

  /**
   * Setup default configurations
   */
  private setupDefaultConfigs(): void {
    // Default retry config
    this.configureRetry("default", {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      retryableErrors: ["NetworkError", "TimeoutError", "ConnectionError"],
    });

    // API-specific retry config
    this.configureRetry("api", {
      maxAttempts: 5,
      baseDelay: 2000,
      maxDelay: 60000,
      backoffMultiplier: 1.5,
      retryableErrors: [
        "NetworkError",
        "TimeoutError",
        "PoloniexConnectionError",
        "RateLimitError",
      ],
    });

    // Trading-specific retry config
    this.configureRetry("trading", {
      maxAttempts: 2,
      baseDelay: 500,
      maxDelay: 5000,
      backoffMultiplier: 2,
      retryableErrors: ["NetworkError", "TimeoutError"],
    });
  }

  /**
   * Setup global error handling
   */
  private setupGlobalErrorHandling(): void {
    // Handle unhandled promise rejections
    if (typeof window !== "undefined") {
      window.addEventListener("unhandledrejection", (event) => {
        this.handleError(new Error(event.reason), {
          component: "global",
          action: "unhandled_promise_rejection",
          metadata: { reason: event.reason },
        });
      });

      // Handle global errors
      window.addEventListener("error", (event) => {
        this.handleError(event.error || new Error(event.message), {
          component: "global",
          action: "global_error",
          metadata: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          },
        });
      });
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Global error handler instance
 */
export const errorHandler = new ErrorHandler();

/**
 * Utility decorators and functions
 */
export const errorUtils = {
  /**
   * Decorator for automatic error handling
   */
  withErrorHandling: <T extends (...args: unknown[]) => Promise<any>>(
    target: T,
    context: Partial<ErrorContext>
  ): T => {
    return errorHandler.createSafeWrapper(target, context);
  },

  /**
   * Create error boundary component
   */
  createErrorBoundary: (
    fallbackComponent: unknown,
    context: Partial<ErrorContext>
  ) => {
    return class ErrorBoundary extends React.Component {
      constructor(props: unknown) {
        super(props);
        this.state = { hasError: false, error: null };
      }

      static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
      }

      componentDidCatch(error: Error, errorInfo: unknown) {
        errorHandler.handleError(error, {
          ...context,
          action: "component_error",
          metadata: errorInfo,
        });
      }

      render() {
        if ((this.state as any).hasError) {
          return fallbackComponent;
        }
        return (this.props as any).children;
      }
    };
  },
};
