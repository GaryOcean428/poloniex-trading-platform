import { useEffect, useRef } from 'react';

/**
 * Hook to handle page visibility changes and provide callbacks for when page becomes visible/hidden
 * Includes grace period to handle quick tab switches without disrupting connections
 */
export const usePageVisibility = (
  onVisible: () => void,
  onHidden: () => void,
  gracePeriod: number = 30000 // 30 seconds grace period
): void => {
  // In the browser, setTimeout returns a number, not NodeJS.Timeout
  const timeoutRef = useRef<number | undefined>(undefined);
  
  useEffect(() => {
    // SSR/Non-DOM environments guard
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const handleVisibilityChange = (): void => {
      if (document.hidden || document.visibilityState === 'hidden') {
        // Page is hidden - delay the onHidden callback to handle quick tab switches
        timeoutRef.current = window.setTimeout(() => {
          onHidden();
        }, gracePeriod);
      } else {
        // Page is visible - clear any pending onHidden callback and call onVisible
        if (timeoutRef.current !== undefined) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = undefined;
        }
        onVisible();
      }
    };
    
    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    // Invoke once on mount to sync with current state
    handleVisibilityChange();
    
    // Cleanup
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [onVisible, onHidden, gracePeriod]);
};