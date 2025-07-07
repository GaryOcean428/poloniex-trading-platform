import { useEffect, useRef } from 'react';

/**
 * Hook to handle page visibility changes and provide callbacks for when page becomes visible/hidden
 * Includes grace period to handle quick tab switches without disrupting connections
 */
export const usePageVisibility = (
  onVisible: () => void,
  onHidden: () => void,
  gracePeriod: number = 30000 // 30 seconds grace period
) => {
  const timeoutRef = useRef<NodeJS.Timeout>();
  
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden - delay the onHidden callback to handle quick tab switches
        timeoutRef.current = setTimeout(() => {
          onHidden();
        }, gracePeriod);
      } else {
        // Page is visible - clear any pending onHidden callback and call onVisible
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = undefined;
        }
        onVisible();
      }
    };
    
    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Cleanup
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [onVisible, onHidden, gracePeriod]);
};