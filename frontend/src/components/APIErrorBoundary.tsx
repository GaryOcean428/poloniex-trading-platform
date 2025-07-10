import React from 'react';
import { AlertTriangle, RefreshCw, Settings, ExternalLink } from 'lucide-react';
import { PoloniexAPIError, PoloniexConnectionError, PoloniexAuthenticationError } from '@/services/poloniexAPI';

interface APIErrorBoundaryProps {
  error: Error;
  onRetry?: () => void;
  context?: string;
}

export const APIErrorBoundary: React.FC<APIErrorBoundaryProps> = ({ error, onRetry, context = 'API' }) => {
  const isConnectionError = error instanceof PoloniexConnectionError;
  const isAuthError = error instanceof PoloniexAuthenticationError;
  const isAPIError = error instanceof PoloniexAPIError;

  const getErrorIcon = () => {
    if (isAuthError) return <Settings className="h-6 w-6 text-red-500" />;
    if (isConnectionError) return <AlertTriangle className="h-6 w-6 text-yellow-500" />;
    return <AlertTriangle className="h-6 w-6 text-red-500" />;
  };

  const getErrorTitle = () => {
    if (isAuthError) return 'Authentication Required';
    if (isConnectionError) return 'Connection Error';
    if (isAPIError) return 'API Error';
    return 'Error';
  };

  const getErrorMessage = () => {
    if (isAuthError) {
      return 'Your API credentials are missing or invalid. Please check your settings.';
    }
    if (isConnectionError) {
      return 'Unable to connect to the trading platform. Please check your internet connection and try again.';
    }
    if (isAPIError) {
      return error.message || 'An error occurred while communicating with the API.';
    }
    return error.message || 'An unexpected error occurred.';
  };

  const getGuidance = () => {
    if (isAuthError) {
      return (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <h4 className="text-sm font-medium text-blue-800 mb-2">How to fix this:</h4>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Go to Settings and enter your Poloniex API credentials</li>
            <li>• Ensure your API key has the required permissions</li>
            <li>• Verify your API key and secret are correct (passphrase not required for Poloniex API v3)</li>
            <li>• Check that your IP address is whitelisted on Poloniex</li>
          </ul>
        </div>
      );
    }

    if (isConnectionError) {
      return (
        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
          <h4 className="text-sm font-medium text-yellow-800 mb-2">Troubleshooting:</h4>
          <ul className="text-sm text-yellow-700 space-y-1">
            <li>• Check your internet connection</li>
            <li>• Verify that Poloniex API is accessible from your location</li>
            <li>• Try refreshing the page</li>
            <li>• If using custom API endpoints, verify the configuration</li>
          </ul>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
      <div className="flex items-start">
        <div className="flex-shrink-0">
          {getErrorIcon()}
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-lg font-medium text-gray-900">
            {getErrorTitle()}
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            {context} operation failed. {getErrorMessage()}
          </p>
          
          {getGuidance()}
          
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            {onRetry && (
              <button
                onClick={onRetry}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </button>
            )}
            
            {isAuthError && (
              <button
                onClick={() => window.location.href = '/settings'}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <Settings className="h-4 w-4 mr-2" />
                Go to Settings
              </button>
            )}
            
            <a
              href="https://docs.poloniex.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              API Documentation
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default APIErrorBoundary;