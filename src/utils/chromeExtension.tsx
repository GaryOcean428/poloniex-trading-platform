import React from 'react';
import { FuturesProvider } from '@/context/FuturesContext';
import { AuthProvider } from '@/context/AuthContext';
import { SettingsProvider } from '@/context/SettingsContext';

// Chrome extension API type definitions
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        id?: string;
        sendMessage?: (message: any, callback?: (response: any) => void) => void;
        onMessage?: {
          addListener: (callback: (message: any, sender: any, sendResponse: any) => void) => void;
          removeListener: (callback: (message: any, sender: any, sendResponse: any) => void) => void;
        };
      };
      storage?: {
        local: {
          get: (keys: string | string[] | object | null, callback: (items: { [key: string]: any }) => void) => void;
          set: (items: { [key: string]: any }, callback?: () => void) => void;
          remove: (keys: string | string[], callback?: () => void) => void;
          clear: (callback?: () => void) => void;
        };
        sync: {
          get: (keys: string | string[] | object | null, callback: (items: { [key: string]: any }) => void) => void;
          set: (items: { [key: string]: any }, callback?: () => void) => void;
          remove: (keys: string | string[], callback?: () => void) => void;
          clear: (callback?: () => void) => void;
        };
      };
      tabs?: {
        query: (queryInfo: any, callback: (tabs: any[]) => void) => void;
        create: (createProperties: any, callback?: (tab: any) => void) => void;
        update: (tabId: number, updateProperties: any, callback?: (tab?: any) => void) => void;
      };
    };
  }
}

// Helper to check if running in Chrome extension environment
export const isChromeExtension = (): boolean => {
  return typeof window !== 'undefined' && 
         typeof window.chrome !== 'undefined' && 
         typeof window.chrome.runtime !== 'undefined' && 
         typeof window.chrome.runtime.id !== 'undefined';
};

// Helper to safely use Chrome storage API
export const chromeStorage = {
  get: async (keys: string | string[] | object | null): Promise<{ [key: string]: any }> => {
    if (!isChromeExtension()) {
      return {};
    }
    
    return new Promise((resolve) => {
      window.chrome?.storage?.local.get(keys, (items) => {
        resolve(items || {});
      });
    });
  },
  
  set: async (items: { [key: string]: any }): Promise<void> => {
    if (!isChromeExtension()) {
      return;
    }
    
    return new Promise((resolve) => {
      window.chrome?.storage?.local.set(items, () => {
        resolve();
      });
    });
  },
  
  remove: async (keys: string | string[]): Promise<void> => {
    if (!isChromeExtension()) {
      return;
    }
    
    return new Promise((resolve) => {
      window.chrome?.storage?.local.remove(keys, () => {
        resolve();
      });
    });
  },
  
  clear: async (): Promise<void> => {
    if (!isChromeExtension()) {
      return;
    }
    
    return new Promise((resolve) => {
      window.chrome?.storage?.local.clear(() => {
        resolve();
      });
    });
  }
};

// Helper to safely use Chrome tabs API
export const chromeTabs = {
  query: async (queryInfo: any): Promise<any[]> => {
    if (!isChromeExtension()) {
      return [];
    }
    
    return new Promise((resolve) => {
      window.chrome?.tabs?.query(queryInfo, (tabs) => {
        resolve(tabs || []);
      });
    });
  },
  
  create: async (createProperties: any): Promise<any> => {
    if (!isChromeExtension()) {
      return null;
    }
    
    return new Promise((resolve) => {
      window.chrome?.tabs?.create(createProperties, (tab) => {
        resolve(tab || null);
      });
    });
  },
  
  update: async (tabId: number, updateProperties: any): Promise<any> => {
    if (!isChromeExtension()) {
      return null;
    }
    
    return new Promise((resolve) => {
      window.chrome?.tabs?.update(tabId, updateProperties, (tab) => {
        resolve(tab || null);
      });
    });
  }
};

// Helper to safely use Chrome messaging API
export const chromeMessaging = {
  sendMessage: async (message: any): Promise<any> => {
    if (!isChromeExtension()) {
      return null;
    }
    
    return new Promise((resolve) => {
      window.chrome?.runtime?.sendMessage(message, (response) => {
        resolve(response || null);
      });
    });
  },
  
  addListener: (callback: (message: any, sender: any, sendResponse: any) => void): void => {
    if (!isChromeExtension()) {
      return;
    }
    
    window.chrome?.runtime?.onMessage?.addListener(callback);
  },
  
  removeListener: (callback: (message: any, sender: any, sendResponse: any) => void): void => {
    if (!isChromeExtension()) {
      return;
    }
    
    window.chrome?.runtime?.onMessage?.removeListener(callback);
  }
};

// Root provider component that wraps the application with all necessary context providers
interface AppProvidersProps {
  children: React.ReactNode;
}

const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  return (
    <AuthProvider>
      <SettingsProvider>
        <FuturesProvider>
          {children}
        </FuturesProvider>
      </SettingsProvider>
    </AuthProvider>
  );
};

export default AppProviders;
