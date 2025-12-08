import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { getStorageItem, setStorageItem, STORAGE_KEYS, isStorageAvailable } from '@/utils/storage';

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
  chartType: 'candle' | 'line' | 'area';
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  leverage: number;
  riskPerTrade: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent: number;
  autoTradingEnabled: boolean;
  dateFormat: 'AU' | 'US';
  updateSettings: (settings: Partial<SettingsState>) => void;
  resetSettings: () => void;
  hasStoredCredentials: boolean;
  exportSettings: () => string;
  importSettings: (settingsJson: string) => boolean;
  mockMode?: boolean; // Added for FuturesContext
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
  chartType: 'candle' | 'line' | 'area';
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  leverage: number;
  riskPerTrade: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent: number;
  autoTradingEnabled: boolean;
  dateFormat: 'AU' | 'US';
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
  showExtension: true,
  chartType: 'candle',
  timeframe: '5m',
  leverage: 1,
  riskPerTrade: 2,
  stopLossPercent: 2,
  takeProfitPercent: 4,
  trailingStopPercent: 1,
  autoTradingEnabled: false,
  dateFormat: 'AU'
};

// Define storage keys
const EXTENDED_STORAGE_KEYS = {
  ...STORAGE_KEYS,
  CHART_TYPE: 'poloniex_chart_type',
  TIMEFRAME: 'poloniex_timeframe',
  LEVERAGE: 'poloniex_leverage',
  RISK_PER_TRADE: 'poloniex_risk_per_trade',
  STOP_LOSS_PERCENT: 'poloniex_stop_loss_percent',
  TAKE_PROFIT_PERCENT: 'poloniex_take_profit_percent',
  TRAILING_STOP_PERCENT: 'poloniex_trailing_stop_percent',
  AUTO_TRADING_ENABLED: 'poloniex_auto_trading_enabled',
  DATE_FORMAT: 'dateFormat'
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export { SettingsContext };

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
      apiKey: getStorageItem(EXTENDED_STORAGE_KEYS.API_KEY, import.meta.env.VITE_POLONIEX_API_KEY || ''),
      apiSecret: getStorageItem(EXTENDED_STORAGE_KEYS.API_SECRET, import.meta.env.VITE_POLONIEX_API_SECRET || ''),
      isLiveTrading: getStorageItem(EXTENDED_STORAGE_KEYS.IS_LIVE_TRADING, false),
      darkMode: getStorageItem(EXTENDED_STORAGE_KEYS.DARK_MODE, false),
      defaultPair: getStorageItem(EXTENDED_STORAGE_KEYS.DEFAULT_PAIR, 'BTC-USDT'),
      emailNotifications: getStorageItem(EXTENDED_STORAGE_KEYS.EMAIL_NOTIFICATIONS, true),
      tradeNotifications: getStorageItem(EXTENDED_STORAGE_KEYS.TRADE_NOTIFICATIONS, true),
      priceAlerts: getStorageItem(EXTENDED_STORAGE_KEYS.PRICE_ALERTS, false),
      chatNotifications: getStorageItem(EXTENDED_STORAGE_KEYS.CHAT_NOTIFICATIONS, true),
      showExtension: getStorageItem(EXTENDED_STORAGE_KEYS.SHOW_EXTENSION, true),
      chartType: getStorageItem(EXTENDED_STORAGE_KEYS.CHART_TYPE, 'candle'),
      timeframe: getStorageItem(EXTENDED_STORAGE_KEYS.TIMEFRAME, '5m'),
      leverage: getStorageItem(EXTENDED_STORAGE_KEYS.LEVERAGE, 1),
      riskPerTrade: getStorageItem(EXTENDED_STORAGE_KEYS.RISK_PER_TRADE, 2),
      stopLossPercent: getStorageItem(EXTENDED_STORAGE_KEYS.STOP_LOSS_PERCENT, 2),
      takeProfitPercent: getStorageItem(EXTENDED_STORAGE_KEYS.TAKE_PROFIT_PERCENT, 4),
      trailingStopPercent: getStorageItem(EXTENDED_STORAGE_KEYS.TRAILING_STOP_PERCENT, 1),
      autoTradingEnabled: getStorageItem(EXTENDED_STORAGE_KEYS.AUTO_TRADING_ENABLED, false),
      dateFormat: getStorageItem(EXTENDED_STORAGE_KEYS.DATE_FORMAT, 'AU')
    };
  };

  const [settings, setSettings] = useState<SettingsState>(getInitialSettings);
  const [hasStoredCredentials, setHasStoredCredentials] = useState<boolean>(false);

  // Check if we have credentials stored
  useEffect(() => {
    setHasStoredCredentials(Boolean(settings.apiKey && settings.apiSecret));
  }, [settings.apiKey, settings.apiSecret]);

  // Apply dark mode setting to document
  useEffect(() => {
    if (settings.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings.darkMode]);

  // Update settings in state and localStorage
  const updateSettings = (newSettings: Partial<SettingsState>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      
      // Special handling for live trading mode
      if (newSettings.isLiveTrading !== undefined) {
        // Only allow live trading if we have API credentials
        if (newSettings.isLiveTrading && (!updated.apiKey || !updated.apiSecret)) {
          // console.log('Cannot enable live trading without API credentials');
          updated.isLiveTrading = false;
        }
      }
      
      // Only persist to localStorage if it's available
      if (canUseStorage) {
        // Persist each updated setting to localStorage
        Object.entries(newSettings).forEach(([key, value]) => {
          const storageKey = EXTENDED_STORAGE_KEYS[key.toUpperCase() as keyof typeof EXTENDED_STORAGE_KEYS] || `poloniex_${key}`;
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
      Object.values(EXTENDED_STORAGE_KEYS).forEach(key => {
        localStorage.removeItem(key);
      });
    }
  };

  // Export settings to JSON string
  const exportSettings = (): string => {
    try {
      // Create a copy of settings without sensitive data
      const exportableSettings = { ...settings };
      const sensitiveKeys: (keyof SettingsState)[] = ['apiKey', 'apiSecret'];
      
      sensitiveKeys.forEach(key => {
        if (key in exportableSettings) {
          delete exportableSettings[key];
        }
      });
      
      return JSON.stringify(exportableSettings);
    } catch (_error) {
      // console.error('Error exporting settings:', error);
      return '';
    }
  };

  // Import settings from JSON string
  const importSettings = (settingsJson: string): boolean => {
    try {
      const importedSettings = JSON.parse(settingsJson);
      
      // Validate imported settings
      if (typeof importedSettings !== 'object' || importedSettings === null) {
        throw new Error('Invalid settings format');
      }
      
      // Don't import sensitive data
      const sensitiveKeys: (keyof SettingsState)[] = ['apiKey', 'apiSecret'];
      sensitiveKeys.forEach(key => {
        if (key in importedSettings) {
          delete importedSettings[key];
        }
      });
      
      // Update settings
      updateSettings(importedSettings);
      return true;
    } catch (_error) {
      // console.error('Error importing settings:', error);
      return false;
    }
  };

  return (
    <SettingsContext.Provider
      value={{
        ...settings,
        updateSettings,
        resetSettings,
        hasStoredCredentials,
        exportSettings,
        importSettings,
        mockMode: !settings.isLiveTrading // Added for FuturesContext
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

// End of component
