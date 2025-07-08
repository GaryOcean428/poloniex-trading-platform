import { useState } from 'react';
import { Bell, User, Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSettings } from '../hooks/useSettings';

const Navbar: React.FC = () => {
  const [notifications] = useState<number>(3);
  const { hasStoredCredentials } = useSettings();
  
  return (
    <nav 
      className="bg-white border-b border-neutral-200 px-4 py-2.5 flex justify-between items-center"
      role="banner"
      aria-label="Main navigation"
    >
      <div className="flex items-center">
        <button 
          className="mr-2 md:hidden"
          aria-label="Toggle mobile menu"
          aria-expanded="false"
        >
          <Menu className="h-6 w-6 text-neutral-500" aria-hidden="true" />
        </button>
        <h1 className="text-xl font-bold text-blue-600">Poloniex Futures</h1>
      </div>
      
      <div className="flex items-center space-x-4">
        <div className="relative">
          <button 
            className="text-neutral-500 hover:text-neutral-700"
            aria-label={`Notifications${notifications > 0 ? ` (${notifications} new)` : ' (none)'}`}
          >
            <Bell className="h-6 w-6" aria-hidden="true" />
            {notifications > 0 && (
              <span 
                className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-red-600 rounded-full"
                aria-hidden="true"
              >
                {notifications}
              </span>
            )}
          </button>
        </div>
        
        <div className="flex items-center">
          <Link 
            to="/account" 
            className="flex items-center text-neutral-500 hover:text-neutral-700"
            aria-label={hasStoredCredentials ? 'Go to My Account' : 'Connect Account'}
          >
            <User className="h-6 w-6 mr-1" aria-hidden="true" />
            <span className="hidden md:inline-block">
              {hasStoredCredentials ? 'My Account' : 'Connect Account'}
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
