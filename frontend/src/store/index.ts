import CryptoJS from "crypto-js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

 

// Define store state interface
export interface AppState {
  // API Configuration
  apiCredentials: {
    apiKey: string;
    apiSecret: string;
    isLiveTrading: boolean;
  };

  // UI State
  ui: {
    darkMode: boolean;
    showExtension: boolean;
    notifications: {
      email: boolean;
      trade: boolean;
      price: boolean;
      chat: boolean;
    };
  };

  // Trading Configuration
  trading: {
    defaultPair: string;
    mockMode: boolean;
  };

  // Toast Notifications
  toasts: Array<{
    id: string;
    message: string;
    type: "success" | "error" | "warning" | "info";
    timestamp: number;
    dismissible: boolean;
  }>;

  // App Notifications
  appNotifications: Array<{
    id: string;
    type: "success" | "error" | "warning" | "info";
    title: string;
    message: string;
    timestamp: number;
    read: boolean;
  }>;
}

// Define store actions interface
export interface AppActions {
  // API Credentials
  setApiCredentials: (credentials: Partial<AppState["apiCredentials"]>) => void;
  clearApiCredentials: () => void;

  // UI Actions
  setDarkMode: (enabled: boolean) => void;
  setShowExtension: (show: boolean) => void;
  setNotifications: (
    notifications: Partial<AppState["ui"]["notifications"]>
  ) => void;

  // Trading Actions
  setDefaultPair: (pair: string) => void;
  setMockMode: (enabled: boolean) => void;

  // Toast Actions
  addToast: (toast: Omit<AppState["toasts"][0], "id" | "timestamp">) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;

  // App Notification Actions
  addNotification: (notification: Omit<AppState["appNotifications"][0], "id" | "timestamp">) => void;
  markNotificationAsRead: (id: string) => void;
  clearAllNotifications: () => void;
}

// Encryption key for sensitive data
const ENCRYPTION_KEY = "poloniex-trading-platform-key";

// Encrypt sensitive data
const encryptData = (data: string): string => {
  try {
    return CryptoJS.AES.encrypt(data, ENCRYPTION_KEY).toString();
  } catch (_error) {
    // console.error("Encryption failed:", error);
    return data;
  }
};

// Decrypt sensitive data
const decryptData = (encryptedData: string): string => {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (_error) {
    // console.error("Decryption failed:", error);
    return encryptedData;
  }
};

// Custom storage with encryption for sensitive data
const createEncryptedStorage = () => ({
  getItem: (name: string): string | null => {
    const item = localStorage.getItem(name);
    if (!item) return null;

    try {
      const parsed = JSON.parse(item);
      if (parsed.state?.apiCredentials) {
        // Decrypt API credentials
        if (parsed.state.apiCredentials.apiKey) {
          parsed.state.apiCredentials.apiKey = decryptData(
            parsed.state.apiCredentials.apiKey
          );
        }
        if (parsed.state.apiCredentials.apiSecret) {
          parsed.state.apiCredentials.apiSecret = decryptData(
            parsed.state.apiCredentials.apiSecret
          );
        }
      }
      return JSON.stringify(parsed);
    } catch (_error) {
      // console.error("Error parsing stored data:", error);
      return item;
    }
  },

  setItem: (name: string, value: string): void => {
    try {
      const parsed = JSON.parse(value);
      if (parsed.state?.apiCredentials) {
        // Encrypt API credentials before storing
        if (parsed.state.apiCredentials.apiKey) {
          parsed.state.apiCredentials.apiKey = encryptData(
            parsed.state.apiCredentials.apiKey
          );
        }
        if (parsed.state.apiCredentials.apiSecret) {
          parsed.state.apiCredentials.apiSecret = encryptData(
            parsed.state.apiCredentials.apiSecret
          );
        }
      }
      localStorage.setItem(name, JSON.stringify(parsed));
    } catch (_error) {
      // console.error("Error storing data:", error);
      localStorage.setItem(name, value);
    }
  },

  removeItem: (name: string): void => {
    localStorage.removeItem(name);
  },
});

// Default state
const defaultState: AppState = {
  apiCredentials: {
    apiKey: "",
    apiSecret: "",
    isLiveTrading: false,
  },
  ui: {
    darkMode: false,
    showExtension: true,
    notifications: {
      email: true,
      trade: true,
      price: true,
      chat: true,
    },
  },
  trading: {
    defaultPair: "BTC_USDT",
    mockMode: false,  // Production default: use real trading
  },
  toasts: [],
  appNotifications: []
};

