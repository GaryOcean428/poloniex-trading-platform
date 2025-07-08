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

export {};