import { useState, useEffect, useCallback } from 'react';

interface ResponsiveNavHook {
  isMobileMenuOpen: boolean;
  toggleMobileMenu: () => void;
  closeMobileMenu: () => void;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  screenSize: 'mobile' | 'tablet' | 'desktop';
}

/**
 * Hook for managing responsive navigation and screen size detection
 */
export const useResponsiveNav = (): ResponsiveNavHook => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [screenSize, setScreenSize] = useState<'mobile' | 'tablet' | 'desktop'>('desktop');

  const getScreenSize = useCallback(() => {
    const width = window.innerWidth;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  }, []);

  const updateScreenSize = useCallback(() => {
    const newScreenSize = getScreenSize();
    setScreenSize(newScreenSize);
    
    // Close mobile menu when switching to larger screens
    if (newScreenSize !== 'mobile' && isMobileMenuOpen) {
      setIsMobileMenuOpen(false);
    }
  }, [getScreenSize, isMobileMenuOpen]);

  useEffect(() => {
    updateScreenSize();
    window.addEventListener('resize', updateScreenSize);
    
    return () => {
      window.removeEventListener('resize', updateScreenSize);
    };
  }, [updateScreenSize]);

  const toggleMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(prev => !prev);
  }, []);

  const closeMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false);
  }, []);

  // Close mobile menu when clicking outside or pressing escape
  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMobileMenu();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element;
      const mobileNav = document.getElementById('mobile-navigation');
      const mobileToggle = document.getElementById('mobile-menu-toggle');
      
      if (mobileNav && !mobileNav.contains(target) && !mobileToggle?.contains(target)) {
        closeMobileMenu();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    document.addEventListener('click', handleClickOutside);
    
    // Prevent body scroll when mobile menu is open
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyPress);
      document.removeEventListener('click', handleClickOutside);
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen, closeMobileMenu]);

  const isMobile = screenSize === 'mobile';
  const isTablet = screenSize === 'tablet';
  const isDesktop = screenSize === 'desktop';

  return {
    isMobileMenuOpen,
    toggleMobileMenu,
    closeMobileMenu,
    isMobile,
    isTablet,
    isDesktop,
    screenSize
  };
};

/**
 * Hook for responsive breakpoint detection
 */
export const useBreakpoint = () => {
  const [breakpoint, setBreakpoint] = useState('lg');

  useEffect(() => {
    const updateBreakpoint = () => {
      const width = window.innerWidth;
      if (width < 475) setBreakpoint('xs');
      else if (width < 640) setBreakpoint('sm');
      else if (width < 768) setBreakpoint('md');
      else if (width < 1024) setBreakpoint('lg');
      else if (width < 1280) setBreakpoint('xl');
      else setBreakpoint('2xl');
    };

    updateBreakpoint();
    window.addEventListener('resize', updateBreakpoint);
    
    return () => window.removeEventListener('resize', updateBreakpoint);
  }, []);

  const isAbove = useCallback((bp: string) => {
    const breakpoints = { xs: 475, sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };
    const sizes = Object.keys(breakpoints);
    const currentIndex = sizes.indexOf(breakpoint);
    const targetIndex = sizes.indexOf(bp);
    return currentIndex >= targetIndex;
  }, [breakpoint]);

  const isBelow = useCallback((bp: string) => {
    return !isAbove(bp);
  }, [isAbove]);

  return {
    breakpoint,
    isAbove,
    isBelow,
    isMobile: isBelow('md'),
    isTablet: isAbove('md') && isBelow('lg'),
    isDesktop: isAbove('lg')
  };
};