import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getStorageItem, setStorageItem, STORAGE_KEYS, isStorageAvailable } from '../utils/storage';

interface SettingsContextType {
  apiKey: string;
  apiSecret: string;
  isLiveTrading: boolean;
  darkMode: boolean;
  defaultPair: string;
  emailNotifications: boolean;
  tradeNotifications: boolean;
  priceAlerts: boolean;
  chatNotifications: boolean;
  showExtension: boolean;
  updateSettings: (settings: Partial<SettingsState>) => void;
  resetSettings: () => void;
  hasStoredCredentials: boolean;
}

interface SettingsState {
  apiKey: string;
  apiSecret: string;
  isLiveTrading: boolean;
  darkMode: boolean;
  defaultPair: string;
  emailNotifications: boolean;
  tradeNotifications: boolean;
  priceAlerts: boolean;
  chatNotifications: boolean;
  showExtension: boolean;
}

const defaultSettings: SettingsState = {
  apiKey: '',
  apiSecret: '',
  isLiveTrading: false,
  darkMode: false,
  defaultPair: 'BTC-USDT',
  emailNotifications: true,
  tradeNotifications: true,
  priceAlerts: false,
  chatNotifications: true,
  showExtension: true
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

interface SettingsProviderProps {
  children: ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ children }) => {
  // Check if we can access localStorage
  const canUseStorage = isStorageAvailable();
  
  // Get initial settings from localStorage or environment variables
  const getInitialSettings = (): SettingsState => {
    if (!canUseStorage) {
      return {
        ...defaultSettings,
        apiKey: import.meta.env.VITE_POLONIEX_API_KEY || '',
        apiSecret: import.meta.env.VITE_POLONIEX_API_SECRET || ''
      };
    }

    return {
      apiKey: getStorageItem(STORAGE_KEYS.API_KEY, import.meta.env.VITE_POLONIEX_API_KEY || ''),
      apiSecret: getStorageItem(STORAGE_KEYS.API_SECRET, import.meta.env.VITE_POLONIEX_API_SECRET || ''),
      isLiveTrading: getStorageItem(STORAGE_KEYS.IS_LIVE_TRADING, false),
      darkMode: getStorageItem(STORAGE_KEYS.DARK_MODE, false),
      defaultPair: getStorageItem(STORAGE_KEYS.DEFAULT_PAIR, 'BTC-USDT'),
      emailNotifications: getStorageItem(STORAGE_KEYS.EMAIL_NOTIFICATIONS, true),
      tradeNotifications: getStorageItem(STORAGE_KEYS.TRADE_NOTIFICATIONS, true),
      priceAlerts: getStorageItem(STORAGE_KEYS.PRICE_ALERTS, false),
      chatNotifications: getStorageItem(STORAGE_KEYS.CHAT_NOTIFICATIONS, true),
      showExtension: getStorageItem(STORAGE_KEYS.SHOW_EXTENSION, true)
    };
  };

  const [settings, setSettings] = useState<SettingsState>(getInitialSettings);
  const [hasStoredCredentials, setHasStoredCredentials] = useState<boolean>(false);

  // Check if we have credentials stored
  useEffect(() => {
    setHasStoredCredentials(Boolean(settings.apiKey && settings.apiSecret));
  }, [settings.apiKey, settings.apiSecret]);

  // Update settings in state and localStorage
  const updateSettings = (newSettings: Partial<SettingsState>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      
      // Special handling for live trading mode
      if (newSettings.isLiveTrading !== undefined) {
        // Only allow live trading if we have API credentials
        if (newSettings.isLiveTrading && (!updated.apiKey || !updated.apiSecret)) {
          console.log('Cannot enable live trading without API credentials');
          updated.isLiveTrading = false;
        }
      }
      
      // Only persist to localStorage if it's available
      if (canUseStorage) {
        // Persist each updated setting to localStorage
        Object.entries(newSettings).forEach(([key, value]) => {
          const storageKey = STORAGE_KEYS[key.toUpperCase()] || `poloniex_${key}`;
          setStorageItem(storageKey, value);
        });
      }
      
      return updated;
    });
  };

  // Reset all settings to default
  const resetSettings = () => {
    setSettings(defaultSettings);
    
    if (canUseStorage) {
      Object.values(STORAGE_KEYS).forEach(key => {
        localStorage.removeItem(key);
      });
    }
  };

  return (
    <SettingsContext.Provider
      value={{
        ...settings,
        updateSettings,
        resetSettings,
        hasStoredCredentials
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};