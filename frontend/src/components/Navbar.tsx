import { useState } from 'react';
import { Bell, User, Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSettings } from '../hooks/useSettings';
import { useResponsiveNav } from '../hooks/useResponsiveNav';
import MobileNavigation from './MobileNavigation';

const Navbar: React.FC = () => {
  const [notifications] = useState<number>(3);
  const { hasStoredCredentials } = useSettings();
  const { isMobileMenuOpen, toggleMobileMenu, closeMobileMenu, isMobile } = useResponsiveNav();
  
  return (
    <>
      <nav 
        className="bg-white border-b border-neutral-200 px-4 py-2.5 flex justify-between items-center"
        role="banner"
        aria-label="Main navigation"
      >
        <div className="flex items-center">
          {isMobile && (
            <button 
              id="mobile-menu-toggle"
              onClick={toggleMobileMenu}
              className="mr-3 p-2 rounded-md text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 transition-colors touch-target"
              aria-label="Toggle mobile menu"
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-navigation"
            >
              <Menu className="h-6 w-6" aria-hidden="true" />
            </button>
          )}
          <h1 className="text-lg sm:text-xl font-bold text-blue-600">
            <span className="hidden sm:inline">Poloniex Futures</span>
            <span className="sm:hidden">Poloniex</span>
          </h1>
        </div>
        
        <div className="flex items-center space-x-2 sm:space-x-4">
          <div className="relative">
            <button 
              className="p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-md transition-colors touch-target"
              aria-label={`Notifications${notifications > 0 ? ` (${notifications} new)` : ' (none)'}`}
            >
              <Bell className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
              {notifications > 0 && (
                <span 
                  className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-red-600 rounded-full min-w-[1.25rem]"
                  aria-hidden="true"
                >
                  {notifications > 99 ? '99+' : notifications}
                </span>
              )}
            </button>
          </div>
          
          <div className="flex items-center">
            <Link 
              to="/account" 
              className="flex items-center p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-md transition-colors touch-target"
              aria-label={hasStoredCredentials ? 'Go to My Account' : 'Connect Account'}
            >
              <User className="h-5 w-5 sm:h-6 sm:w-6 mr-1 sm:mr-2" aria-hidden="true" />
              <span className="hidden md:inline-block text-sm font-medium">
                {hasStoredCredentials ? 'My Account' : 'Connect Account'}
              </span>
              <span className="md:hidden text-sm font-medium">
                {hasStoredCredentials ? 'Account' : 'Connect'}
              </span>
            </Link>
          </div>
        </div>
      </nav>
      
      {/* Mobile Navigation */}
      <MobileNavigation isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
    </>
  );
};

export default Navbar;
