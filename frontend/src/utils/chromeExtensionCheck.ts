/**
 * Platform detection utilities for Chrome extension vs web environment
 */

/**
 * Check if running in Chrome extension environment
 * More robust check that handles both extension and web contexts
 */
export const isChromeExtension = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  try {
    return !!(
      window.chrome &&
      window.chrome.runtime &&
      window.chrome.runtime.id &&
      typeof window.chrome.runtime.sendMessage === 'function'
    );
  } catch {
    return false;
  }
};

/**
 * Check if Chrome APIs are available (even if not in extension context)
 */
export const isChromeApiAvailable = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  try {
    return !!(window.chrome && window.chrome.runtime);
  } catch {
    return false;
  }
};

/**
 * Get Chrome runtime safely
 */
export const getChromeRuntime = (): typeof chrome.runtime | null => {
  if (!isChromeApiAvailable()) return null;
  return (window as any).chrome?.runtime || null;
};

/**
 * Get Chrome tabs API safely  
 */
export const getChromeTabs = (): typeof chrome.tabs | null => {
  if (!isChromeApiAvailable()) return null;
  return (window as any).chrome?.tabs || null;
};