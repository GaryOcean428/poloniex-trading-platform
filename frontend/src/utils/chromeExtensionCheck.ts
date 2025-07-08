// Helper to check if running in Chrome extension environment
export const isChromeExtension = (): boolean => {
  return typeof window !== 'undefined' && 
         typeof window.chrome !== 'undefined' && 
         typeof window.chrome.runtime !== 'undefined' && 
         typeof window.chrome.runtime.id !== 'undefined';
};