// Create the store
export const useAppStore = create<AppState & AppActions>()(
  persist(
    immer((set) => ({
      ...defaultState,

      // API Credentials Actions
      setApiCredentials: (credentials) =>
        set((state) => {
          Object.assign(state.apiCredentials, credentials);
        }),

      clearApiCredentials: () =>
        set((state) => {
          state.apiCredentials = {
            apiKey: "",
            apiSecret: "",
            isLiveTrading: false,
          };
        }),

      // UI Actions
      setDarkMode: (enabled) =>
        set((state) => {
          state.ui.darkMode = enabled;
          if (enabled) {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        }),

      setShowExtension: (show) =>
        set((state) => {
          state.ui.showExtension = show;
        }),

      setNotifications: (notifications) =>
        set((state) => {
          Object.assign(state.ui.notifications, notifications);
        }),

      // Trading Actions
      setDefaultPair: (pair) =>
        set((state) => {
          state.trading.defaultPair = pair;
        }),

      setMockMode: (enabled) =>
        set((state) => {
          state.trading.mockMode = enabled;
        }),

      // Toast Actions
      addToast: (toast) =>
        set((state) => {
          const newToast = {
            ...toast,
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            timestamp: Date.now(),
          };
          state.toasts.push(newToast);
        }),

      removeToast: (id) =>
        set((state) => {
          const index = state.toasts.findIndex((t) => t.id === id);
          if (index !== -1) {
            state.toasts.splice(index, 1);
          }
        }),

      clearToasts: () =>
        set((state) => {
          state.toasts = [];
        }),

      // App Notification Actions
      addNotification: (notification) =>
        set((state) => {
          const newNotification = {
            ...notification,
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            timestamp: Date.now(),
          };
          state.appNotifications.unshift(newNotification);
        }),

      markNotificationAsRead: (id) =>
        set((state) => {
          const notification = state.appNotifications.find((n) => n.id === id);
          if (notification) {
            notification.read = true;
          }
        }),

      clearAllNotifications: () =>
        set((state) => {
          state.appNotifications = [];
        }),
    })),
    {
      name: "poloniex-app-storage",
      storage: createJSONStorage(() => createEncryptedStorage()),
      partialize: (state) => ({
        apiCredentials: state.apiCredentials,
        ui: state.ui,
        trading: state.trading,
        // Don't persist toasts
      }),
    }
  )
);

// Selector hooks for better performance
export const useApiCredentials = () =>
  useAppStore((state) => state.apiCredentials);
export const useUISettings = () => useAppStore((state) => state.ui);
export const useTradingSettings = () => useAppStore((state) => state.trading);
export const useToasts = () => useAppStore((state) => state.toasts);
export const useAppNotifications = () => useAppStore((state) => state.appNotifications);

// Action hooks
export const useApiActions = () =>
  useAppStore((state) => ({
    setApiCredentials: state.setApiCredentials,
    clearApiCredentials: state.clearApiCredentials,
  }));

export const useUIActions = () =>
  useAppStore((state) => ({
    setDarkMode: state.setDarkMode,
    setShowExtension: state.setShowExtension,
    setNotifications: state.setNotifications,
  }));

export const useTradingActions = () =>
  useAppStore((state) => ({
    setDefaultPair: state.setDefaultPair,
    setMockMode: state.setMockMode,
  }));

export const useToastActions = () =>
  useAppStore((state) => ({
    addToast: state.addToast,
    removeToast: state.removeToast,
    clearToasts: state.clearToasts,
  }));

export const useNotificationActions = () =>
  useAppStore((state) => ({
    addNotification: state.addNotification,
    markNotificationAsRead: state.markNotificationAsRead,
    clearAllNotifications: state.clearAllNotifications,
  }));

// Helper to initialize sample notifications
export const initializeSampleNotifications = () => {
  const store = useAppStore.getState();
  if (store.appNotifications.length === 0) {
    const baseTimestamp = Date.now();
    store.addNotification({
      type: "warning",
      title: "API Rate Limit",
      message: "Approaching API rate limit. Consider reducing frequency.",
      read: false
    });
    store.addNotification({
      type: "info",
      title: "Market Update",
      message: "BTC/USDT market data is now streaming.",
      read: false
    });
    store.addNotification({
      type: "success",
      title: "System Ready",
      message: "Trading platform is connected and ready to use.",
      read: false
    });
  }
};
