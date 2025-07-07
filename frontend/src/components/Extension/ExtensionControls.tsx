// React is used implicitly for JSX transformation
import { useState } from 'react';
import { X, RefreshCw, Info } from 'lucide-react';
import ExtensionStatus from './ExtensionStatus';
import ExtensionSettings from './ExtensionSettings';
import { useSettings } from '../../context/SettingsContext';

interface ExtensionControlsProps {
  onClose?: () => void;
}

const ExtensionControls: React.FC<ExtensionControlsProps> = ({ onClose }) => {
  // Removed unused apiKey variable
  const { } = useSettings();
  const [activePanel, setActivePanel] = useState<'status' | 'settings' | 'info'>('status');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const handleRefresh = () => {
    setIsRefreshing(true);
    
    // Refresh data from extension
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        // Extension ID will need to be updated with your actual extension ID
        const extensionId = 'jcdmopolmojdhpclfbemdpcdneobmnje';
        
        chrome.runtime.sendMessage(
          extensionId,
          { type: 'REFRESH_DATA' },
          () => {
            // Removed unused response parameter
            setIsRefreshing(false);
          }
        );
      } catch (error) {
        console.error('Error refreshing extension data:', error);
        setIsRefreshing(false);
      }
    } else {
      // Chrome extension API not available, simulate refresh
      setTimeout(() => {
        setIsRefreshing(false);
      }, 1000);
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      <div className="bg-neutral-800 text-white p-4 flex justify-between items-center">
        <h2 className="text-lg font-bold flex items-center">
          <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20.24 12.24c-1.07-.57-1.23-2.86-1.23-2.86-1.7 1.27-2.33-.28-2.33-.28-3.11 3.3-6.35.23-6.35.23v4.42c0 2.57-2.4 2.57-2.4 2.57H3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3.75 14.84V7.25c0-1.5 1.5-1.5 1.5-1.5H9.5V19h-4c-.83 0-1.75-.97-1.75-2.16v-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9.5 5.75v13.5M13.5 5.75c-.97 0-3 .4-4 1.48V4.23c1-.82 2.5-1.48 4-1.48 2 0 5 1 5 1.5v2c0 .5-3 .5-3 .5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Extension Controls
        </h2>
        <div className="flex items-center space-x-2">
          <button 
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-md hover:bg-neutral-700 text-neutral-300 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          {onClose && (
            <button 
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-neutral-700 text-neutral-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      
      <div className="border-b">
        <nav className="flex divide-x">
          <button
            onClick={() => setActivePanel('status')}
            className={`flex-1 py-2 px-3 flex justify-center items-center text-sm font-medium ${
              activePanel === 'status' ? 'bg-blue-50 text-blue-600' : 'bg-neutral-50 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            Status
          </button>
          <button
            onClick={() => setActivePanel('settings')}
            className={`flex-1 py-2 px-3 flex justify-center items-center text-sm font-medium ${
              activePanel === 'settings' ? 'bg-blue-50 text-blue-600' : 'bg-neutral-50 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            Settings
          </button>
          <button
            onClick={() => setActivePanel('info')}
            className={`flex-1 py-2 px-3 flex justify-center items-center text-sm font-medium ${
              activePanel === 'info' ? 'bg-blue-50 text-blue-600' : 'bg-neutral-50 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            Info
          </button>
        </nav>
      </div>
      
      <div className="p-4">
        {activePanel === 'status' && <ExtensionStatus onRefreshRequest={handleRefresh} />}
        
        {activePanel === 'settings' && <ExtensionSettings />}
        
        {activePanel === 'info' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-lg mb-2 flex items-center">
                <Info className="h-5 w-5 mr-2 text-blue-500" />
                About This Extension
              </h3>
              <p className="text-neutral-600">
                This Chrome extension allows you to integrate TradingView's charting capabilities with Poloniex's trading platform.
                Extract chart data, execute trades directly from the chart, and manage your positions all in one place.
              </p>
            </div>
            
            <div className="bg-neutral-50 p-3 rounded-md">
              <div className="font-medium mb-1">Features:</div>
              <ul className="text-sm text-neutral-600 space-y-1 pl-5 list-disc">
                <li>Real-time data extraction from TradingView charts</li>
                <li>One-click trading directly from TradingView</li>
                <li>Automated trading based on chart indicators</li>
                <li>Account and position management</li>
                <li>Risk management controls</li>
                <li>Secure API credential storage</li>
              </ul>
            </div>
            
            <div className="bg-blue-50 p-3 rounded-md">
              <div className="font-medium mb-1 text-blue-700">Getting Started:</div>
              <ol className="text-sm text-blue-600 space-y-1 pl-5 list-decimal">
                <li>Install the Chrome extension from the Extension page</li>
                <li>Enter your Poloniex API credentials in Settings</li>
                <li>Visit TradingView to activate chart data extraction</li>
                <li>Start trading directly from TradingView charts</li>
              </ol>
            </div>
            
            <div className="mt-4 text-neutral-500 text-xs">
              Extension Version: 1.0.0
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExtensionControls;
