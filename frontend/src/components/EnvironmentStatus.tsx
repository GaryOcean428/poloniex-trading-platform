import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from '../lucide-react';
import { EnvironmentManager } from '../config/environment';

interface EnvironmentConfig {
  apiKey: string | null;
  apiSecret: string | null;
  forceMockMode: boolean;
  isProduction: boolean;
  wsUrl: string;
  apiUrl: string;
  liveTradingEnabled: boolean;
}

const EnvironmentStatus: React.FC = () => {
  const [config, setConfig] = useState(EnvironmentManager.getInstance().getConfig());
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleConfigUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      setConfig(customEvent.detail);
    };
    
    window.addEventListener('config-updated', handleConfigUpdate);
    return () => window.removeEventListener('config-updated', handleConfigUpdate);
  }, []);

  if (!config || !isVisible) {
    return null;
  }

  const getStatusInfo = () => {
    if (!config.liveTradingEnabled) {
      return {
        type: 'warning' as const,
        icon: AlertTriangle,
        title: 'Demo Mode Active',
        message: 'Using simulated trading data',
        details: [
          ...(!config.apiKey || !config.apiSecret ? ['Missing API credentials'] : []),
          ...(config.forceMockMode ? ['Force mock mode enabled'] : []),
          'No real trades will be executed'
        ]
      };
    } else {
      return {
        type: 'success' as const,
        icon: CheckCircle2,
        title: 'Live Trading Mode',
        message: 'Connected with valid credentials',
        details: [
          'API credentials configured',
          'Real trading enabled'
        ]
      };
    }
  };

  const status = getStatusInfo();
  const StatusIcon = status.icon;

  const bgColor = status.type === 'warning' ? 'bg-yellow-50' : 'bg-green-50';
  const borderColor = status.type === 'warning' ? 'border-yellow-200' : 'border-green-200';
  const textColor = status.type === 'warning' ? 'text-yellow-800' : 'text-green-800';
  const iconColor = status.type === 'warning' ? 'text-yellow-600' : 'text-green-600';

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm">
      <div className={`${bgColor} ${borderColor} border rounded-lg p-4 shadow-lg`}>
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <StatusIcon className={`w-5 h-5 ${iconColor} mt-0.5`} />
            <div className="flex-1">
              <h3 className={`text-sm font-medium ${textColor}`}>
                {status.title}
              </h3>
              <p className={`text-xs ${textColor} mt-1`}>
                {status.message}
              </p>
              {status.details.length > 0 && (
                <ul className={`text-xs ${textColor} mt-2 space-y-1`}>
                  {status.details.map((detail, index) => (
                    <li key={index} className="flex items-center space-x-1">
                      <span className="w-1 h-1 bg-current rounded-full"></span>
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <button
            onClick={() => setIsVisible(false)}
            className={`${textColor} hover:opacity-70 transition-opacity`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Additional technical details for debugging */}
        {!config.isProduction && (
          <div className="mt-3 pt-3 border-t border-current border-opacity-20">
            <details className={`text-xs ${textColor}`}>
              <summary className="cursor-pointer font-medium">Debug Info</summary>
              <div className="mt-2 space-y-1 font-mono text-xs">
                <div>Environment: {config.isProduction ? 'Production' : 'Development'}</div>
                <div>WebSocket URL: {config.wsUrl}</div>
                <div>Has API Key: {config.apiKey ? 'Yes' : 'No'}</div>
                <div>Has API Secret: {config.apiSecret ? 'Yes' : 'No'}</div>
                <div>Force Mock: {config.forceMockMode ? 'Yes' : 'No'}</div>
                <div>Live Trading: {config.liveTradingEnabled ? 'Yes' : 'No'}</div>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
};

export default EnvironmentStatus;