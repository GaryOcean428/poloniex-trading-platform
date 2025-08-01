// Chrome extension API type definitions
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        id?: string;
        sendMessage?: (message: unknown, callback?: (response: unknown) => void) => void;
        onMessage?: {
          addListener: (callback: (message: unknown, sender: unknown, sendResponse: unknown) => void) => void;
          removeListener: (callback: (message: unknown, sender: unknown, sendResponse: unknown) => void) => void;
        };
      };
      storage?: {
        local: {
          get: (keys: string | string[] | object | null, callback: (items: { [key: string]: unknown }) => void) => void;
          set: (items: { [key: string]: unknown }, callback?: () => void) => void;
          remove: (keys: string | string[], callback?: () => void) => void;
          clear: (callback?: () => void) => void;
        };
        sync: {
          get: (keys: string | string[] | object | null, callback: (items: { [key: string]: unknown }) => void) => void;
          set: (items: { [key: string]: unknown }, callback?: () => void) => void;
          remove: (keys: string | string[], callback?: () => void) => void;
          clear: (callback?: () => void) => void;
        };
      };
      tabs?: {
        query: (queryInfo: unknown, callback: (tabs: unknown[]) => void) => void;
        create: (createProperties: unknown, callback?: (tab: unknown) => void) => void;
        update: (tabId: number, updateProperties: unknown, callback?: (tab?: unknown) => void) => void;
      };
    };
  }
}

export {};