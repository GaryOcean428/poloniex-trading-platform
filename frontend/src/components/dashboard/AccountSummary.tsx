import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useTradingContext } from '../../hooks/useTradingContext';
import { useWebSocket } from '../../services/websocketService';

const AccountSummary: React.FC = () => {
  const { accountBalance, isLoading, isMockMode, refreshApiConnection } = useTradingContext();
  const { isConnected, connectionState } = useWebSocket();
  const [lastUpdateTime, setLastUpdateTime] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Update last update time when account balance changes
  useEffect(() => {
    if (accountBalance) {
      setLastUpdateTime(new Date());
    }
  }, [accountBalance]);
  
  // Default values if data is not available
  const defaultAccountData = {
    balance: 15478.23,
    availableBalance: 12345.67,
    equity: 15820.45,
    unrealizedPnL: 342.22,
    todayPnL: 156.78,
    todayPnLPercentage: 1.02
  };
  
  // Process account data from API if available
  const processAccountData = () => {
    if (!accountBalance || isLoading) return defaultAccountData;
    
    try {
      // This mapping will depend on the exact format of your Poloniex API response
      // Adjust as needed based on the actual response structure
      return {
        balance: parseFloat(accountBalance.totalAmount || "0"),
        availableBalance: parseFloat(accountBalance.availableAmount || "0"),
        equity: parseFloat(accountBalance.accountEquity || "0"),
        unrealizedPnL: parseFloat(accountBalance.unrealizedPnL || "0"),
        todayPnL: parseFloat(accountBalance.todayPnL || "0"),
        todayPnLPercentage: parseFloat(accountBalance.todayPnLPercentage || "0")
      };
    } catch (error) {
      console.error('Error processing account data:', error);
      return defaultAccountData;
    }
  };
  
  const accountData = processAccountData();
  
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshApiConnection();
      setLastUpdateTime(new Date());
    } catch (error) {
      console.error('Failed to refresh account data:', error);
    } finally {
      setIsRefreshing(false);
    }
  };
  
  const getConnectionStatusIcon = () => {
    if (isConnected) {
      return <Wifi className="h-4 w-4 text-green-600" aria-label="Connected" />;
    } else {
      return <WifiOff className="h-4 w-4 text-red-600" aria-label="Disconnected" />;
    }
  };
  
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold flex items-center">
          Account Summary 
          {isLoading && <span className="text-sm text-neutral-500 ml-2">Loading...</span>}
        </h2>
        <div className="flex items-center space-x-2">
          {getConnectionStatusIcon()}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1 rounded-md hover:bg-gray-100 disabled:opacity-50"
            title="Refresh account data"
          >
            <RefreshCw className={`h-4 w-4 text-gray-600 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      
      {/* Connection Status Bar */}
      <div className={`mb-4 p-2 rounded-md text-xs flex items-center justify-between ${
        isConnected ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'
      }`}>
        <span className="flex items-center">
          {getConnectionStatusIcon()}
          <span className="ml-1">
            {isMockMode ? 'Mock Mode' : isConnected ? 'Live Data' : 'Offline'}
          </span>
        </span>
        <span>
          Last updated: {formatTime(lastUpdateTime)}
        </span>
      </div>
      
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-neutral-50 p-3 rounded-md relative">
            <div className="text-sm text-neutral-500">Total Balance</div>
            <div className="text-xl font-bold flex items-center">
              <DollarSign className="h-4 w-4 mr-1 text-neutral-500" />
              {accountData.balance?.toFixed(2)}
            </div>
            {/* Real-time indicator */}
            {isConnected && !isMockMode && (
              <div className="absolute top-2 right-2 w-2 h-2 bg-green-500 rounded-full animate-pulse" 
                   title="Live data"></div>
            )}
          </div>
          
          <div className="bg-neutral-50 p-3 rounded-md relative">
            <div className="text-sm text-neutral-500">Available</div>
            <div className="text-xl font-bold flex items-center">
              <DollarSign className="h-4 w-4 mr-1 text-neutral-500" />
              {accountData.availableBalance?.toFixed(2)}
            </div>
            {/* Real-time indicator */}
            {isConnected && !isMockMode && (
              <div className="absolute top-2 right-2 w-2 h-2 bg-green-500 rounded-full animate-pulse" 
                   title="Live data"></div>
            )}
          </div>
        </div>
        
        <div className="bg-neutral-50 p-3 rounded-md relative">
          <div className="text-sm text-neutral-500">Equity</div>
          <div className="text-xl font-bold">${accountData.equity.toFixed(2)}</div>
          <div className="text-sm mt-1">
            Unrealized P&L: 
            <span className={`font-medium ml-1 ${(accountData.unrealizedPnL || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {(accountData.unrealizedPnL || 0) >= 0 ? '+' : ''}{accountData.unrealizedPnL?.toFixed(2)}
            </span>
          </div>
          {/* Real-time indicator */}
          {isConnected && !isMockMode && (
            <div className="absolute top-2 right-2 w-2 h-2 bg-green-500 rounded-full animate-pulse" 
                 title="Live data"></div>
          )}
        </div>
        
        <div className="bg-neutral-50 p-3 rounded-md relative">
          <div className="text-sm text-neutral-500">Today's P&L</div>
          <div className="flex items-center">
            <span className={`text-xl font-bold ${(accountData.todayPnL || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {(accountData.todayPnL || 0) >= 0 ? '+' : ''}{accountData.todayPnL?.toFixed(2)}
            </span>
            <span className={`ml-2 flex items-center text-sm ${(accountData.todayPnLPercentage || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {(accountData.todayPnLPercentage || 0) >= 0 ? (
                <TrendingUp className="h-4 w-4 mr-1" />
              ) : (
                <TrendingDown className="h-4 w-4 mr-1" />
              )}
              {accountData.todayPnLPercentage?.toFixed(2)}%
            </span>
          </div>
          {/* Real-time indicator */}
          {isConnected && !isMockMode && (
            <div className="absolute top-2 right-2 w-2 h-2 bg-green-500 rounded-full animate-pulse" 
                 title="Live data"></div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountSummary;