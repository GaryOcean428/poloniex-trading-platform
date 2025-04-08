// No need for React import in this utility file

// Define a type for Chrome extension API to avoid type errors
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage?: (message: any, callback?: (response: any) => void) => void;
        onMessage?: {
          addListener?: (callback: (message: any, sender: any, sendResponse: any) => void) => void;
        };
      };
      tabs?: {
        query?: (queryInfo: any, callback: (tabs: any[]) => void) => void;
        create?: (createProperties: any, callback?: (tab: any) => void) => void;
      };
      storage?: {
        local?: {
          get?: (keys: string | string[] | object | null, callback: (items: any) => void) => void;
          set?: (items: object, callback?: () => void) => void;
        };
      };
    };
  }
}

/**
 * Safely checks if Chrome extension API is available
 */
export const isChromeExtension = (): boolean => {
  return typeof window !== 'undefined' && 
         typeof window.chrome !== 'undefined' && 
         typeof window.chrome.runtime !== 'undefined';
};

/**
 * Safely sends a message to Chrome extension
 * @param message Message to send
 * @param callback Optional callback function
 */
export const sendChromeMessage = (message: any, callback?: (response: any) => void): void => {
  if (isChromeExtension() && window.chrome?.runtime?.sendMessage) {
    window.chrome.runtime.sendMessage(message, callback);
  } else {
    console.warn('Chrome extension API not available');
    if (callback) {
      callback({ error: 'Chrome extension API not available' });
    }
  }
};

/**
 * Safely gets data from Chrome storage
 * @param key Storage key
 * @param callback Callback function
 */
export const getChromeStorage = (key: string, callback: (data: any) => void): void => {
  if (isChromeExtension() && window.chrome?.storage?.local?.get) {
    window.chrome.storage.local.get(key, callback);
  } else {
    console.warn('Chrome storage API not available');
    callback({ error: 'Chrome storage API not available' });
  }
};

/**
 * Safely sets data in Chrome storage
 * @param data Data to store
 * @param callback Optional callback function
 */
export const setChromeStorage = (data: object, callback?: () => void): void => {
  if (isChromeExtension() && window.chrome?.storage?.local?.set) {
    window.chrome.storage.local.set(data, callback);
  } else {
    console.warn('Chrome storage API not available');
    if (callback) {
      callback();
    }
  }
};

export default {
  isChromeExtension,
  sendChromeMessage,
  getChromeStorage,
  setChromeStorage
};
