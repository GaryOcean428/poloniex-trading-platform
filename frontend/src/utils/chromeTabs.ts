import { isChromeExtension } from './chromeExtensionCheck';

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