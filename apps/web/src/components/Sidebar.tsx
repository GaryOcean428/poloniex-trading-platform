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
  Zap,
  AlertCircle,
  Sparkles,
  Brain,
  X
} from 'lucide-react';
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useResponsiveNav } from '../hooks/useResponsiveNav';
import { useTradingContext } from '../hooks/useTradingContext';
import { useMobileMenu } from '../context/MobileMenuContext';

const Sidebar: React.FC = () => {
  const location = useLocation();
  const { accountBalance, isLoading } = useTradingContext();
  const { isDesktop } = useResponsiveNav();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { isMobileMenuOpen, closeMobileMenu } = useMobileMenu();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { path: '/dashboard/live', label: 'Live Trading', icon: <Activity size={20} /> },
    { path: '/strategies', label: 'Trading Strategies', icon: <Zap size={20} /> },
    { path: '/ai-strategies', label: 'AI Strategy Generator', icon: <Sparkles size={20} /> },
    { path: '/strategy-dashboard', label: 'Strategy Dashboard', icon: <BarChart4 size={20} /> },
    { path: '/autonomous-agent', label: 'Autonomous Agent', icon: <Brain size={20} /> },
    { path: '/backtesting', label: 'Advanced Backtesting', icon: <TrendingUp size={20} /> },
    { path: '/account', label: 'Account', icon: <User size={20} /> },
    { path: '/transactions', label: 'Transaction History', icon: <Receipt size={20} /> },
    { path: '/trades', label: 'Trade History', icon: <History size={20} /> },
    { path: '/charts', label: 'Market Analysis', icon: <BarChart4 size={20} /> },
    { path: '/performance', label: 'Performance', icon: <LineChart size={20} /> },
    { path: '/chat', label: 'Community Chat', icon: <MessageSquare size={20} /> },
    { path: '/extension', label: 'Chrome Extension', icon: <Chrome size={20} /> },
    { path: '/status', label: 'System Status', icon: <AlertCircle size={20} /> },
    { path: '/settings', label: 'Settings', icon: <Settings size={20} /> }
  ];

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Desktop sidebar
  if (isDesktop) {
    return (
      <aside
        id="navigation"
        className={`
          ${isCollapsed ? 'w-16' : 'w-64'}
          bg-neutral-800 text-white transition-all duration-300 ease-in-out
          relative flex-shrink-0 h-screen overflow-y-auto
        `}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="p-4">
          {/* Header with toggle */}
          <div className="flex items-center justify-between mb-6 mt-2">
            <div className={`flex items-center ${isCollapsed ? 'justify-center w-full' : ''}`}>
              <Zap className="h-8 w-8 text-blue-400 mr-2" aria-hidden="true" />
              {!isCollapsed && <h2 className="text-xl font-bold">TradingBot</h2>}
            </div>
            {!isCollapsed && (
              <button
                onClick={toggleSidebar}
                className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
                aria-label="Collapse sidebar"
                aria-expanded="true"
              >
                <ArrowLeft size={20} aria-hidden="true" />
              </button>
            )}
          </div>

          {isCollapsed && (
            <button
              onClick={toggleSidebar}
              className="w-full mb-6 p-2 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
              aria-label="Expand sidebar"
              aria-expanded="false"
            >
              <Menu size={20} className="mx-auto" aria-hidden="true" />
            </button>
          )}

          {/* Account Balance */}
          {!isCollapsed && (
            <div className="mb-6 p-3 bg-neutral-900 rounded-lg">
              <div className="text-sm text-neutral-400 mb-1">Account Balance</div>
              <div className="text-2xl font-bold">
                {isLoading ? (
                  <div className="animate-pulse bg-neutral-700 h-8 w-32 rounded"></div>
                ) : accountBalance && typeof accountBalance.total === 'number' ? (
                  `$${accountBalance.total.toFixed(2)}`
                ) : (
                  <span className="text-neutral-500 text-base">$0.00</span>
                )}
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                {accountBalance ? 'USDT' : 'Add API keys in Settings'}
              </div>
            </div>
          )}

          {/* Navigation Items */}
          <nav>
            <ul className="space-y-1">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className={`
                        flex items-center px-3 py-2.5 rounded-lg transition-all duration-200
                        ${isActive 
                          ? 'bg-blue-600 text-white shadow-lg' 
                          : 'text-neutral-300 hover:bg-neutral-700 hover:text-white'
                        }
                        ${isCollapsed ? 'justify-center' : ''}
                      `}
                      title={isCollapsed ? item.label : undefined}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <span className="flex-shrink-0" aria-hidden="true">{item.icon}</span>
                      {!isCollapsed && (
                        <span className="ml-3 text-sm font-medium">{item.label}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </aside>
    );
  }

  // Mobile sidebar (drawer)
  return (
    <>
      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={closeMobileMenu}
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        id="navigation"
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-neutral-800 text-white
          transform transition-transform duration-300 ease-in-out lg:hidden
          overflow-y-auto
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        role="navigation"
        aria-label="Main navigation"
        aria-hidden={!isMobileMenuOpen}
      >
        <div className="p-4">
          {/* Header with close button */}
          <div className="flex items-center justify-between mb-6 mt-2">
            <div className="flex items-center">
              <Zap className="h-8 w-8 text-blue-400 mr-2" aria-hidden="true" />
              <h2 className="text-xl font-bold">TradingBot</h2>
            </div>
            <button
              onClick={closeMobileMenu}
              className="p-2 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Close navigation menu"
            >
              <X size={24} aria-hidden="true" />
            </button>
          </div>

          {/* Account Balance */}
          <div className="mb-6 p-3 bg-neutral-900 rounded-lg">
            <div className="text-sm text-neutral-400 mb-1">Account Balance</div>
            <div className="text-2xl font-bold">
              {isLoading ? (
                <div className="animate-pulse bg-neutral-700 h-8 w-32 rounded"></div>
              ) : accountBalance && typeof accountBalance.total === 'number' ? (
                `$${accountBalance.total.toFixed(2)}`
              ) : (
                <span className="text-neutral-500 text-base">Connect API</span>
              )}
            </div>
            <div className="text-xs text-neutral-500 mt-1">
              {accountBalance && typeof accountBalance.total === 'number' ? 'USDT' : 'No credentials'}
            </div>
          </div>

          {/* Navigation Items */}
          <nav>
            <ul className="space-y-1">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className={`
                        flex items-center px-3 py-3 rounded-lg transition-all duration-200
                        min-h-[44px]
                        ${isActive 
                          ? 'bg-blue-600 text-white shadow-lg' 
                          : 'text-neutral-300 hover:bg-neutral-700 hover:text-white'
                        }
                      `}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={closeMobileMenu}
                    >
                      <span className="flex-shrink-0" aria-hidden="true">{item.icon}</span>
                      <span className="ml-3 text-sm font-medium">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
