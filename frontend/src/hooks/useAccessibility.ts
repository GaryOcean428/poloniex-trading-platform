import { useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook for managing accessibility features
 */
export const useAccessibility = () => {
  const focusRingRef = useRef<HTMLElement | null>(null);

  /**
   * Trap focus within a container element
   */
  const trapFocus = useCallback((containerElement: HTMLElement) => {
    const focusableElements = containerElement.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleTabKeyPress = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    containerElement.addEventListener('keydown', handleTabKeyPress);
    
    return () => {
      containerElement.removeEventListener('keydown', handleTabKeyPress);
    };
  }, []);

  /**
   * Handle escape key to close modals/dropdowns
   */
  const handleEscapeKey = useCallback((callback: () => void) => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        callback();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, []);

  /**
   * Announce changes to screen readers
   */
  const announceToScreenReader = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', priority);
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;

    document.body.appendChild(announcement);

    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }, []);

  /**
   * Set focus to element with proper error handling
   */
  const setFocus = useCallback((element: HTMLElement | null) => {
    if (element && typeof element.focus === 'function') {
      try {
        element.focus();
      } catch (error) {
        console.warn('Failed to set focus:', error);
      }
    }
  }, []);

  /**
   * Skip to main content link functionality
   */
  const skipToMainContent = useCallback(() => {
    const mainContent = document.querySelector('main[role="main"], main, #main-content');
    if (mainContent) {
      (mainContent as HTMLElement).focus();
      mainContent.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  return {
    trapFocus,
    handleEscapeKey,
    announceToScreenReader,
    setFocus,
    skipToMainContent,
    focusRingRef
  };
};

/**
 * Hook for managing keyboard navigation in lists and grids
 */
export const useKeyboardNavigation = (
  itemCount: number,
  columns?: number,
  onSelect?: (index: number) => void
) => {
  const currentIndex = useRef(0);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const { key } = e;
    let newIndex = currentIndex.current;

    switch (key) {
      case 'ArrowDown':
        e.preventDefault();
        if (columns) {
          // Grid navigation
          newIndex = Math.min(currentIndex.current + columns, itemCount - 1);
        } else {
          // List navigation
          newIndex = Math.min(currentIndex.current + 1, itemCount - 1);
        }
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        if (columns) {
          // Grid navigation
          newIndex = Math.max(currentIndex.current - columns, 0);
        } else {
          // List navigation
          newIndex = Math.max(currentIndex.current - 1, 0);
        }
        break;
      
      case 'ArrowRight':
        if (columns) {
          e.preventDefault();
          newIndex = Math.min(currentIndex.current + 1, itemCount - 1);
        }
        break;
      
      case 'ArrowLeft':
        if (columns) {
          e.preventDefault();
          newIndex = Math.max(currentIndex.current - 1, 0);
        }
        break;
      
      case 'Home':
        e.preventDefault();
        newIndex = 0;
        break;
      
      case 'End':
        e.preventDefault();
        newIndex = itemCount - 1;
        break;
      
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (onSelect) {
          onSelect(currentIndex.current);
        }
        break;
    }

    if (newIndex !== currentIndex.current) {
      currentIndex.current = newIndex;
      // Focus the new item
      const items = document.querySelectorAll('[data-keyboard-nav-item]');
      const targetItem = items[newIndex] as HTMLElement;
      if (targetItem) {
        targetItem.focus();
      }
    }
  }, [itemCount, columns, onSelect]);

  const setCurrentIndex = useCallback((index: number) => {
    currentIndex.current = Math.max(0, Math.min(index, itemCount - 1));
  }, [itemCount]);

  return {
    handleKeyDown,
    currentIndex: currentIndex.current,
    setCurrentIndex
  };
};

/**
 * Hook for managing live regions for dynamic content updates
 */
export const useLiveRegion = () => {
  const liveRegionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Create live region if it doesn't exist
    if (!liveRegionRef.current) {
      const liveRegion = document.createElement('div');
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.className = 'sr-only';
      liveRegion.id = 'live-region';
      document.body.appendChild(liveRegion);
      liveRegionRef.current = liveRegion;
    }

    return () => {
      if (liveRegionRef.current && liveRegionRef.current.parentNode) {
        liveRegionRef.current.parentNode.removeChild(liveRegionRef.current);
      }
    };
  }, []);

  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (liveRegionRef.current) {
      liveRegionRef.current.setAttribute('aria-live', priority);
      liveRegionRef.current.textContent = message;
    }
  }, []);

  return { announce };
};