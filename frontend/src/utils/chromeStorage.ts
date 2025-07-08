import { isChromeExtension } from './chromeExtensionCheck';

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