// React is used implicitly for JSX transformation
import { useState, useEffect } from 'react';
import { Zap, Check, AlertTriangle, RefreshCw, MonitorSmartphone } from 'lucide-react';

interface ExtensionStatusProps {
  onRefreshRequest?: () => void;
}

const ExtensionStatus: React.FC<ExtensionStatusProps> = ({ onRefreshRequest }) => {
  const [extensionStatus, setExtensionStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [tradingViewStatus, setTradingViewStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [poloniexStatus, setPoloniexStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Check extension connection status
  useEffect(() => {
    checkExtensionStatus();
  }, []);
  
  const checkExtensionStatus = () => {
    setExtensionStatus('checking');
    setTradingViewStatus('checking');
    setPoloniexStatus('checking');
    setIsRefreshing(true);
    
    // Check if extension is installed
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        // Extension ID will need to be updated with your actual extension ID
        const extensionId = 'jcdmopolmojdhpclfbemdpcdneobmnje';
        
        chrome.runtime.sendMessage(
          extensionId,
          { type: 'CHECK_INSTALLATION' },
          (response: any) => {
            if (response && response.installed) {
              setExtensionStatus('connected');
              
              // Now check TradingView and Poloniex connection status
              chrome.runtime.sendMessage(
                extensionId,
                { type: 'CHECK_TRADINGVIEW_STATUS' },
                (response: any) => {
                  setTradingViewStatus(response && response.connected ? 'connected' : 'disconnected');
                }
              );
              
              chrome.runtime.sendMessage(
                extensionId,
                { type: 'CHECK_POLONIEX_STATUS' },
                (response: any) => {
                  setPoloniexStatus(response && response.connected ? 'connected' : 'disconnected');
                  setIsRefreshing(false);
                }
              );
            } else {
              setExtensionStatus('disconnected');
              setTradingViewStatus('disconnected');
              setPoloniexStatus('disconnected');
              setIsRefreshing(false);
            }
          }
        );
      } catch (error) {
        console.error('Error checking extension status:', error);
        setExtensionStatus('disconnected');
        setTradingViewStatus('disconnected');
        setPoloniexStatus('disconnected');
        setIsRefreshing(false);
      }
    } else {
      // Chrome extension API not available
      setExtensionStatus('disconnected');
      setTradingViewStatus('disconnected');
      setPoloniexStatus('disconnected');
      setIsRefreshing(false);
    }
  };
  
  const handleRefresh = () => {
    checkExtensionStatus();
    if (onRefreshRequest) {
      onRefreshRequest();
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-medium flex items-center">
          <MonitorSmartphone className="h-5 w-5 mr-2 text-blue-500" />
          Extension Status
        </h3>
        <button 
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-1.5 bg-neutral-100 rounded-md hover:bg-neutral-200 text-neutral-600 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Zap className="h-4 w-4 mr-2 text-blue-500" />
            <span className="text-neutral-700">Extension</span>
          </div>
          <StatusBadge status={extensionStatus} />
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <svg className="h-4 w-4 mr-2 text-blue-500" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 5L19 12L12 19M5 19L12 12L5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-neutral-700">TradingView</span>
          </div>
          <StatusBadge status={tradingViewStatus} />
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <svg className="h-4 w-4 mr-2 text-blue-500" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 6V18M18 12H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-neutral-700">Poloniex</span>
          </div>
          <StatusBadge status={poloniexStatus} />
        </div>
      </div>
      
      <div className="mt-4 text-sm">
        {extensionStatus === 'disconnected' ? (
          <div className="text-yellow-700 flex items-start">
            <AlertTriangle className="h-4 w-4 mr-1 mt-0.5 flex-shrink-0" />
            <span>Extension not detected. Please install the Chrome extension to enable integration features.</span>
          </div>
        ) : extensionStatus === 'connected' && (tradingViewStatus === 'disconnected' || poloniexStatus === 'disconnected') ? (
          <div className="text-yellow-700 flex items-start">
            <AlertTriangle className="h-4 w-4 mr-1 mt-0.5 flex-shrink-0" />
            <span>Some integrations are not connected. Please visit TradingView or Poloniex to activate them.</span>
          </div>
        ) : extensionStatus === 'connected' ? (
          <div className="text-green-700 flex items-start">
            <Check className="h-4 w-4 mr-1 mt-0.5 flex-shrink-0" />
            <span>All systems connected. Trading integration is fully operational.</span>
          </div>
        ) : (
          <div className="text-neutral-500 flex items-start">
            <RefreshCw className="h-4 w-4 mr-1 mt-0.5 flex-shrink-0 animate-spin" />
            <span>Checking connection status...</span>
          </div>
        )}
      </div>
    </div>
  );
};

interface StatusBadgeProps {
  status: 'connected' | 'disconnected' | 'checking';
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  switch (status) {
    case 'connected':
      return (
        <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full flex items-center">
          <Check className="h-3 w-3 mr-1" />
          Connected
        </span>
      );
    case 'disconnected':
      return (
        <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full flex items-center">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Disconnected
        </span>
      );
    case 'checking':
      return (
        <span className="px-2 py-1 bg-neutral-100 text-neutral-600 text-xs rounded-full flex items-center">
          <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
          Checking
        </span>
      );
  }
};

export default ExtensionStatus;
