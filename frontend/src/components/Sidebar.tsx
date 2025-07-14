import {
  Activity,
  ArrowLeft,
  BarChart4,
  Chrome,
  History,
  LayoutDashboard,
  LineChart,
  Menu,
  MessageSquare,
  Receipt,
  Settings,
  TrendingUp,
  User,
  Zap
} from 'lucide-react';
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useResponsiveNav } from '../hooks/useResponsiveNav';
import { useTradingContext } from '../hooks/useTradingContext';

const Sidebar: React.FC = () => {
  const location = useLocation();
  const { accountBalance, isLoading } = useTradingContext();
  const { isDesktop } = useResponsiveNav();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const navItems = [
    { path: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { path: '/dashboard/live', label: 'Live Trading', icon: <Activity size={20} /> },
    { path: '/strategies', label: 'Trading Strategies', icon: <Zap size={20} /> },
    { path: '/backtesting', label: 'Advanced Backtesting', icon: <TrendingUp size={20} /> },
    { path: '/account', label: 'Account', icon: <User size={20} /> },
    { path: '/transactions', label: 'Transaction History', icon: <Receipt size={20} /> },
    { path: '/trades', label: 'Trade History', icon: <History size={20} /> },
    { path: '/charts', label: 'Market Analysis', icon: <BarChart4 size={20} /> },
    { path: '/performance', label: 'Performance', icon: <LineChart size={20} /> },
    { path: '/chat', label: 'Community Chat', icon: <MessageSquare size={20} /> },
    { path: '/extension', label: 'Chrome Extension', icon: <Chrome size={20} /> },
    { path: '/settings', label: 'Settings', icon: <Settings size={20} /> }
  ];

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Only show sidebar on desktop
  if (!isDesktop) return null;

  return (
    <aside
      id="navigation"
      className={`
        ${isCollapsed ? 'w-16' : 'w-64'}
        bg-neutral-800 text-white transition-all duration-300 ease-in-out
        relative flex-shrink-0
      `}
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="p-4">
        {/* Header with toggle */}
        <div className="flex items-center justify-between mb-6 mt-2">
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : ''}`}>
            <Zap className="h-8 w-8 text-blue-400 mr-2" aria-hidden="true" />
            {!isCollapsed && <h2 className="text-xl font-bold">TradingBot</h2>}
          </div>
          <button
            onClick={toggleSidebar}
            className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={isCollapsed ? 'false' : 'true'}
          >
            {isCollapsed ? <Menu size={20} aria-hidden="true" /> : <ArrowLeft size={20} aria-hidden="true" />}
          </button>
        </div>

        <nav aria-label="Main menu">
          <ul className="space-y-1" role="list">
            {navItems.map((item) => (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`
                    flex items-center p-3 rounded-md transition-all duration-200 group
                    ${location.pathname === item.path
                      ? 'bg-blue-700 text-white'
                      : 'text-neutral-300 hover:bg-neutral-700 hover:text-white'
                    }
                    ${isCollapsed ? 'justify-center' : ''}
                  `}
                  title={isCollapsed ? item.label : undefined}
                  aria-label={item.label}
                  aria-current={location.pathname === item.path ? 'page' : undefined}
                >
                  <span className={`flex-shrink-0 ${!isCollapsed ? 'mr-3' : ''}`} aria-hidden="true">
                    {item.icon}
                  </span>
                  {!isCollapsed && (
                    <span className="transition-opacity duration-200">{item.label}</span>
                  )}

                  {/* Tooltip for collapsed state */}
                  {isCollapsed && (
                    <div className="
                      absolute left-full ml-2 px-2 py-1
                      bg-neutral-900 text-white text-sm rounded-md
                      opacity-0 group-hover:opacity-100 transition-opacity duration-200
                      pointer-events-none whitespace-nowrap z-50
                    ">
                      {item.label}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/* Account balance section */}
      {!isCollapsed && (
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-neutral-700">
          <div className="bg-neutral-900 p-3 rounded-md">
            <div className="text-sm text-neutral-400 mb-2">Account Balance</div>
            {isLoading ? (
              <div className="text-sm text-neutral-500">Loading...</div>
            ) : (
              <>
                <div className="text-lg font-semibold">
                  ${parseFloat(accountBalance?.total?.toString() || '0').toFixed(2)} USDT
                </div>
                <div className="text-xs text-neutral-400 mt-1">
                  {accountBalance?.currency || 'USDT'}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
