/**
 * Storage utility for managing persistent data
 */

// Define keys for local storage
export const STORAGE_KEYS = {
  API_KEY: 'poloniex_api_key',
  API_SECRET: 'poloniex_api_secret',
  IS_LIVE_TRADING: 'poloniex_is_live_trading',
  NOTIFICATIONS: 'poloniex_notifications',
  DARK_MODE: 'poloniex_dark_mode',
  DEFAULT_PAIR: 'poloniex_default_pair',
  EMAIL_NOTIFICATIONS: 'poloniex_email_notifications',
  TRADE_NOTIFICATIONS: 'poloniex_trade_notifications',
  PRICE_ALERTS: 'poloniex_price_alerts',
  CHAT_NOTIFICATIONS: 'poloniex_chat_notifications',
  SHOW_EXTENSION: 'poloniex_show_extension'
};

/**
 * Get a value from local storage
 */
export const getStorageItem = <T>(key: string, defaultValue: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error(`Error getting item from storage: ${key}`, error);
    return defaultValue;
  }
};

/**
 * Set a value in local storage
 */
export const setStorageItem = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error setting item in storage: ${key}`, error);
  }
};

/**
 * Remove a value from local storage
 */
export const removeStorageItem = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(`Error removing item from storage: ${key}`, error);
  }
};

/**
 * Clear all app related items from local storage
 */
export const clearAppStorage = (): void => {
  try {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  } catch (error) {
    console.error('Error clearing app storage', error);
  }
};

/**
 * Check if local storage is available
 */
export const isStorageAvailable = (): boolean => {
  try {
    const test = '__storage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
};