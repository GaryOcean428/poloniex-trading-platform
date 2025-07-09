import { isChromeExtension } from './chromeExtensionCheck';

// Types for Chrome storage operations
export type StorageValue = string | number | boolean | object | null;
export type StorageItems = Record<string, StorageValue>;
export type StorageKeys = string | string[] | Record<string, StorageValue> | null;

// Helper to safely use Chrome storage API
export const chromeStorage = {
  get: async (keys: StorageKeys): Promise<StorageItems> => {
    if (!isChromeExtension()) {
      return {};
    }
    
    return new Promise((resolve) => {
      window.chrome?.storage?.local.get(keys, (items) => {
        resolve(items || {});
      });
    });
  },
  
  set: async (items: StorageItems): Promise<void> => {
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