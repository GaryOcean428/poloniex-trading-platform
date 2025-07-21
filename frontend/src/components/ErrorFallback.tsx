import type { ErrorInfo } from 'react';
import React, { useState } from 'react';
import { useErrorRecovery } from '../hooks/useErrorRecovery';

/* eslint-disable @typescript-eslint/no-unused-vars */

interface ErrorFallbackProps {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
  onReset: () => void;
}

export const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  errorInfo: _errorInfo,
  errorCount,
  onReset
}) => {
  const { countdown, navigateToDashboard } = useErrorRecovery(true, error);
  const [showDetails, setShowDetails] = useState(false);

  // Determine if this is a critical error or something we can recover from
  const isCriticalError = errorCount > 3 || error?.message?.includes('critical');

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white rounded-lg shadow-lg p-6 text-center">
        <div className="mb-4">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {isCriticalError ? 'Critical Error' : 'Something went wrong'}
          </h2>
          <p className="text-gray-600 mb-4">
            {isCriticalError
              ? 'A critical error has occurred. Please refresh the page or contact support.'
              : 'Don\'t worry, we\'re working on fixing this issue.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 text-left">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              {showDetails ? 'Hide' : 'Show'} Error Details
            </button>
            {showDetails && (
              <div className="mt-2 p-3 bg-gray-100 rounded text-sm text-gray-700">
                <p><strong>Error:</strong> {error.message}</p>
                {error.stack && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-gray-600">Stack Trace</summary>
                    <pre className="mt-1 text-xs whitespace-pre-wrap break-all">
                      {error.stack}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={onReset}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={navigateToDashboard}
            className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition-colors"
          >
            Go to Dashboard
          </button>
        </div>

        {countdown > 0 && (
          <p className="mt-4 text-sm text-gray-500">
            Automatically redirecting to dashboard in {countdown} seconds...
          </p>
        )}

        {errorCount > 1 && (
          <p className="mt-2 text-sm text-orange-600">
            Error occurred {errorCount} times
          </p>
        )}
      </div>
    </div>
  );
};
