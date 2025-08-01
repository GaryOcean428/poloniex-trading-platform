import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, Settings, X } from 'lucide-react';
import { EnvironmentManager } from '../config/environment';

export const ConfigurationStatus: React.FC = () => {
  const [config, setConfig] = useState(EnvironmentManager.getInstance().getConfig());
  const [showDetails, setShowDetails] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  
  useEffect(() => {
    const handleConfigUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      setConfig(customEvent.detail);
    };
    
    window.addEventListener('config-updated', handleConfigUpdate);
    return () => window.removeEventListener('config-updated', handleConfigUpdate);
  }, []);

  // Auto-hide after 8 seconds if live trading is enabled (success state)
  useEffect(() => {
    if (config.liveTradingEnabled) {
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 8000);
      
      return () => clearTimeout(timer);
    }
  }, [config.liveTradingEnabled]);
  
  if (!isVisible) return null;
  
  const isLiveMode = config.liveTradingEnabled;
  
  return (
    <div className="fixed top-20 right-4 z-30 max-w-sm">
      <div className={`
        ${isLiveMode ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}
        border rounded-lg p-4 shadow-lg transition-all duration-300
      `}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`
              px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2
              ${isLiveMode 
                ? 'bg-green-100 text-green-800' 
                : 'bg-yellow-100 text-yellow-800'
              }
            `}>
              {isLiveMode ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
              {isLiveMode ? 'LIVE TRADING' : 'MOCK MODE'}
            </div>
            
            <button
              onClick={() => setShowDetails(!showDetails)}
              className={`
                p-1 rounded-full hover:bg-opacity-20 transition-colors
                ${isLiveMode ? 'hover:bg-green-600' : 'hover:bg-yellow-600'}
              `}
              title="Configuration Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
          
          <button
            onClick={() => setIsVisible(false)}
            className={`
              p-1 rounded-full hover:bg-opacity-20 transition-colors
              ${isLiveMode ? 'text-green-600 hover:bg-green-600' : 'text-yellow-600 hover:bg-yellow-600'}
            `}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {showDetails && (
          <div className={`
            mt-4 p-3 rounded-lg text-sm
            ${isLiveMode 
              ? 'bg-green-100 text-green-800' 
              : 'bg-yellow-100 text-yellow-800'
            }
          `}>
            <div className="font-medium mb-2">Configuration Status</div>
            <div className="space-y-1 text-xs">
              <div>Mode: {isLiveMode ? 'Live Trading' : 'Mock Trading'}</div>
              <div>API Key: {config.apiKey ? '✓ Configured' : '✗ Missing'}</div>
              <div>API Secret: {config.apiSecret ? '✓ Configured' : '✗ Missing'}</div>
              <div>Force Mock: {config.forceMockMode ? 'Yes' : 'No'}</div>
              <div>Environment: {config.isProduction ? 'Production' : 'Development'}</div>
            </div>
            
            {!isLiveMode && (
              <div className="mt-2 p-2 bg-yellow-200 rounded text-xs">
                <strong>To enable live trading:</strong><br />
                1. Set VITE_POLONIEX_API_KEY and VITE_POLONIEX_SECRET<br />
                2. Ensure VITE_FORCE_MOCK_MODE is not set to "true"
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};