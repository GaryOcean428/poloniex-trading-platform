import React, { useState, useEffect } from 'react';
import { 
  User, 
  Lock, 
  Bell, 
  Key, 
  MessageSquare,
  Save,
  AlertTriangle,
  Check,
  X
} from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { usePoloniexData } from '../hooks/usePoloniexData'; 

// Check if we're running in a WebContainer environment
const IS_WEBCONTAINER = typeof window !== 'undefined' && window.location && window.location.hostname.includes('webcontainer-api.io');

const Settings: React.FC = () => {
  const { 
    apiKey, 
    apiSecret, 
    isLiveTrading, 
    emailNotifications, 
    tradeNotifications, 
    priceAlerts, 
    chatNotifications, 
    showExtension,
    updateSettings,
    resetSettings,
    hasStoredCredentials
  } = useSettings();

  // Get the data refresh function from our hook
  const { refreshApiConnection, isMockMode } = usePoloniexData();
  
  // Local state for the form
  const [formData, setFormData] = useState({
    apiKey: '',
    apiSecret: '',
    isLiveTrading: false,
    emailNotifications: true,
    tradeNotifications: true,
    priceAlerts: false,
    chatNotifications: true,
    showExtension: true
  });

  // Save status feedback
  const [saveStatus, setSaveStatus] = useState<{
    show: boolean;
    success: boolean;
    message: string;
  }>({
    show: false,
    success: false,
    message: ''
  });

  // Initialize form with current settings
  useEffect(() => {
    setFormData({
      apiKey: apiKey || '',
      apiSecret: apiSecret || '',
      isLiveTrading,
      emailNotifications,
      tradeNotifications,
      priceAlerts,
      chatNotifications,
      showExtension
    });
  }, [apiKey, apiSecret, isLiveTrading, emailNotifications, tradeNotifications, priceAlerts, chatNotifications, showExtension]);

  // Handle form input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  // Handle form submission
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();

    // Clear previous status
    setSaveStatus({ show: false, success: false, message: '' });

    try {
      // Update settings in context
      updateSettings(formData);

      // Refresh API connection with new credentials
      refreshApiConnection();

      // Show success message
      setSaveStatus({
        show: true,
        success: true,
        message: 'Settings saved successfully'
      });

      // Hide message after 3 seconds
      setTimeout(() => {
        setSaveStatus(prev => ({ ...prev, show: false }));
      }, 3000);
    } catch (error) {
      // Show error message
      setSaveStatus({
        show: true,
        success: false,
        message: 'Error saving settings'
      });
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-1">
        <div className="trading-card">
          <h2 className="text-xl font-bold mb-4">Settings</h2>
          <nav>
            <ul className="space-y-1">
              <li>
                <a href="#api" className="flex items-center py-2 px-3 rounded-md bg-blue-50 text-blue-700">
                  <Key className="h-5 w-5 mr-3" />
                  API Connection
                </a>
              </li>
              <li>
                <a href="#notifications" className="flex items-center py-2 px-3 rounded-md text-gray-700 hover:bg-gray-50">
                  <Bell className="h-5 w-5 mr-3" />
                  Notifications
                </a>
              </li>
              <li>
                <a href="#extension" className="flex items-center py-2 px-3 rounded-md text-gray-700 hover:bg-gray-50">
                  <MessageSquare className="h-5 w-5 mr-3" />
                  Extension Settings
                </a>
              </li>
              <li>
                <a href="#account" className="flex items-center py-2 px-3 rounded-md text-gray-700 hover:bg-gray-50">
                  <User className="h-5 w-5 mr-3" />
                  Account
                </a>
              </li>
            </ul>
          </nav>
          
          {hasStoredCredentials && (
            <div className="mt-4 p-3 bg-blue-50 rounded-md text-sm">
              <div className="flex items-center text-blue-700 font-medium mb-1">
                <Check className="h-4 w-4 mr-1" />
                Credentials Stored
              </div>
              <p className="text-blue-600">
                {isMockMode 
                  ? "Using stored credentials in demo mode" 
                  : "Using stored credentials for live trading"}
              </p>
            </div>
          )}
        </div>
      </div>
      
      <div className="md:col-span-2">
        <form onSubmit={handleSaveSettings}>
          {saveStatus.show && (
            <div className={`mb-4 p-3 rounded-md ${saveStatus.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              <div className="flex items-center">
                {saveStatus.success ? (
                  <Check className="h-5 w-5 mr-2" />
                ) : (
                  <AlertTriangle className="h-5 w-5 mr-2" />
                )}
                <span>{saveStatus.message}</span>
              </div>
            </div>
          )}

          {IS_WEBCONTAINER && (
            <div className="mb-4 p-3 rounded-md bg-yellow-50 border-l-4 border-yellow-400">
              <div className="flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2 text-yellow-500" />
                <span className="text-yellow-700">
                  Running in development environment. Settings will be saved but API connections are simulated.
                </span>
              </div>
            </div>
          )}
          
          <div className="space-y-4">
            <div id="api" className="trading-card">
              <div className="flex items-center mb-4">
                <Key className="h-6 w-6 text-blue-500 mr-2" />
                <h2 className="text-xl font-bold">API Connection</h2>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700">Poloniex API Key</label>
                  <input
                    type="password"
                    id="apiKey"
                    name="apiKey"
                    value={formData.apiKey}
                    onChange={handleChange}
                    className="mt-1 block w-full input"
                    placeholder="Enter your API key"
                  />
                </div>
                
                <div>
                  <label htmlFor="apiSecret" className="block text-sm font-medium text-gray-700">API Secret</label>
                  <input
                    type="password"
                    id="apiSecret"
                    name="apiSecret"
                    value={formData.apiSecret}
                    onChange={handleChange}
                    className="mt-1 block w-full input"
                    placeholder="Enter your API secret"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    Your API keys are stored securely in your browser's local storage and never shared.
                  </p>
                </div>
                
                <div className="flex items-center">
                  <input
                    id="isLiveTrading"
                    name="isLiveTrading"
                    type="checkbox"
                    checked={formData.isLiveTrading}
                    onChange={handleChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="isLiveTrading" className="ml-2 block text-sm text-gray-700">
                    Enable live trading
                  </label>
                </div>
                <p className="text-sm text-yellow-600">
                  <strong>Warning:</strong> Live trading will execute real trades with real funds.
                </p>
              </div>
            </div>
            
            <div id="notifications" className="trading-card">
              <div className="flex items-center mb-4">
                <Bell className="h-6 w-6 text-blue-500 mr-2" />
                <h2 className="text-xl font-bold">Notifications</h2>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Email Notifications</h3>
                    <p className="text-sm text-gray-500">Receive important account updates via email</p>
                  </div>
                  <div className="ml-4">
                    <input
                      type="checkbox"
                      id="emailNotifications"
                      name="emailNotifications"
                      checked={formData.emailNotifications}
                      onChange={handleChange}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Trade Notifications</h3>
                    <p className="text-sm text-gray-500">Get notified when trades are executed</p>
                  </div>
                  <div className="ml-4">
                    <input
                      type="checkbox"
                      id="tradeNotifications"
                      name="tradeNotifications"
                      checked={formData.tradeNotifications}
                      onChange={handleChange}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Price Alerts</h3>
                    <p className="text-sm text-gray-500">Receive alerts when prices reach set thresholds</p>
                  </div>
                  <div className="ml-4">
                    <input
                      type="checkbox"
                      id="priceAlerts"
                      name="priceAlerts"
                      checked={formData.priceAlerts}
                      onChange={handleChange}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                  </div>
                </div>
              </div>
            </div>
            
            <div id="extension" className="trading-card">
              <div className="flex items-center mb-4">
                <MessageSquare className="h-6 w-6 text-blue-500 mr-2" />
                <h2 className="text-xl font-bold">Extension Settings</h2>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Show Extension Icon</h3>
                    <p className="text-sm text-gray-500">Display the extension icon in your browser</p>
                  </div>
                  <div className="ml-4">
                    <input
                      type="checkbox"
                      id="showExtension"
                      name="showExtension"
                      checked={formData.showExtension}
                      onChange={handleChange}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Chat Notifications</h3>
                    <p className="text-sm text-gray-500">Receive notifications for new chat messages</p>
                  </div>
                  <div className="ml-4">
                    <input
                      type="checkbox"
                      id="chatNotifications"
                      name="chatNotifications"
                      checked={formData.chatNotifications}
                      onChange={handleChange}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex justify-between">
              <button
                type="button"
                onClick={resetSettings}
                className="btn btn-secondary flex items-center"
              >
                <X className="h-4 w-4 mr-2" />
                Reset Settings
              </button>
              
              <button
                type="submit"
                className="btn btn-primary flex items-center"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Settings
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Settings;