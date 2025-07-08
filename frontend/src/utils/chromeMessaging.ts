import { isChromeExtension } from './chromeExtensionCheck';

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
    
    window.chrome?.runtime?.onMessage.addListener(callback);
  },
  
  removeListener: (callback: (message: any, sender: any, sendResponse: any) => void): void => {
    if (!isChromeExtension()) {
      return;
    }
    
    window.chrome?.runtime?.onMessage.removeListener(callback);
  }
};