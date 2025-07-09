// React is used implicitly for JSX transformation
import { useState, useEffect } from 'react';
import { Shield, Lock, TerminalSquare, Zap } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';

interface ExtensionSettingsProps {
  onClose?: () => void;
}

interface ExtensionResponse {
  installed?: boolean;
  connected?: boolean;
  status?: string;
}

const ExtensionSettings: React.FC<ExtensionSettingsProps> = ({ onClose }) => {
  const { apiKey, apiSecret, updateSettings } = useSettings();
  const [extensionStatus, setExtensionStatus] = useState<string>('Not detected');
  const [formData, setFormData] = useState({
    extensionEnabled: true,
    tradingViewEnabled: true,
    poloniexEnabled: true,
    autoConnect: true,
    notificationsEnabled: true,
    riskLimit: 50,
    apiKey: apiKey,
    apiSecret: apiSecret
  });

  // Check if the extension is installed
  useEffect(() => {
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        // Extension ID will need to be updated with your actual extension ID
        const extensionId = 'jcdmopolmojdhpclfbemdpcdneobmnje';
        
        chrome.runtime.sendMessage(
          extensionId,
          { type: 'CHECK_INSTALLATION' },
          (response: ExtensionResponse) => {
            if (response && response.installed) {
              setExtensionStatus('Connected');
            } else {
              setExtensionStatus('Not detected');
            }
          }
        );
      } catch {
        setExtensionStatus('Not detected');
      }
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: parseInt(value, 10)
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Save API credentials
    if (formData.apiKey !== apiKey || formData.apiSecret !== apiSecret) {
      updateSettings({
        apiKey: formData.apiKey,
        apiSecret: formData.apiSecret
      });
    }
    
    // If we have a chrome extension API and it's installed
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage && extensionStatus === 'Connected') {
      // Extension ID will need to be updated with your actual extension ID
      const extensionId = 'jcdmopolmojdhpclfbemdpcdneobmnje';
      
      // Update extension settings
      chrome.runtime.sendMessage(
        extensionId,
        { 
          type: 'UPDATE_SETTINGS',
          data: {
            extensionEnabled: formData.extensionEnabled,
            tradingViewEnabled: formData.tradingViewEnabled,
            poloniexEnabled: formData.poloniexEnabled,
            autoConnect: formData.autoConnect,
            notificationsEnabled: formData.notificationsEnabled,
            riskLimit: formData.riskLimit
          }
        },
        (response: ExtensionResponse) => {
          console.log('Extension settings updated:', response);
        }
      );
      
      // Update extension API credentials
      chrome.runtime.sendMessage(
        extensionId,
        {
          type: 'UPDATE_CREDENTIALS',
          data: {
            apiKey: formData.apiKey,
            apiSecret: formData.apiSecret
          }
        },
        (response: ExtensionResponse) => {
          console.log('Extension API credentials updated:', response);
        }
      );
    }
    
    // Close the settings panel if a handler was provided
    if (onClose) {
      onClose();
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow-lg p-5">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold flex items-center">
          <Shield className="h-5 w-5 mr-2 text-blue-500" />
          Extension Settings
        </h2>
        <div className={`px-2 py-1 text-xs rounded-full ${
          extensionStatus === 'Connected' 
            ? 'bg-green-100 text-green-800' 
            : 'bg-yellow-100 text-yellow-800'
        }`}>
          {extensionStatus}
        </div>
      </div>
      
      <form onSubmit={handleSubmit}>
        <div className="space-y-5">
          <div className="border-b pb-4">
            <h3 className="font-medium mb-3 flex items-center">
              <TerminalSquare className="h-4 w-4 mr-2 text-neutral-500" />
              Extension Configuration
            </h3>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label htmlFor="extensionEnabled" className="text-sm text-neutral-700">
                  Enable Extension
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input 
                    type="checkbox" 
                    id="extensionEnabled" 
                    name="extensionEnabled"
                    checked={formData.extensionEnabled}
                    onChange={handleChange}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-neutral-200 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-5 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <label htmlFor="tradingViewEnabled" className="text-sm text-neutral-700">
                  TradingView Integration
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input 
                    type="checkbox" 
                    id="tradingViewEnabled" 
                    name="tradingViewEnabled"
                    checked={formData.tradingViewEnabled}
                    onChange={handleChange}
                    disabled={!formData.extensionEnabled}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-neutral-200 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-5 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <label htmlFor="poloniexEnabled" className="text-sm text-neutral-700">
                  Poloniex Integration
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input 
                    type="checkbox" 
                    id="poloniexEnabled" 
                    name="poloniexEnabled"
                    checked={formData.poloniexEnabled}
                    onChange={handleChange}
                    disabled={!formData.extensionEnabled}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-neutral-200 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-5 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <label htmlFor="autoConnect" className="text-sm text-neutral-700">
                  Auto-connect on startup
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input 
                    type="checkbox" 
                    id="autoConnect" 
                    name="autoConnect"
                    checked={formData.autoConnect}
                    onChange={handleChange}
                    disabled={!formData.extensionEnabled}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-neutral-200 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-5 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <label htmlFor="notificationsEnabled" className="text-sm text-neutral-700">
                  Enable Notifications
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input 
                    type="checkbox" 
                    id="notificationsEnabled" 
                    name="notificationsEnabled"
                    checked={formData.notificationsEnabled}
                    onChange={handleChange}
                    disabled={!formData.extensionEnabled}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-neutral-200 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-5 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="border-b pb-4">
            <h3 className="font-medium mb-3 flex items-center">
              <Zap className="h-4 w-4 mr-2 text-neutral-500" />
              Trading Risk Management
            </h3>
            
            <div>
              <label htmlFor="riskLimit" className="block text-sm text-neutral-700 mb-1">
                Max Position Size (% of Available Balance)
              </label>
              <div className="flex items-center">
                <input
                  type="range"
                  id="riskLimit"
                  name="riskLimit"
                  min="5"
                  max="100"
                  step="5"
                  value={formData.riskLimit}
                  onChange={handleRangeChange}
                  disabled={!formData.extensionEnabled}
                  className="w-full h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer"
                />
                <span className="ml-2 text-sm font-medium text-neutral-700 min-w-10">
                  {formData.riskLimit}%
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                Limits the maximum size of any position you can open through the extension.
              </p>
            </div>
          </div>
          
          <div>
            <h3 className="font-medium mb-3 flex items-center">
              <Lock className="h-4 w-4 mr-2 text-neutral-500" />
              API Credentials
            </h3>
            
            <div className="space-y-3">
              <div>
                <label htmlFor="apiKey" className="block text-sm text-neutral-700 mb-1">
                  Poloniex API Key
                </label>
                <input
                  type="password"
                  id="apiKey"
                  name="apiKey"
                  value={formData.apiKey}
                  onChange={handleChange}
                  placeholder="Your API Key"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
              
              <div>
                <label htmlFor="apiSecret" className="block text-sm text-neutral-700 mb-1">
                  Poloniex API Secret
                </label>
                <input
                  type="password"
                  id="apiSecret"
                  name="apiSecret"
                  value={formData.apiSecret}
                  onChange={handleChange}
                  placeholder="Your API Secret"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
              
              <p className="text-xs text-neutral-500 mt-1">
                Your API keys are stored securely and never shared.
                Create API keys with trading permissions in your Poloniex account.
              </p>
            </div>
          </div>
          
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Save Settings
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default ExtensionSettings;
