import React from 'react';
import { useTradingContext } from '../hooks/useTradingContext';
import { AlertTriangle } from 'lucide-react';

// Check if we're running in a WebContainer environment
const IS_WEBCONTAINER = typeof window !== 'undefined' && window.location && window.location.hostname.includes('webcontainer-api.io');

const MockModeNotice: React.FC = () => {
  const { isLoading } = useTradingContext();
  
  return (
    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-4">
      <div className="flex">
        <div className="flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-yellow-400" />
        </div>
        <div className="ml-3">
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
      </div>
    </div>
  );
};

export default MockModeNotice;