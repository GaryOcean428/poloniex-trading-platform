import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTradingContext } from '../context/TradingContext';
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

const Sidebar: React.FC = () => {
  const location = useLocation();
  const { accountBalance, isLoading } = useTradingContext();
  
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
  
  return (
    <aside className="w-64 bg-neutral-800 text-white hidden md:block">
      <div className="p-4">
        <div className="flex items-center justify-center mb-6 mt-2">
          <Zap className="h-8 w-8 text-blue-400 mr-2" />
          <h2 className="text-xl font-bold">TradingBot</h2>
        </div>
        
        <nav>
          <ul>
            {navItems.map((item) => (
              <li key={item.path} className="mb-1">
                <Link 
                  to={item.path} 
                  className={`flex items-center p-3 rounded-md transition-colors duration-200 ${
                    location.pathname === item.path 
                      ? 'bg-blue-700 text-white' 
                      : 'text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  <span className="mr-3">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      
      <div className="p-4 border-t border-neutral-700 mt-auto">
        <div className="bg-neutral-900 p-3 rounded-md">
          <div className="text-sm text-neutral-400 mb-2">Account Balance</div>
          {isLoading ? (
            <div className="text-sm text-neutral-500">Loading...</div>
          ) : (
            <>
              <div className="text-lg font-semibold">
                ${parseFloat(accountBalance?.totalAmount || '0').toFixed(2)} USDT
              </div>
              <div className={`text-xs mt-1 ${parseFloat(accountBalance?.todayPnL || '0') >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {parseFloat(accountBalance?.todayPnL || '0') >= 0 ? '+' : ''}
                {parseFloat(accountBalance?.todayPnLPercentage || '0').toFixed(2)}% today
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;