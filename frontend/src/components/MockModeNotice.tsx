import React, { useState, useEffect } from 'react';
import { useTradingContext } from '../hooks/useTradingContext';
import { AlertTriangle, X } from 'lucide-react';

// Check if we're running in a WebContainer environment
const IS_WEBCONTAINER = typeof window !== 'undefined' && window.location && window.location.hostname.includes('webcontainer-api.io');

const MockModeNotice: React.FC = () => {
  const { isLoading } = useTradingContext();
  const [isVisible, setIsVisible] = useState(true);
  
  // Load dismissed state from localStorage
  useEffect(() => {
    const dismissed = localStorage.getItem('mockModeNotice_dismissed') === 'true';
    setIsVisible(!dismissed);
  }, []);

  // Handle dismiss
  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem('mockModeNotice_dismissed', 'true');
  };

  // Don't render if dismissed
  if (!isVisible) {
    return null;
  }
  
  return (
    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-4 relative">
      <div className="flex">
        <div className="flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-yellow-400" />
        </div>
        <div className="ml-3 flex-1">
          <p className="text-sm text-yellow-700">
            <span className="font-medium">Demo Mode:</span> {
              IS_WEBCONTAINER 
                ? 'Running in development environment with simulated data. No API connections are made.'
                : isLoading 
                  ? 'Attempting to connect to Poloniex API...' 
                  : 'Using simulated trading data. No real trades will be executed.'
            }
          </p>
        </div>
        <div className="flex-shrink-0 ml-2">
          <button
            onClick={handleDismiss}
            className="text-yellow-400 hover:text-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-500 rounded"
            aria-label="Dismiss notice"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default MockModeNotice;