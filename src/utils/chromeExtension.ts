// No need for React import in this utility file

// Use a different approach to avoid conflicts with @types/chrome
// Instead of extending Window interface, use runtime checks

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
    // Fix the callback type issue by providing a non-undefined callback
    window.chrome.storage.local.set(data, callback || (() => {}));
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
