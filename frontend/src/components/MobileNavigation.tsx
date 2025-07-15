import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { 
  LayoutDashboard, 
  LineChart, 
  Settings, 
  MessageSquare, 
  Zap,
  BarChart4,
  Chrome,
  User
} from 'lucide-react';

interface MobileNavigationProps {
  isOpen: boolean;
  onClose: () => void;
}

const MobileNavigation: React.FC<MobileNavigationProps> = ({ isOpen, onClose }) => {
  const location = useLocation();
  
  const navItems = [
    { path: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { path: '/strategies', label: 'Trading Strategies', icon: <Zap size={20} /> },
    { path: '/account', label: 'Account', icon: <User size={20} /> },
    { path: '/charts', label: 'Market Analysis', icon: <BarChart4 size={20} /> },
    { path: '/performance', label: 'Performance', icon: <LineChart size={20} /> },
    { path: '/chat', label: 'Community Chat', icon: <MessageSquare size={20} /> },
    { path: '/extension', label: 'Chrome Extension', icon: <Chrome size={20} /> },
    { path: '/settings', label: 'Settings', icon: <Settings size={20} /> }
  ];

  if (!isOpen) return null;

  return (
    <div
      id="mobile-navigation"
      className="fixed inset-0 z-50 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Mobile navigation menu"
    >
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Navigation Panel */}
      <nav
        id="mobile-navigation"
        className="relative flex flex-col w-full max-w-xs bg-neutral-800 text-white h-full shadow-xl"
        aria-label="Mobile navigation"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-700">
          <div className="flex items-center">
            <Zap className="h-8 w-8 text-blue-400 mr-2" aria-hidden="true" />
            <h2 className="text-xl font-bold">TradingBot</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
            aria-label="Close navigation menu"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        
        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto">
          <ul className="p-4 space-y-2" role="list">
            {navItems.map((item) => (
              <li key={item.path}>
                <Link
                  to={item.path}
                  onClick={onClose}
                  className={`
                    flex items-center p-3 rounded-md transition-all duration-200 touch-target
                    ${location.pathname === item.path 
                      ? 'bg-blue-700 text-white' 
                      : 'text-neutral-300 hover:bg-neutral-700 hover:text-white'
                    }
                  `}
                  aria-label={item.label}
                  aria-current={location.pathname === item.path ? 'page' : undefined}
                >
                  <span className="flex-shrink-0 mr-3" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="font-medium">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-neutral-700">
          <div className="text-sm text-neutral-400">
            <p>Poloniex Trading Platform</p>
            <p className="text-xs mt-1">Version 1.0.0</p>
          </div>
        </div>
      </nav>
    </div>
  );
};

export default MobileNavigation;