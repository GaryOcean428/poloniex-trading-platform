import React, { Component, type ReactNode, type ErrorInfo } from 'react';
import { ErrorFallback } from './ErrorFallback';

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
    if (this.state.errorCount < 3 && !this.isInitializationError(error)) {
      this.resetTimeoutId = window.setTimeout(() => {
        this.handleReset();
      }, 30000);
    }
  }

  componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
  }

  private logError = (error: Error, errorInfo: ErrorInfo) => {
    // Log to console for development
    console.error('ErrorBoundary caught an error:', error);
    console.error('Error info:', errorInfo);

    // Check for initialization errors
    if (this.isInitializationError(error)) {
      console.error('Initialization error detected - this may require a page refresh');
    }

    // In production, this would send to a logging service
    if (process.env.NODE_ENV === 'production') {
      // Example: Send to monitoring service
      // logErrorToService(error, errorInfo, this.state.errorCount);
    }
  };

  private isInitializationError = (error: Error): boolean => {
    const message = error.message || '';
    return (
      message.includes('Cannot access') && message.includes('before initialization') ||
      message.includes('temporal dead zone') ||
      message.includes('ReferenceError') ||
      // React Error #185 - Hydration mismatch
      message.includes('185') ||
      message.includes('hydration') ||
      message.includes('Text content does not match server-rendered HTML') ||
      message.includes('Hydration failed')
    );
  };

  private handleReset = () => {
    if (this.resetTimeoutId) {
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
    if (this.state.hasError) {
      const FallbackComponent = this.props.fallback || ErrorFallback;
      
      return (
        <FallbackComponent
          error={this.state.error}
          errorCount={this.state.errorCount}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}