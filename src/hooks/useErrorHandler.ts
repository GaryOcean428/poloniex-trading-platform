import { useState, useEffect, useCallback } from 'react';

type ErrorType = 'api' | 'network' | 'validation' | 'authentication' | 'unknown';
type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

interface ErrorHandlerOptions {
  retryCount?: number;
  retryDelay?: number;
  onRetry?: (error: Error, attempt: number) => void;
  onFallback?: (error: Error) => void;
  fallbackValue?: any;
  logToServer?: boolean;
  showToUser?: boolean;
}

interface ErrorState {
  hasError: boolean;
  error: Error | null;
  errorType: ErrorType;
  severity: ErrorSeverity;
  retryAttempt: number;
  lastErrorTime: number;
}

const DEFAULT_OPTIONS: ErrorHandlerOptions = {
  retryCount: 3,
  retryDelay: 1000,
  logToServer: true,
  showToUser: true
};

export const useErrorHandler = (options: ErrorHandlerOptions = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  
  const [errorState, setErrorState] = useState<ErrorState>({
    hasError: false,
    error: null,
    errorType: 'unknown',
    severity: 'low',
    retryAttempt: 0,
    lastErrorTime: 0
  });
  
  // Reset error state
  const resetError = useCallback(() => {
    setErrorState({
      hasError: false,
      error: null,
      errorType: 'unknown',
      severity: 'low',
      retryAttempt: 0,
      lastErrorTime: 0
    });
  }, []);
  
  // Determine error type from error object
  const determineErrorType = useCallback((error: Error): ErrorType => {
    const message = error.message.toLowerCase();
    
    if (error.name === 'ApiError' || message.includes('api') || message.includes('endpoint')) {
      return 'api';
    }
    
    if (error.name === 'NetworkError' || 
        message.includes('network') || 
        message.includes('connection') ||
        message.includes('offline') ||
        message.includes('timeout')) {
      return 'network';
    }
    
    if (error.name === 'ValidationError' || message.includes('validation') || message.includes('invalid')) {
      return 'validation';
    }
    
    if (error.name === 'AuthenticationError' || 
        message.includes('auth') || 
        message.includes('permission') ||
        message.includes('token') ||
        message.includes('unauthorized')) {
      return 'authentication';
    }
    
    return 'unknown';
  }, []);
  
  // Determine error severity
  const determineErrorSeverity = useCallback((error: Error, type: ErrorType): ErrorSeverity => {
    const message = error.message.toLowerCase();
    
    // Critical errors
    if (message.includes('critical') || 
        message.includes('fatal') ||
        message.includes('crash')) {
      return 'critical';
    }
    
    // High severity errors
    if (type === 'authentication' || 
        message.includes('security') ||
        message.includes('data loss')) {
      return 'high';
    }
    
    // Medium severity errors
    if (type === 'api' || 
        type === 'network' ||
        message.includes('timeout')) {
      return 'medium';
    }
    
    // Default to low severity
    return 'low';
  }, []);
  
  // Log error to server
  const logErrorToServer = useCallback((error: Error, type: ErrorType, severity: ErrorSeverity) => {
    // In production, this would send to a logging service
    console.error('Error logged to server:', {
      message: error.message,
      stack: error.stack,
      type,
      severity,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href
    });
    
    // Store in localStorage for diagnostics
    try {
      const errorLog = JSON.parse(localStorage.getItem('errorLog') || '[]');
      errorLog.push({
        message: error.message,
        type,
        severity,
        timestamp: new Date().toISOString(),
        url: window.location.href
      });
      
      // Keep only the last 20 errors
      if (errorLog.length > 20) errorLog.shift();
      localStorage.setItem('errorLog', JSON.stringify(errorLog));
    } catch (e) {
      console.error('Failed to log error to localStorage', e);
    }
  }, []);
  
  // Handle error with retry logic
  const handleError = useCallback((error: Error) => {
    const errorType = determineErrorType(error);
    const severity = determineErrorSeverity(error, errorType);
    const now = Date.now();
    
    setErrorState(prev => {
      const newState = {
        hasError: true,
        error,
        errorType,
        severity,
        retryAttempt: prev.retryAttempt + 1,
        lastErrorTime: now
      };
      
      // Log error if configured
      if (config.logToServer) {
        logErrorToServer(error, errorType, severity);
      }
      
      // Check if we should retry
      if (newState.retryAttempt <= (config.retryCount || 0) && 
          (errorType === 'network' || errorType === 'api')) {
        
        // Schedule retry
        setTimeout(() => {
          if (config.onRetry) {
            config.onRetry(error, newState.retryAttempt);
          }
          
          // Only reset error state if it's the same error
          setErrorState(current => {
            if (current.error === error) {
              return {
                ...current,
                hasError: false
              };
            }
            return current;
          });
        }, (config.retryDelay || 1000) * Math.pow(2, newState.retryAttempt - 1)); // Exponential backoff
      } else if (config.onFallback) {
        // Use fallback if available
        config.onFallback(error);
      }
      
      return newState;
    });
  }, [
    config, 
    determineErrorType, 
    determineErrorSeverity, 
    logErrorToServer
  ]);
  
  // Wrap async function with error handling
  const withErrorHandling = useCallback(<T extends any[], R>(
    fn: (...args: T) => Promise<R>,
    options: ErrorHandlerOptions = {}
  ) => {
    const handlerOptions = { ...config, ...options };
    
    return async (...args: T): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        handleError(error instanceof Error ? error : new Error(String(error)));
        
        if (handlerOptions.fallbackValue !== undefined) {
          return handlerOptions.fallbackValue as R;
        }
        
        throw error;
      }
    };
  }, [config, handleError]);
  
  // Effect to clear error after some time for non-critical errors
  useEffect(() => {
    if (errorState.hasError && 
        errorState.severity !== 'critical' && 
        errorState.severity !== 'high') {
      const timeout = setTimeout(() => {
        resetError();
      }, 10000); // Auto-clear after 10 seconds for low/medium severity
      
      return () => clearTimeout(timeout);
    }
  }, [errorState.hasError, errorState.severity, resetError]);
  
  return {
    error: errorState.error,
    errorType: errorState.errorType,
    severity: errorState.severity,
    hasError: errorState.hasError,
    retryAttempt: errorState.retryAttempt,
    handleError,
    resetError,
    withErrorHandling
  };
};

export default useErrorHandler;
