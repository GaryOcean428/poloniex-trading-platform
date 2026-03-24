import { getChromeRuntime } from './chromeExtensionCheck';

// Types for Chrome extension messaging
export interface ChromeMessage {
  type: string;
  data?: unknown;
  source?: string;
}

export interface ChromeSender {
  tab?: chrome.tabs.Tab;
  frameId?: number;
  id?: string;
  url?: string;
  tlsChannelId?: string;
}

export type ChromeMessageListener = (
  message: ChromeMessage,
  sender: ChromeSender,
  sendResponse: (response?: unknown) => void
) => void | boolean;

// Helper to safely use Chrome messaging API
export const chromeMessaging = {
  sendMessage: async (message: ChromeMessage): Promise<unknown> => {
    const runtime = getChromeRuntime();
    if (!runtime || !runtime.sendMessage) {
      return null;
    }
    
    return new Promise((resolve) => {
      try {
        runtime.sendMessage(message, (response) => {
          // Consume chrome.runtime.lastError to prevent unhandled message channel errors
          if (runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(response || null);
        });
      } catch {
        resolve(null);
      }
    });
  },
  
  addListener: (callback: ChromeMessageListener): void => {
    const runtime = getChromeRuntime();
    if (!runtime || !runtime.onMessage) {
      return;
    }
    
    runtime.onMessage.addListener(callback);
  },
  
  removeListener: (callback: ChromeMessageListener): void => {
    const runtime = getChromeRuntime();
    if (!runtime || !runtime.onMessage) {
      return;
    }
    
    runtime.onMessage.removeListener(callback);
  }
};