import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorFallback } from './ErrorFallback';
import { logger } from '@shared/logger';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
  errorId: string;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: React.ComponentType<{
    error: Error | null;
    errorInfo: ErrorInfo | null;
    errorCount: number;
    onReset: () => void;
  }>;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private resetTimeoutId: number | null = null;
  private onWindowError?: (event: ErrorEvent) => void;
  private onUnhandledRejection?: (event: PromiseRejectionEvent) => void;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
      errorId: ''
    };
  }

  componentDidMount(): void {
    // Capture errors thrown in event handlers or other async contexts
    this.onWindowError = (event: ErrorEvent) => {
      if (!this.state.hasError) {
        this.setState({
          hasError: true,
          error: event.error instanceof Error ? event.error : new Error(event.message || 'Unknown error'),
          errorInfo: null,
          errorId: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        });
      }
    };

    this.onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const err = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Unhandled rejection');
      if (!this.state.hasError) {
        this.setState({
          hasError: true,
          error: err,
          errorInfo: null,
          errorId: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        });
      }
    };

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('error', this.onWindowError as any);
      window.addEventListener('unhandledrejection', this.onUnhandledRejection as unknown as EventListener);
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
      errorId: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState(prevState => ({
      errorInfo,
      errorCount: prevState.errorCount + 1
    }));

    // Log error to monitoring service
    this.logError(error, errorInfo);

    // Auto-reset after 30 seconds for non-critical errors, but only for first few errors
    if (this.state.errorCount < 3 && !this.isInitializationError(error))
    {
      this.resetTimeoutId = window.setTimeout(() => {
        this.handleReset();
      }, 30000);
    }
  }

  componentWillUnmount() {
    if (this.resetTimeoutId)
    {
      clearTimeout(this.resetTimeoutId);
    }
    if (typeof window.removeEventListener === 'function') {
      if (this.onWindowError) {
        window.removeEventListener('error', this.onWindowError as any);
      }
      if (this.onUnhandledRejection) {
        window.removeEventListener('unhandledrejection', this.onUnhandledRejection as unknown as EventListener);
      }
    }
  }

  private logError = (error: Error, _errorInfo: ErrorInfo) => {
    // Centralized logging
    const context = {
      component: 'ErrorBoundary',
      errorCount: this.state.errorCount,
      errorId: this.state.errorId,
    } as const;

    if (this.isInitializationError(error)) {
      logger.critical('Initialization error detected - may require page refresh', error, context);
    } else {
      logger.error('ErrorBoundary caught an error', error, context);
    }

    // Hook: place to forward to monitoring service in production if needed
    // e.g., send to Sentry/DataDog here using error and _errorInfo
  };

  private isInitializationError = (error: Error): boolean => {
    const message = error.message || '';
    return (
      message.includes('Cannot access') && message.includes('before initialization') ||
      message.includes('temporal dead zone') ||
      message.includes('ReferenceError') ||
      // React Error #185 - Maximum update depth exceeded (infinite loop)
      message.includes('185') ||
      message.includes('Maximum update depth exceeded') ||
      message.includes('infinite') ||
      message.includes('hydration') ||
      message.includes('Text content does not match server-rendered HTML') ||
      message.includes('Hydration failed')
    );
  };

  private handleReset = () => {
    if (this.resetTimeoutId)
    {
      clearTimeout(this.resetTimeoutId);
      this.resetTimeoutId = null;
    }

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: ''
    });
  };

  render() {
    if (this.state.hasError)
    {
      const FallbackComponent = this.props.fallback || ErrorFallback;

      return (
        <FallbackComponent
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          errorCount={this.state.errorCount}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}
