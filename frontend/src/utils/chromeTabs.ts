import { isChromeExtension } from './chromeExtensionCheck';

// Types for Chrome tabs operations
export interface TabQueryInfo {
  active?: boolean;
  pinned?: boolean;
  audible?: boolean;
  muted?: boolean;
  highlighted?: boolean;
  discarded?: boolean;
  autoDiscardable?: boolean;
  currentWindow?: boolean;
  lastFocusedWindow?: boolean;
  status?: chrome.tabs.TabStatus;
  title?: string;
  url?: string | string[];
  groupId?: number;
  windowId?: number;
  windowType?: chrome.windows.WindowType;
  index?: number;
}

export interface TabCreateProperties {
  windowId?: number;
  index?: number;
  url?: string;
  active?: boolean;
  pinned?: boolean;
  openerTabId?: number;
}

export interface TabUpdateProperties {
  url?: string;
  active?: boolean;
  highlighted?: boolean;
  pinned?: boolean;
  muted?: boolean;
  openerTabId?: number;
  autoDiscardable?: boolean;
}

// Helper to safely use Chrome tabs API
export const chromeTabs = {
  query: async (queryInfo: TabQueryInfo): Promise<chrome.tabs.Tab[]> => {
    if (!isChromeExtension()) {
      return [];
    }
    
    return new Promise((resolve) => {
      window.chrome?.tabs?.query(queryInfo, (tabs) => {
        resolve(tabs || []);
      });
    });
  },
  
  create: async (createProperties: TabCreateProperties): Promise<chrome.tabs.Tab | null> => {
    if (!isChromeExtension()) {
      return null;
    }
    
    return new Promise((resolve) => {
      window.chrome?.tabs?.create(createProperties, (tab) => {
        resolve(tab || null);
      });
    });
  },
  
  update: async (tabId: number, updateProperties: TabUpdateProperties): Promise<chrome.tabs.Tab | null> => {
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