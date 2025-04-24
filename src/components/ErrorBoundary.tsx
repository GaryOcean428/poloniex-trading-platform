// React is used implicitly for JSX transformation
import { Component, ErrorInfo, ReactNode, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  children: ReactNode;
  fallbackComponent?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetOnPropsChange?: boolean;
  resetOnRouteChange?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
  lastErrorTime: number;
}

// Error types that can be automatically recovered from
const RECOVERABLE_ERROR_TYPES = [
  'ChunkLoadError', // For code splitting errors
  'NetworkError',
  'TimeoutError',
  'AbortError'
];

// Custom hook for error recovery navigation
const useErrorRecovery = (hasError: boolean, error: Error | null) => {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(5);
  
  useEffect(() => {
    if (!hasError) return;
    
    // Check if error is related to routing/navigation
    const isRoutingError = error?.message?.includes('Failed to load') || 
                          error?.message?.includes('chunk') ||
                          error?.message?.includes('route');
    
    // Start countdown for auto-navigation to dashboard
    if (isRoutingError) {
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            navigate('/dashboard');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      return () => clearInterval(timer);
    }
  }, [hasError, error, navigate]);
  
  return { countdown, navigateToDashboard: () => navigate('/dashboard') };
};

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    errorCount: 0,
    lastErrorTime: 0
  };
  
  private errorLogService = {
    logError: (error: Error, errorInfo: ErrorInfo) => {
      // In production, this would send to a logging service
      console.error('Uncaught error:', error, errorInfo);
      
      // Store error in localStorage for diagnostics
      try {
        const errorLog = JSON.parse(localStorage.getItem('errorLog') || '[]');
        errorLog.push({
          timestamp: new Date().toISOString(),
          message: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack
        });
        // Keep only the last 10 errors
        if (errorLog.length > 10) errorLog.shift();
        localStorage.setItem('errorLog', JSON.stringify(errorLog));
      } catch (e) {
        console.error('Failed to log error to localStorage', e);
      }
    }
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { 
      hasError: true, 
      error,
      errorCount: 1
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const now = Date.now();
    const timeSinceLastError = now - this.state.lastErrorTime;
    
    this.setState(prevState => ({
      errorInfo,
      errorCount: prevState.errorCount + 1,
      lastErrorTime: now
    }));
    
    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
    
    // Log error to service
    this.errorLogService.logError(error, errorInfo);
    
    // Attempt automatic recovery for certain error types
    if (this.isRecoverableError(error) && timeSinceLastError > 5000) {
      // Wait a moment before attempting recovery
      setTimeout(() => {
        this.attemptRecovery();
      }, 2000);
    }
  }
  
  private isRecoverableError(error: Error): boolean {
    return RECOVERABLE_ERROR_TYPES.some(type => 
      error.name.includes(type) || error.message.includes(type)
    );
  }
  
  private attemptRecovery(): void {
    // Reset the error state to attempt recovery
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  }
  
  // Reset error state when props change if configured
  public componentDidUpdate(prevProps: Props): void {
    if (
      this.state.hasError && 
      this.props.resetOnPropsChange && 
      prevProps !== this.props
    ) {
      this.attemptRecovery();
    }
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallbackComponent) {
        return this.props.fallbackComponent;
      }
      
      return <ErrorFallback 
        error={this.state.error} 
        errorInfo={this.state.errorInfo}
        errorCount={this.state.errorCount}
        onReset={() => this.attemptRecovery()}
      />;
    }

    return this.props.children;
  }
}

// Separate error fallback component with navigation
const ErrorFallback = ({ 
  error, 
  errorInfo, 
  errorCount,
  onReset 
}: { 
  error: Error | null; 
  errorInfo: ErrorInfo | null;
  errorCount: number;
  onReset: () => void;
}) => {
  const { countdown, navigateToDashboard } = useErrorRecovery(true, error);
  const [showDetails, setShowDetails] = useState(false);
  
  // Determine if this is a critical error or something we can recover from
  const isCriticalError = errorCount > 3;
  
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-6 rounded-lg shadow-md max-w-lg w-full">
        <div className="flex items-center justify-center text-red-500 mb-4">
          <AlertTriangle size={48} />
        </div>
        <h1 className="text-2xl font-bold text-center mb-4">
          {isCriticalError 
            ? "Critical Error Detected" 
            : "Something went wrong"}
        </h1>
        
        {error?.message && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded mb-4">
            <p className="text-red-700">{error.message}</p>
          </div>
        )}
        
        <div className="space-y-4">
          {isCriticalError ? (
            <div className="bg-yellow-50 p-4 rounded mb-4">
              <p className="text-yellow-700">
                Multiple errors have been detected. This might indicate a more serious problem.
                Try reloading the application or returning to the dashboard.
              </p>
            </div>
          ) : (
            <div className="bg-blue-50 p-4 rounded mb-4">
              <p className="text-blue-700">
                The application encountered an error. We'll try to recover automatically.
                {countdown > 0 && (
                  <span> Redirecting to dashboard in {countdown} seconds...</span>
                )}
              </p>
            </div>
          )}
          
          <div className="flex flex-col space-y-2">
            <button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md shadow-sm flex items-center justify-center"
              onClick={onReset}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </button>
            
            <button
              className="w-full bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-md shadow-sm flex items-center justify-center"
              onClick={navigateToDashboard}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Return to Dashboard
            </button>
            
            <button
              className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 px-4 rounded-md shadow-sm"
              onClick={() => window.location.reload()}
            >
              Reload Application
            </button>
          </div>
          
          <div>
            <button 
              className="text-blue-600 text-sm flex items-center"
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? "Hide" : "Show"} Technical Details
            </button>
            
            {showDetails && errorInfo && (
              <div className="bg-gray-100 p-4 rounded mt-2 overflow-auto max-h-60">
                <p className="font-mono text-xs whitespace-pre-wrap">{errorInfo.componentStack}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
