import { useState } from 'react';
import { Bell, User, Menu, LogIn } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSettings } from '../hooks/useSettings';
import { useResponsiveNav } from '../hooks/useResponsiveNav';
import { useAuth } from '../hooks/useAuth';
import UserProfile from './auth/UserProfile';
import LogoutButton from './auth/LogoutButton';
import MobileNavigation from './MobileNavigation';

const Navbar: React.FC = () => {
  const [notifications] = useState<number>(3);
  const { hasStoredCredentials } = useSettings();
  const { isMobileMenuOpen, toggleMobileMenu, closeMobileMenu, isMobile } = useResponsiveNav();
  const { isLoggedIn, loading } = useAuth();
  
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
              aria-expanded={isMobileMenuOpen ? 'true' : 'false'}
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
          
          {/* Authentication Section */}
          <div className="flex items-center space-x-2">
            {loading ? (
              <div className="flex items-center p-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" aria-hidden="true"></div>
                <span className="sr-only">Loading authentication status</span>
              </div>
            ) : isLoggedIn ? (
              // Authenticated User Section
              <>
                <UserProfile className="hidden sm:flex" />
                <Link 
                  to="/account" 
                  className="flex items-center p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-md transition-colors touch-target"
                  aria-label="Go to My Account"
                >
                  <User className="h-5 w-5 sm:h-6 sm:w-6 mr-1 sm:mr-2" aria-hidden="true" />
                  <span className="hidden md:inline-block text-sm font-medium">
                    {hasStoredCredentials ? 'My Account' : 'Connect Account'}
                  </span>
                  <span className="md:hidden text-sm font-medium">
                    {hasStoredCredentials ? 'Account' : 'Connect'}
                  </span>
                </Link>
                <LogoutButton 
                  variant="outline" 
                  className="hidden sm:flex items-center px-3 py-1.5 text-sm"
                />
                <div className="sm:hidden">
                  <LogoutButton 
                    variant="outline" 
                    className="flex items-center p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-md transition-colors touch-target"
                  />
                </div>
              </>
            ) : (
              // Not Authenticated Section
              <>
                <Link 
                  to="/login" 
                  className="flex items-center px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
                  aria-label="Login to your account"
                >
                  <LogIn className="h-4 w-4 mr-1 sm:mr-2" aria-hidden="true" />
                  <span className="hidden sm:inline">Login</span>
                </Link>
                <Link 
                  to="/account" 
                  className="flex items-center p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-md transition-colors touch-target"
                  aria-label="Connect Account"
                >
                  <User className="h-5 w-5 sm:h-6 sm:w-6 mr-1 sm:mr-2" aria-hidden="true" />
                  <span className="hidden md:inline-block text-sm font-medium">
                    Connect Account
                  </span>
                  <span className="md:hidden text-sm font-medium">
                    Connect
                  </span>
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>
      
      {/* Mobile Navigation */}
      <MobileNavigation isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
    </>
  );
};

export default Navbar;
