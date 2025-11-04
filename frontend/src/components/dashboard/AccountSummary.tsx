import { DollarSign, RefreshCw, TrendingDown, TrendingUp, Wifi, WifiOff } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useTradingContext } from '../../hooks/useTradingContext';
import { useWebSocket } from '../../services/websocketService';

 

const AccountSummary: React.FC = () => {
  const { accountBalance, isLoading, isMockMode, refreshApiConnection } = useTradingContext();
  const { isConnected } = useWebSocket();
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
      // Map Futures API response structure: { eq: string; isoEq: string; im: string; mm: string; state: string; }
      const balance = accountBalance as any;
      
      // Check if this is Futures API format (has 'eq' field)
      if (balance.eq !== undefined) {
        const equity = parseFloat(balance.eq || "0");
        const initialMargin = parseFloat(balance.im || "0");
        const maintenanceMargin = parseFloat(balance.mm || "0");
        const available = equity - initialMargin; // Available = Equity - Initial Margin
        
        return {
          balance: equity,
          availableBalance: Math.max(0, available), // Ensure non-negative
          equity: equity,
          unrealizedPnL: 0, // Would need position data to calculate
          todayPnL: 0, // Would need historical data to calculate
          todayPnLPercentage: 0 // Would need historical data to calculate
        };
      }
      
      // Fallback to old structure: { available: number; total: number; currency: string; }
      return {
        balance: parseFloat(balance.total?.toString() || "0"),
        availableBalance: parseFloat(balance.available?.toString() || "0"),
        equity: parseFloat(balance.total?.toString() || "0"),
        unrealizedPnL: 0,
        todayPnL: 0,
        todayPnLPercentage: 0
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
      // console.error('Failed to refresh account data:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const getConnectionStatusIcon = () => {
    if (isConnected) {
      return <Wifi className="h-4 w-4 text-success" aria-label="Connected" />;
    } else {
      return <WifiOff className="h-4 w-4 text-error" aria-label="Disconnected" />;
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold flex items-center text-text-primary">
          Account Summary
          {isLoading && <span className="text-sm text-text-muted ml-2">Loading...</span>}
        </h2>
        <div className="flex items-center space-x-2">
          {getConnectionStatusIcon()}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1 rounded-md hover:bg-bg-secondary disabled:opacity-50 transition-colors"
            title="Refresh account data"
          >
            <RefreshCw className={`h-4 w-4 text-text-secondary ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Connection Status Bar */}
      <div className={`mb-4 p-2 rounded-md text-xs flex items-center justify-between ${
        isConnected ? 'bg-success/10 text-success border border-success/20' : 'bg-warning/10 text-warning border border-warning/20'
      }`}>
        <span className="flex items-center">
          {getConnectionStatusIcon()}
          <span className="ml-1 font-medium">
            {isMockMode ? 'Mock Mode' : isConnected ? 'Live Data' : 'Offline'}
          </span>
        </span>
        <span className="text-text-muted">
          Last updated: {formatTime(lastUpdateTime)}
        </span>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-bg-secondary p-4 rounded-lg relative border border-border-subtle shadow-elev-1">
            <div className="text-sm text-text-muted font-medium">Total Balance</div>
            <div className="text-2xl font-bold flex items-center mt-1 text-text-primary">
              <DollarSign className="h-5 w-5 mr-1 text-text-secondary" />
              {accountData.balance?.toFixed(2)}
            </div>
            {isConnected && !isMockMode && (
              <div className="absolute top-3 right-3 w-2 h-2 bg-success rounded-full animate-pulse"
                title="Live data"></div>
            )}
          </div>

          <div className="bg-bg-secondary p-4 rounded-lg relative border border-border-subtle shadow-elev-1">
            <div className="text-sm text-text-muted font-medium">Available</div>
            <div className="text-2xl font-bold flex items-center mt-1 text-text-primary">
              <DollarSign className="h-5 w-5 mr-1 text-text-secondary" />
              {accountData.availableBalance?.toFixed(2)}
            </div>
            {isConnected && !isMockMode && (
              <div className="absolute top-3 right-3 w-2 h-2 bg-success rounded-full animate-pulse"
                title="Live data"></div>
            )}
          </div>
        </div>

        <div className="bg-bg-secondary p-4 rounded-lg relative border border-border-subtle shadow-elev-1">
          <div className="text-sm text-text-muted font-medium">Equity</div>
          <div className="text-2xl font-bold mt-1 text-text-primary">${accountData.equity.toFixed(2)}</div>
          <div className="text-sm mt-2">
            <span className="text-text-secondary">Unrealized P&L:</span>
            <span className={`font-semibold ml-1 ${(accountData.unrealizedPnL || 0) >= 0 ? 'text-success' : 'text-error'}`}>
              {(accountData.unrealizedPnL || 0) >= 0 ? '+' : ''}{accountData.unrealizedPnL?.toFixed(2)}
            </span>
          </div>
          {isConnected && !isMockMode && (
            <div className="absolute top-3 right-3 w-2 h-2 bg-success rounded-full animate-pulse"
              title="Live data"></div>
          )}
        </div>

        <div className="bg-bg-secondary p-4 rounded-lg relative border border-border-subtle shadow-elev-1">
          <div className="text-sm text-text-muted font-medium">Today's P&L</div>
          <div className="flex items-center mt-1">
            <span className={`text-2xl font-bold ${(accountData.todayPnL || 0) >= 0 ? 'text-success' : 'text-error'}`}>
              {(accountData.todayPnL || 0) >= 0 ? '+' : ''}{accountData.todayPnL?.toFixed(2)}
            </span>
            <span className={`ml-3 flex items-center text-sm font-semibold ${(accountData.todayPnLPercentage || 0) >= 0 ? 'text-success' : 'text-error'}`}>
              {(accountData.todayPnLPercentage || 0) >= 0 ? (
                <TrendingUp className="h-4 w-4 mr-1" />
              ) : (
                <TrendingDown className="h-4 w-4 mr-1" />
              )}
              {accountData.todayPnLPercentage?.toFixed(2)}%
            </span>
          </div>
          {isConnected && !isMockMode && (
            <div className="absolute top-3 right-3 w-2 h-2 bg-success rounded-full animate-pulse"
              title="Live data"></div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountSummary;
